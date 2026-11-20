import type { Metadata } from "next";

import AquaparkGame from "@/components/game/AquaparkGame";

export const metadata: Metadata = {
    title: "水乐园大乱斗 · 编程冒险岛",
    description:
        "复刻 Poki 上的《Aquapark.io》：从巨型水滑梯顶端出发，游泳加速、踩水柱腾空，俯冲把对手撞出水面淘汰。",
};

export default function Page() {
    return <AquaparkGame />;
}
