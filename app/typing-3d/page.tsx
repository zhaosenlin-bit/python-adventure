import type { Metadata, Viewport } from "next";

import Typing3DGame from "@/components/typing3d/Typing3DGame";

export const metadata: Metadata = {
    title: "3D 打字闯关 · 编程冒险岛",
    description: "在 3D 场景里闯关打字：探索、答题、开门、进入下一关。题目每天更新。",
};

// 根布局为了像素世界用了 initial-scale=0.5，3D 游戏这里要按真实比例显示。
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: "#070b1d",
};

export default function Typing3DPage() {
    return <Typing3DGame />;
}
