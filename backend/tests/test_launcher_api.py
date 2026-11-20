"""本地桌面版启动器的自动化测试。

启动器会「在本机拉起进程」，所以它的行为必须可控：

* 只认登记表里的游戏，别的 id 一律 404；
* 生产环境（线上服务器没有显示器）一律 403；
* 状态接口不能因为「找不到解释器」就 500，而要给出人话提示。

这里把解释器探测打桩掉——真的去 ``import ursina`` 要十几秒，
测试里等不起，而且依赖的是开发机环境。
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import launcher as launcher_module
from app.main import app


@pytest.fixture(autouse=True)
def stub_interpreter(monkeypatch, tmp_path):
    """假装本机已经装好依赖，避免测试真的去探测。"""

    def fake_find(spec: dict):
        return ("C:/fake/python.exe", "")

    monkeypatch.setattr(launcher_module, "_find_interpreter", fake_find)
    # 「本机此刻有没有开着游戏窗口」也得打桩：测试不能因为开发者刚好开着一个
    # 游戏窗口就变红。默认当作「没在跑」，需要「已经在跑」的用例自己再改回去。
    monkeypatch.setattr(launcher_module, "_read_pid", lambda spec: None)
    # pid 文件也写到临时目录：测试要是往真仓库里写假 pid，下次跑就会被自己带偏
    # （「已经在运行」的错误判断就是这么来的）。
    monkeypatch.setattr(
        launcher_module,
        "_pid_file",
        lambda spec: tmp_path / f".{spec['package']}.pid",
    )
    # 让「游戏目录存在」这一条也成立（仓库里本来就有这两个包）
    monkeypatch.setattr(
        launcher_module,
        "_game_dir",
        lambda spec: launcher_module._PROJECT_ROOT / spec["package"],
    )


def _reload_app():
    return importlib.import_module("app.main")


client = TestClient(app)


def test_status_reports_both_games():
    for game in ("3d-typing", "aquapark"):
        response = client.get(f"/api/v1/launcher/{game}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["game"] == game
        assert payload["available"] is True
        assert payload["running"] is False


def test_unknown_game_is_404():
    response = client.get("/api/v1/launcher/not-a-game")
    assert response.status_code == 404


def test_launch_returns_pid(monkeypatch):
    class FakeProcess:
        pid = 4242

    monkeypatch.setattr(
        launcher_module.subprocess,
        "Popen",
        lambda *args, **kwargs: FakeProcess(),
    )
    response = client.post("/api/v1/launcher/aquapark")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["started"] is True
    assert payload["already_running"] is False
    assert payload["pid"] == 4242


def test_launch_when_already_running(monkeypatch):
    monkeypatch.setattr(launcher_module, "_read_pid", lambda spec: 999)
    response = client.post("/api/v1/launcher/aquapark")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["already_running"] is True
    assert payload["pid"] == 999


def test_production_environment_is_forbidden(monkeypatch):
    from app.core.config import settings

    previous = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        assert client.get("/api/v1/launcher/aquapark").status_code == 403
        assert client.post("/api/v1/launcher/aquapark").status_code == 403
    finally:
        settings.ENVIRONMENT = previous
