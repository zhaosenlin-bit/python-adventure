"""中文字体解析。

Panda3D 加载字体有两条硬性限制：

1. **不能**用带盘符的绝对路径（``C:\\Windows\\Fonts\\msyh.ttc`` 会被当成
   模型路径解析并报错）；
2. 文件名要么已经在 Panda3D 的 ``model-path`` 里，要么是相对于当前工作目录
   的相对路径。

所以这里的做法是：在系统字体目录里找一个带中文字形的字体（微软雅黑 / 黑体 /
苹方 / Noto CJK ...），把字体所在目录注册进 Panda3D 的 ``model-path``，
之后直接按文件名加载，并把 Ursina 的 ``Text.default_font`` 换掉，
这样后面创建的每一个文字实体都直接用中文字体。

找不到中文字体时不会崩，游戏会自动切换成英文文案（见 ``T()``）。

本模块是独立实现，不依赖 ``game3d`` 包，整个 ``aquapark`` 可以单独拿走运行。
"""

from __future__ import annotations

import builtins
import os
import shutil
from typing import Optional

# 常见系统中文字体，按优先级排列
_CJK_FONT_CANDIDATES = [
    # Windows
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyh.ttf",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\msjh.ttc",
    # macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    # Linux
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]

# 只用来显示 ASCII 的备用字体（找不到中文字体时也不至于完全没有字）
_LATIN_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\consola.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]

_PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
_FONT_CACHE_DIR = os.path.join(_PACKAGE_DIR, ".fontcache")

# 解析结果：成功时是字体文件名（相对 Panda3D 的 model-path），失败时是 None
UI_FONT: Optional[str] = None
HAS_CJK = False
_INITIALIZED = False


# --------------------------------------------------------------------- 工具


def _model_path():
    """拿到 Panda3D 的 model-path（没有 Panda3D 时返回 None）。"""
    try:
        from panda3d.core import getModelPath

        return getModelPath()
    except Exception:  # pragma: no cover - 没有装 Panda3D 的环境
        return None


def _register_folder(folder: str) -> None:
    """把字体目录登记到 Panda3D 的 model-path，之后可以按文件名加载。"""
    if not folder:
        return
    model_path = _model_path()
    if model_path is None:
        return
    try:
        for index in range(model_path.getNumDirectories()):
            existing = model_path.getDirectory(index)
            if os.path.normcase(existing) == os.path.normcase(folder):
                return
    except Exception:  # pragma: no cover - 老版本 API 差异
        pass
    try:
        model_path.appendPath(folder)
    except Exception:  # pragma: no cover
        pass


def _font_loads(reference: str) -> bool:
    """真正加载一次字体，验证这个引用能不能用。"""
    loader = getattr(builtins, "loader", None)
    if loader is None:
        # 还没有创建 Ursina 窗口（没有 loader），先认为可用，运行时再兜底
        return True
    try:
        font = loader.loadFont(reference, okMissing=True)
    except Exception:
        return False
    return font is not None


def _copy_into_cache(source: str) -> Optional[str]:
    """把字体复制到 .fontcache 目录，返回复制后的绝对路径（兜底用）。"""
    try:
        os.makedirs(_FONT_CACHE_DIR, exist_ok=True)
        target = os.path.join(_FONT_CACHE_DIR, os.path.basename(source))
        if not os.path.exists(target) or os.path.getsize(target) != os.path.getsize(source):
            shutil.copyfile(source, target)
        return target
    except OSError:
        return None


def _relative_to_cwd(path: str) -> Optional[str]:
    """把绝对路径转成相对当前工作目录的相对路径（兜底用）。"""
    try:
        rel = os.path.relpath(path, os.getcwd())
    except ValueError:
        # 跨盘符（C: -> D:）时 relpath 会抛异常
        return None
    # Panda3D 只认 Unix 风格路径（反斜杠会被当成文件名的一部分）
    return rel.replace("\\", "/")


def _resolve(candidate: str) -> Optional[str]:
    """把一个字体文件的绝对路径变成 ``Text(font=...)`` 能吃的引用。

    优先用「文件名 + model-path」；实在不行才复制到 .fontcache 用相对路径。
    """
    if not os.path.exists(candidate):
        return None

    folder = os.path.dirname(os.path.abspath(candidate))
    _register_folder(folder)

    name = os.path.basename(candidate)
    if _font_loads(name):
        return name

    # 兜底：复制一份到游戏目录，用相对路径加载
    cached = _copy_into_cache(candidate)
    if cached:
        rel = _relative_to_cwd(cached)
        if rel and _font_loads(rel):
            return rel
    return None


def _apply_default_font() -> None:
    """把 Ursina 的默认字体换掉，后面新建的 Text 直接就是中文字体。"""
    if not UI_FONT:
        return
    try:
        from ursina import Text

        Text.default_font = UI_FONT
    except Exception:  # pragma: no cover - 没有 Ursina 环境时忽略
        pass


# --------------------------------------------------------------------- 对外


def setup_fonts() -> Optional[str]:
    """初始化字体，返回可用的字体引用（找不到中文字体时返回 None）。"""
    global UI_FONT, HAS_CJK, _INITIALIZED
    if _INITIALIZED:
        return UI_FONT

    for candidates, is_cjk in (
        (_CJK_FONT_CANDIDATES, True),
        (_LATIN_FONT_CANDIDATES, False),
    ):
        for candidate in candidates:
            reference = _resolve(candidate)
            if not reference:
                continue
            UI_FONT = reference
            HAS_CJK = is_cjk
            _INITIALIZED = True
            _apply_default_font()
            return UI_FONT

    # 一个都没找到：保持 Ursina 自带字体，文案切英文
    UI_FONT = None
    HAS_CJK = False
    _INITIALIZED = True
    return UI_FONT


def current_font() -> Optional[str]:
    """随时拿到当前字体（必要时才做一次初始化）。

    模块之间不能直接 ``from .fonts import UI_FONT`` —— 那样拿到的是导入那一刻
    的快照，``setup_fonts()`` 之后再改全局变量就来不及了。所有地方都应该走
    这个函数拿字体。
    """
    if UI_FONT is None and not _INITIALIZED:
        setup_fonts()
    return UI_FONT


def T(chinese: str, english: str) -> str:
    """按是否有中文字体选择文案。"""
    return chinese if HAS_CJK else english
