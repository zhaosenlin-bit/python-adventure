"""桌面版（exe）静态站点托管。

线上部署是「Next.js 服务器 + Nginx 反代」，桌面版没有 Node，
所以由 FastAPI 直接托管 ``next build --output export`` 产出的静态文件。

这里要复刻 next.config.ts 里 rewrites() 的 **afterFiles** 语义：
Next 的数组形式 rewrites 是「先看文件系统有没有，没有才走重写」，
所以 ``/assets/player/player.png`` 命中的是 public/assets/，
而 ``/data/catalog.json`` 因为 public/ 里没有，才会重写到 /typing/data/。
顺序反了的话，世界地图里的角色贴图会全部 404。
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, Response

# (URL 前缀, 重写目标前缀)
REWRITE_MAP: tuple[tuple[str, str], ...] = (
    ("data", "typing/data"),
    ("game-res", "typing/game-res"),
    ("assets", "typing/assets"),
)

# 注入到 HTML 里的运行时配置。桌面版端口可能是动态选的，
# 前端构建时把端口写死成 NEXT_PUBLIC_API_PORT，所以运行时再覆盖一次。
RUNTIME_CONFIG_SCRIPT = (
    "<script>window.__CODE_ADVENTURE_API_PORT__={port};"
    "window.__CODE_ADVENTURE_API_ORIGIN__=window.location.origin;</script>"
)


def _safe_join(root: Path, relative: str) -> Path | None:
    """把 URL 路径拼到根目录下，并挡掉 ../ 越权访问。"""
    relative = relative.lstrip("/")
    if not relative:
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def _resolve_file(root: Path, url_path: str) -> Path | None:
    """按 Next 的 afterFiles 顺序找文件：原始路径 → .html → /index.html → 重写。"""
    raw = url_path.split("?", 1)[0].split("#", 1)[0]
    relative = raw.strip("/")

    candidates: list[Path] = []
    if relative:
        candidates.append(_safe_join(root, relative))
        candidates.append(_safe_join(root, f"{relative}.html"))
        candidates.append(_safe_join(root, f"{relative}/index.html"))
        for prefix, target in REWRITE_MAP:
            if relative == prefix or relative.startswith(f"{prefix}/"):
                tail = relative[len(prefix):].lstrip("/")
                candidates.append(_safe_join(root, f"{target}/{tail}"))
                candidates.append(_safe_join(root, f"{target}/{tail}/index.html"))
    else:
        candidates.append(_safe_join(root, "index.html"))

    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    return None


def _inject_runtime_config(html: str, port: int) -> str:
    script = RUNTIME_CONFIG_SCRIPT.format(port=port)
    if "</head>" in html:
        return html.replace("</head>", f"{script}</head>", 1)
    return script + html


def _drop_backend_root_route(app: FastAPI) -> None:
    """去掉后端自己的 GET / 欢迎页。

    它在 main.py 里注册得很早，会抢在静态站点前面命中，
    结果浏览器拿到的是一段 JSON 而不是游戏首页。
    """
    app.router.routes[:] = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == "/"
            and "GET" in (getattr(route, "methods", None) or set())
        )
    ]


def mount_frontend(app: FastAPI, web_root: Path, api_port: int | None = None) -> None:
    """把静态站点挂到 app 的最后（所有 /api 路由都要先注册）。"""

    if not web_root.is_dir():
        raise RuntimeError(f"静态资源目录不存在: {web_root}")

    _drop_backend_root_route(app)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str) -> Response:
        file_path = _resolve_file(web_root, full_path)
        if file_path is None:
            return HTMLResponse("<h1>404 Not Found</h1>", status_code=404)

        media_type, _ = mimetypes.guess_type(str(file_path))
        if file_path.suffix.lower() in (".html", ".htm"):
            html = file_path.read_text(encoding="utf-8", errors="replace")
            if api_port:
                html = _inject_runtime_config(html, api_port)
            return HTMLResponse(html, status_code=200)

        return FileResponse(file_path, media_type=media_type or "application/octet-stream")
