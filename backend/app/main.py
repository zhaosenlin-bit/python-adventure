from contextlib import asynccontextmanager
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response

from app.api.v1 import (
    achievements,
    admin,
    ai_questions,
    auth,
    battle_ws,
    battles,
    chat,
    coins,
    community,
    custom_levels,
    daily,
    decorations,
    food,
    interactions,
    launcher,
    leaderboard,
    learning_assistant,
    pets,
    pet_chat,
    progress,
    pvp,
    pvp_battle_royale,
    tasks,
    typing,
    user_questions,
    users,
    workshop,
    world,
)
from app.core.config import settings
from app.core.database import ensure_database_ready

IS_PRODUCTION = settings.ENVIRONMENT.lower() == "production"

# 浏览器打开任何页面都会自动请求 /favicon.ico，后端不提供的话每个页面
# 都会在控制台报一条 404。这里直接复用前端 public/ 目录里的那份图标。
_REPO_ROOT = Path(__file__).resolve().parents[2]
_FAVICON_PATH = _REPO_ROOT / "public" / "favicon.ico"
QUIET_SUCCESS_REQUEST_LOGS = IS_PRODUCTION or not settings.DEBUG
ensure_database_ready()


def _log_optional_integrations() -> None:
    """启动时汇总可选外部依赖的配置情况。

    这些能力没配 key 时会自动降级，但降级是静默的，排查时很难发现。
    这里在启动日志里明确列出来，避免「以为配好了其实没配」。
    """
    integrations = [
        ("AI 出题 / 宠物聊天 (DeepSeek)", bool(settings.DEEPSEEK_API_KEY.strip())),
        ("打字语音朗读 (MiniMax TTS)", bool(settings.MINIMAX_API_KEY.strip())),
        ("语音朗读备选 (Qwen TTS)", bool((settings.QWEN_API_KEY or settings.DASHSCOPE_API_KEY).strip())),
    ]
    enabled = [name for name, ok in integrations if ok]
    missing = [name for name, ok in integrations if not ok]

    logger.info("可选功能已启用: %s", "、".join(enabled) if enabled else "无")
    if missing:
        logger.warning(
            "未配置（相关功能会降级）：%s", "、".join(missing)
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_database_ready()
    _log_optional_integrations()
    yield


app = FastAPI(
    title="编程冒险岛 API",
    description="Code Adventure Island Game API",
    version="1.0.0",
    lifespan=lifespan,
    # 文档页走本地离线版（见下面的 /docs 路由），不依赖 swagger-ui 的 CDN
    docs_url=None,
    redoc_url=None,
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# 开发环境允许 localhost 与常见局域网 IP 直连，方便多设备联调；
# 生产环境仍以显式白名单为准，避免放宽跨域范围。
_configured_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
_dev_local_origins = [
    "http://localhost:3000",
    # "null" = 浏览器以 file:// 直接打开本地文档页时的来源，
    # 放行它才能让那份页面读到 openapi.json 并试跑接口（仅开发环境）。
    "null",
    "http://127.0.0.1:3000",
    "http://localhost:3003",
    "http://127.0.0.1:3003",
]
_dev_private_origin_regex = (
    r"^https?://(?:(?:localhost|127\.0\.0\.1)|(?:10(?:\.\d{1,3}){3})|(?:192\.168(?:\.\d{1,3}){2})|(?:172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}))(?::\d+)?$"
    if not IS_PRODUCTION
    else None
)

if _configured_origins:
    _cors_origins: list[str] = list(
        dict.fromkeys(_configured_origins + ([] if IS_PRODUCTION else _dev_local_origins))
    )
else:
    _cors_origins = ["*"] if not IS_PRODUCTION else []

_allow_all_origins = len(_cors_origins) == 1 and _cors_origins[0] == "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_dev_private_origin_regex,
    allow_credentials=not _allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

log_level = logging.WARNING if IS_PRODUCTION else logging.INFO
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
# Explicitly pin the root level so this survives deployments where uvicorn has
# already attached handlers (basicConfig becomes a no-op in that case and INFO
# logs from app modules would otherwise leak into production stdout).
logging.getLogger().setLevel(log_level)
logger = logging.getLogger(__name__)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING if IS_PRODUCTION else logging.INFO)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    try:
        response = await call_next(request)
        if not QUIET_SUCCESS_REQUEST_LOGS:
            logger.info("%s %s - %s - %s", request.method, request.url.path, response.status_code, request_id)
        elif response.status_code >= 500:
            logger.error("%s %s - %s - %s", request.method, request.url.path, response.status_code, request_id)
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception as exc:
        logger.error("Request failed: %s %s - %s - %s", request.method, request.url.path, request_id, exc)
        raise



# /docs 的 HTML 里，表单控件必须同时带上 id 和 name，否则 Chrome 的问题面板会报
# 「表单字段缺少 id 或 name 属性」。这段脚本统一补齐，对本地离线文档页和第三方组件都适用。
_SWAGGER_FIELD_FIX_JS = """<script>
(function () {
  function fix() {
    // Swagger UI 的表单控件（授权弹窗是点开才创建的）必须同时带上 id 和 name，
    // 否则 Chrome 的问题面板会报「表单字段缺少 id 或 name 属性」。
    var nodes = document.querySelectorAll('input, select, textarea');
    var seq = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.id) {
        seq++;
        el.id = 'swagger-field-' + seq;
      }
      if (!el.getAttribute('name')) {
        el.setAttribute('name', el.id);
      }
    }
  }
  try {
    new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', fix);
})();
</script>"""


def _clean_headers(response) -> dict:
    """复制响应头，但去掉改内容后已经失效的 content-length / content-encoding。"""
    return {
        key: value
        for key, value in response.headers.items()
        if key.lower() not in ("content-length", "content-encoding")
    }


@app.middleware("http")
async def patch_swagger_docs(request: Request, call_next):
    """/docs 页面补上缺失的 id/name；其它请求原样透传。"""
    if request.method != "GET" or request.url.path.rstrip("/") != "/docs":
        return await call_next(request)

    response = await call_next(request)
    if response.status_code != 200:
        return response

    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
    html = b"".join(chunks).decode("utf-8", errors="replace")
    if "</body>" not in html:
        return HTMLResponse(html, status_code=response.status_code, headers=_clean_headers(response))

    html = html.replace("</body>", _SWAGGER_FIELD_FIX_JS + "\n</body>")
    return HTMLResponse(html, status_code=response.status_code, headers=_clean_headers(response))


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "message": exc.detail,
            "detail": exc.detail,
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    friendly_errors: list[str] = []
    for err in exc.errors():
        message = err.get("msg", "参数有误")
        if "Value error," in message:
            message = message.split("Value error,", 1)[-1].strip()
        friendly_errors.append(message)

    if not IS_PRODUCTION:
        logger.warning("Validation error %s - %s: %s", request.url.path, request_id, exc.errors())
    fallback = "请求参数不正确，请检查输入后重试"
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "message": friendly_errors[0] if len(friendly_errors) == 1 else fallback,
            "detail": fallback,
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    logger.exception("Unhandled error %s %s - %s", request.method, request.url.path, request_id)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "服务器繁忙，请稍后再试",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


app.include_router(auth.router, prefix="/api/v1/auth", tags=["认证"])
app.include_router(users.router, prefix="/api/v1/users", tags=["用户"])
app.include_router(tasks.router, prefix="/api/v1/tasks", tags=["任务"])
app.include_router(battles.router, prefix="/api/v1/battles", tags=["对战"])
app.include_router(battle_ws.router, prefix="/api/v1/battles", tags=["对战 WebSocket"])
app.include_router(leaderboard.router, prefix="/api/v1/leaderboard", tags=["排行榜"])
app.include_router(achievements.router, prefix="/api/v1/achievements", tags=["成就"])
app.include_router(world.router, prefix="/api/v1/world", tags=["开放世界"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["后台管理"])
app.include_router(progress.router, prefix="/api/v1/progress", tags=["游戏进度"])
app.include_router(pvp.router, prefix="/api/v1/pvp", tags=["PVP 三轮制"])
app.include_router(pvp_battle_royale.router, prefix="/api/v1/pvp-br", tags=["PVP Battle Royale"])
app.include_router(chat.router, prefix="/api/v1/chat", tags=["聊天系统"])
app.include_router(pets.router, prefix="/api/v1/pets", tags=["宠物系统"])
app.include_router(interactions.router, prefix="/api/v1/pets", tags=["宠物互动"])
app.include_router(food.router, prefix="/api/v1/food", tags=["食物系统"])
app.include_router(decorations.router, prefix="/api/v1/decorations", tags=["装饰系统"])
app.include_router(coins.router, prefix="/api/v1", tags=["金币系统"])
app.include_router(workshop.router, prefix="/api/v1/workshop", tags=["创意工坊"])
app.include_router(daily.router, prefix="/api/v1/daily", tags=["每日签到"])
app.include_router(custom_levels.router, prefix="/api/v1", tags=["自定义关卡"])
app.include_router(community.router, prefix="/api/v1", tags=["社区关卡"])
app.include_router(pet_chat.router, prefix="/api/v1/ai", tags=["宠物 AI 聊天"])
app.include_router(learning_assistant.router, prefix="/api/v1/ai/learning-assistant", tags=["AI Learning Assistant"])
app.include_router(user_questions.router, prefix="/api/v1/user-questions", tags=["用户题库"])
app.include_router(ai_questions.router, prefix="/api/v1/ai/questions", tags=["AI 出题"])
app.include_router(typing.router, prefix="/api/typing", tags=["typing"])
app.include_router(launcher.router, prefix="/api/v1/launcher", tags=["本地桌面版启动器"])


@app.get("/")
async def root():
    payload = {
        "message": "欢迎来到编程冒险岛！",
        "version": "1.0.0",
    }
    if not IS_PRODUCTION:
        payload["docs"] = "/docs"
    return payload


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """浏览器会自动请求 /favicon.ico，不提供的话每个页面都报 404。"""
    if _FAVICON_PATH.is_file():
        return FileResponse(_FAVICON_PATH, media_type="image/x-icon")
    return Response(status_code=204)


# 本地离线版接口文档：自带完整页面，不依赖 swagger-ui / redoc 的 CDN，
# 机器断网时依然能正常查看接口说明、参数与响应。
_API_DOCS_HTML = Path(__file__).resolve().parent / "static" / "api-docs.html"


if not IS_PRODUCTION:

    @app.get("/docs", include_in_schema=False)
    async def local_api_docs():
        """本地离线版 API 文档页。"""
        if not _API_DOCS_HTML.is_file():
            raise HTTPException(status_code=404, detail="本地 API 文档文件缺失")
        return FileResponse(_API_DOCS_HTML, media_type="text/html; charset=utf-8")

    @app.get("/redoc", include_in_schema=False)
    async def local_redoc():
        """ReDoc 依赖 CDN，这里统一跳到本地文档页。"""
        return RedirectResponse(url="/docs")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
