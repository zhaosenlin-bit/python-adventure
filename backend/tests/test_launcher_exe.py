"""启动器「优先跑打包好的桌面版 exe」的自动化测试。

背景：主程序 `PythonAdventureIsland.exe` 里没有 ursina / panda3d，
所以桌面版 3D 打字闯关要单独打一个 `Game3DTyping.exe`。
启动器找到它就应该直接跑它，而不是再去找 Python 解释器。

这些用例不碰真实磁盘上的打包产物，全部在临时目录里造假 exe，
所以在没打过包的机器上也能跑。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import launcher as launcher_module
from app.main import app

SPEC = launcher_module.GAMES["3d-typing"]


@pytest.fixture
def fake_dist(tmp_path: Path, monkeypatch):
    """造一个 dist/Game3DTyping/Game3DTyping.exe，并让启动器只认这个目录。"""
    monkeypatch.delenv("GAME3D_EXE", raising=False)
    monkeypatch.setattr(launcher_module, "_exe_roots", lambda: [tmp_path])
    # 源码目录也指到临时路径，免得读到仓库里真实的 pid 文件
    monkeypatch.setattr(
        launcher_module,
        "_game_dir",
        lambda spec: tmp_path / spec["package"],
    )

    game_dir = tmp_path / "Game3DTyping"
    game_dir.mkdir(parents=True)
    exe = game_dir / "Game3DTyping.exe"
    exe.write_bytes(b"MZ fake exe")
    return tmp_path, exe


def test_find_exe_returns_packaged_exe(fake_dist):
    _root, exe = fake_dist
    found = launcher_module._find_exe(SPEC)
    assert found is not None
    assert found == exe


def test_find_exe_is_none_without_packaged_build(tmp_path, monkeypatch):
    monkeypatch.delenv("GAME3D_EXE", raising=False)
    monkeypatch.setattr(launcher_module, "_exe_roots", lambda: [tmp_path])
    assert launcher_module._find_exe(SPEC) is None


def test_available_without_interpreter_when_exe_exists(fake_dist, monkeypatch):
    """有 exe 就不该再去探测 Python 解释器（探测一次要十几秒）。"""

    def explode(_spec):
        raise AssertionError("有 exe 时不该找解释器")

    monkeypatch.setattr(launcher_module, "_find_interpreter", explode)
    available, reason = launcher_module._game_available(SPEC)
    assert available is True
    assert reason == ""


def test_launch_starts_the_exe(fake_dist, monkeypatch):
    _root, exe = fake_dist
    captured: dict = {}

    class FakeProcess:
        pid = 777

    def fake_popen(command, **kwargs):
        captured["command"] = list(command)
        captured["kwargs"] = kwargs
        return FakeProcess()

    monkeypatch.setattr(launcher_module.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(
        launcher_module, "_find_interpreter", lambda _spec: (None, "no python")
    )

    client = TestClient(app)
    response = client.post("/api/v1/launcher/3d-typing")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["started"] is True
    assert payload["pid"] == 777
    assert captured["command"] == [str(exe)]
    assert Path(captured["kwargs"]["cwd"]) == exe.parent


def test_pid_file_lives_next_to_the_exe(fake_dist):
    """pid 文件写在 exe 旁边，这样打包版也能判断「已经在运行」。"""
    _root, exe = fake_dist
    pid_path = exe.parent / ".game3d.pid"
    pid_path.write_text(str(os.getpid()), encoding="utf-8")

    assert launcher_module._read_pid(SPEC) == os.getpid()
