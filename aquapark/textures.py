"""程序化贴图。

游戏里用到的贴图全部在运行时用 numpy + PIL 算出来，不依赖任何图片文件。
好处是仓库里不用塞二进制资源，换分辨率也不会糊。
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
from PIL import Image


def water_texture(size=(128, 256)) -> Image.Image:
    """水面流动贴图。

    图案是几条**沿着水流方向拉长**的亮纹，并且随着 ``v`` 方向缓慢摆动。
    把这个贴图的 v 偏移持续往下滚，看起来就是水在往下滑。
    """
    width, height = size
    u = np.linspace(0.0, 1.0, width)[None, :]
    v = np.linspace(0.0, 1.0, height)[:, None]

    # 亮纹沿流向拉长，同时随流向摆动
    wobble = 0.28 * np.sin(math.tau * 2.0 * v) + 0.13 * np.sin(math.tau * 5.0 * v)
    streak = np.abs(np.sin(math.pi * (u * 9.0 + wobble)))
    # 对比度要低：这张图会铺满整个滑槽，条纹太明显的话槽壁也会跟着花
    value = 0.94 + 0.06 * streak

    # 叠加一点细碎的高光颗粒
    rng = np.random.default_rng(20240917)
    grain = rng.random((height, width)) * 0.025
    value = np.clip(value + grain, 0.0, 1.0)

    rgb = (value * 255).astype(np.uint8)
    # 必须是 RGBA：Ursina 的 Texture 一律按 FRgba 分配显存，RGB 会被读成错乱数据
    alpha = np.full(rgb.shape, 255, dtype=np.uint8)
    rgba = np.dstack([rgb, rgb, rgb, alpha])
    return Image.fromarray(rgba, mode="RGBA")


def checker_texture(size=(128, 64), squares=8) -> Image.Image:
    """黑白格纹（终点横幅 / 起跑门）。"""
    width, height = size
    cell = max(1, width // squares)
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    for row in range(height):
        for col in range(width):
            if (row // cell + col // cell) % 2 == 0:
                arr[row, col] = (255, 255, 255, 255)
    return Image.fromarray(arr, mode="RGBA")


def banner_texture(width=256, height=64) -> Image.Image:
    """彩虹横幅（拱门顶部的布条）。"""
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    palette = [
        (255, 90, 110),
        (255, 180, 60),
        (255, 235, 90),
        (90, 220, 140),
        (90, 190, 255),
        (180, 130, 255),
    ]
    for col in range(width):
        color = palette[(col * len(palette)) // width]
        arr[:, col] = (*color, 255)
    # 上下各留一条白边
    arr[:4, :] = (255, 255, 255, 255)
    arr[-4:, :] = (255, 255, 255, 255)
    return Image.fromarray(arr, mode="RGBA")


def soft_circle_texture(size=64) -> Image.Image:
    """柔边圆点（用来做水雾 / 光斑）。"""
    radius = size / 2.0
    ys, xs = np.mgrid[0:size, 0:size]
    distance = np.sqrt((xs - radius + 0.5) ** 2 + (ys - radius + 0.5) ** 2) / radius
    alpha = np.clip(1.0 - distance, 0.0, 1.0) ** 1.6
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    arr[:, :, :3] = 255
    arr[:, :, 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGBA")


def make_texture(image: Image.Image, filtering: str = "mipmap"):
    """把 PIL 图片包成 Ursina 的 Texture。

    注意：用了 mipmap 过滤**必须**自己生成 mipmap 链，否则采样会得到全透明，
    整个面片就等于「消失」了。生成失败就退回线性过滤。
    """
    from ursina import Texture

    texture = Texture(image, filtering=filtering)
    if filtering == "mipmap":
        try:
            texture._texture.generateRamMipmapImages()
        except Exception:  # pragma: no cover - 老版本 Panda3D 没有这个接口
            texture.filtering = "linear"
    return texture
def purple_checker_texture(size=256, cells=8) -> Image.Image:
    """紫色棋盘格背景（收集环节的底纹）。"""
    cell = size // cells
    rows = np.arange(size)[:, None] // cell
    cols = np.arange(size)[None, :] // cell
    light = (rows + cols) % 2 == 0
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    arr[light] = (104, 52, 130, 255)
    arr[~light] = (92, 44, 116, 255)
    return Image.fromarray(arr, mode="RGBA")


