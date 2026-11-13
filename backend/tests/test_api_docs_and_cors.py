"""接口文档页与跨域白名单的自动化测试。

这两块以前只有手写的 Playwright 脚本，跑完就删，回归全靠人肉。
这里把它们固定成 pytest 用例：

* `/docs` 必须是本地离线页面 —— 不许引用任何 CDN 资源；
* `/docs` 里的表单控件必须同时带 id 和 name（Chrome 的问题面板会检查）；
* `/redoc` 要跳到 `/docs`，不能指向依赖 CDN 的 ReDoc；
* 开发环境要放行 file:// 页面（来源是 "null"）、本地前端和局域网设备，
  同时挡住陌生来源。
"""

import importlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

DOCS_HTML = Path(__file__).resolve().parents[1] / "app" / "static" / "api-docs.html"

client = TestClient(app)


@pytest.fixture(scope="module")
def cors_client():
    """重新加载 app.main，让跨域白名单只包含测试想要的来源。

    不这么做的话，开发机上的 .env 可能带着自己的 CORS_ORIGINS，
    断言就没法稳定复现了。

    注意要改的是 settings 对象而不是环境变量：settings 在 app.core.config
    导入时就已经实例化完了，再改 os.environ 是不生效的。
    """
    from app.core.config import settings

    previous = settings.CORS_ORIGINS
    settings.CORS_ORIGINS = "http://example.test"
    try:
        module = importlib.reload(importlib.import_module("app.main"))
        with TestClient(module.app) as scoped_client:
            yield scoped_client
    finally:
        settings.CORS_ORIGINS = previous


def test_docs_page_is_served_and_contains_the_offline_ui():
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    body = response.text
    assert "发送请求" in body
    assert "openapi.json" in body
    assert "去授权" in body


def test_docs_page_never_loads_anything_from_the_internet():
    """断网也能看文档：页面里不能出现任何外网脚本 / 样式 / 图片。"""
    html = DOCS_HTML.read_text(encoding="utf-8")
    assert "swagger-ui" not in html
    assert "cdn" not in html.lower()
    external = re.findall(r'(?:src|href)=["\'](https?://[^"\']+)["\']', html)
    assert external == [], f"文档页引用了外网资源: {external}"


def test_docs_form_controls_all_have_id_and_name():
    """Chrome 的「问题」面板会报「表单字段缺少 id 或 name 属性」。"""
    html = DOCS_HTML.read_text(encoding="utf-8")
    controls = re.findall(r"<(?:input|select|textarea)\b[^>]*>", html)
    assert controls, "文档页里应该有表单控件"
    for control in controls:
        assert re.search(r'\bid=["\'][^"\']+["\']', control), f"缺少 id: {control}"
        assert re.search(r'\bname=["\'][^"\']+["\']', control), f"缺少 name: {control}"


def test_docs_response_injects_the_field_fixer_script():
    """后端中间件会往 /docs 里追加一段补 id/name 的兜底脚本。"""
    response = client.get("/docs")
    assert "swagger-field-" in response.text


def test_redoc_redirects_to_the_local_docs_page():
    response = client.get("/redoc", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/docs"


def test_openapi_schema_is_available_in_development():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["openapi"].startswith("3.")
    assert "/health" in schema["paths"]


def test_cors_allows_the_configured_origin(cors_client):
    response = cors_client.get("/health", headers={"Origin": "http://example.test"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://example.test"


def test_cors_allows_file_protocol_origin_for_the_offline_docs(cors_client):
    """用 file:// 直接打开文档页时，浏览器发过来的来源是字符串 "null"。"""
    response = cors_client.get("/health", headers={"Origin": "null"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "null"


def test_cors_allows_local_frontend_and_lan_devices(cors_client):
    for origin in (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.1.20:5173",
    ):
        response = cors_client.get("/health", headers={"Origin": origin})
        assert response.status_code == 200, origin
        assert response.headers.get("access-control-allow-origin") == origin


def test_cors_blocks_unknown_origin(cors_client):
    response = cors_client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_for_the_local_frontend_is_allowed(cors_client):
    response = cors_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
