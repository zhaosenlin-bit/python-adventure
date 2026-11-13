"""灯光工具。

Ursina 7.0 的 ``Light`` 有两个坑，这里统一处理掉：

1. **没有 ``brightness`` 属性**。``AmbientLight(color=..., brightness=0.5)``
   里的 ``brightness`` 只会变成一个没人读的属性，光照强度完全没变。
   所以这里自己把颜色乘上亮度系数。
2. **点光源没有距离衰减**。Panda3D 的 ``PointLight`` 默认不做衰减，
   房间里几盏灯会把所有墙面一起照爆。这里给每盏灯设置
   ``setAttenuation((1, 0, 1 / radius**2))``，让光在 ``radius`` 处衰减到
   一半，越远越暗。
"""

from __future__ import annotations

from ursina import AmbientLight, PointLight, color

try:  # pragma: no cover - 没装 Panda3D 时保持可导入
    from panda3d.core import Vec3 as _PandaVec3
except Exception:  # pragma: no cover
    _PandaVec3 = None


def scaled_color(rgb, brightness: float = 1.0, alpha: float = 1.0):
    """把 (r, g, b) 和亮度系数合成一个 Ursina 颜色。"""
    return color.rgba(
        max(0.0, rgb[0] * brightness),
        max(0.0, rgb[1] * brightness),
        max(0.0, rgb[2] * brightness),
        alpha,
    )


def _apply_falloff(light: PointLight, radius: float) -> None:
    """给点光源加上平方衰减。"""
    if _PandaVec3 is None or radius <= 0:
        return
    try:
        light._light.setAttenuation(_PandaVec3(1.0, 0.0, 1.0 / (radius * radius)))
    except Exception:  # pragma: no cover - 不同 Panda3D 版本的 API 差异
        pass


def point_light(rgb, brightness: float = 1.0, radius: float = 20.0, **kwargs) -> PointLight:
    """一盏会衰减的点光源。"""
    light = PointLight(color=scaled_color(rgb, brightness), **kwargs)
    _apply_falloff(light, radius)
    return light


def ambient_light(rgb, brightness: float = 1.0, **kwargs) -> AmbientLight:
    """一盏环境光（没有衰减概念，直接把亮度乘进颜色）。"""
    return AmbientLight(color=scaled_color(rgb, brightness), **kwargs)


def set_light_color(light, rgb, brightness: float = 1.0) -> None:
    """运行时改灯的颜色（开门时把门灯点亮就是用这个）。"""
    if light is None:
        return
    try:
        light.color = scaled_color(rgb, brightness)
    except Exception:  # pragma: no cover
        pass
