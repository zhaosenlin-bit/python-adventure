"""3D 打字闯关（Ursina 桌面版）的打包入口。

PyInstaller 会把这段脚本当成 ``__main__``，这里只负责把真正的入口
``game3d.main:main`` 调起来，顺便处理窗口模式下没有 stdout / stderr 的情况
（打包成 exe 后如果往 stdout 打印东西，Python 会直接抛异常）。

崩溃时把堆栈写到临时目录的 ``game3d-crash.log``，方便排查。
"""

from __future__ import annotations

import os
import sys
import tempfile
import traceback


def _silence_streams() -> None:
    """窗口模式下 stdout / stderr 是 None，先换成丢弃流。"""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            try:
                setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
            except OSError:
                pass


def _log_crash(error: BaseException) -> None:
    try:
        path = os.path.join(tempfile.gettempdir(), "game3d-crash.log")
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(traceback.format_exc() + "\n")
    except OSError:
        pass


def run() -> int:
    _silence_streams()
    try:
        from game3d.main import main
    except Exception:  # pragma: no cover - 打包环境下的兜底
        _log_crash(sys.exc_info()[1] or RuntimeError("import failed"))
        raise
    try:
        return main()
    except SystemExit:
        raise
    except Exception:
        _log_crash(sys.exc_info()[1] or RuntimeError("crashed"))
        raise


if __name__ == "__main__":
    raise SystemExit(run())
