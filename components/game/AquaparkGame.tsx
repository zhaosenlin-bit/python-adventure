"use client";

/**
 * 「水乐园大乱斗」（Aquapark.io 复刻）的站内页面。
 *
 * 这个游戏和「3D 打字闯关」桌面版一样，是 Ursina 写的**本地桌面程序**，
 * 不是网页游戏。所以本页面的职责是：
 *
 * 1. 介绍玩法、放截图；
 * 2. 提供一个「启动游戏」按钮，POST 后端启动器把游戏窗口拉起来。
 *
 * 启动器只在本地环境可用（线上服务器没有显示器），所以拿不到启动器接口时
 * 不会给用户一个点了没反应的死按钮，而是把原因写清楚。
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    CircleAlert,
    Coins,
    Droplets,
    Gamepad2,
    Gem,
    Play,
    Sparkles,
    Ticket,
    Trophy,
    Waves,
} from "lucide-react";

const LAUNCHER_URL = "/api/v1/launcher/aquapark";

const HIGHLIGHTS = [
    {
        icon: Waves,
        title: "巨型水滑梯",
        body: "每次开局都会生成一条全新的滑梯：坡度会越来越陡，弯道一个接一个。",
    },
    {
        icon: Droplets,
        title: "踩水柱腾空",
        body: "喷泉会把你弹到空中，滞空时还能继续转向——飞得越远，落点越刁钻。",
    },
    {
        icon: Trophy,
        title: "俯冲撞飞对手",
        body: "从空中俯冲砸中别人，就能把他撞出水面淘汰掉。",
    },
    {
        icon: Sparkles,
        title: "收集与抽卡",
        body: "遮阳伞、章鱼、魔术师……集齐六件收藏品，还能开稀有礼包。",
    },
];

const CONTROLS = [
    ["转向", "A / D　← →　鼠标左右　手柄左摇杆"],
    ["起跳", "空格　W　↑　鼠标左键　手柄 A"],
    ["俯冲", "S　↓　手柄 B"],
    ["返回", "Esc"],
];

type LauncherState = {
    available: boolean;
    reason: string;
    running: boolean;
};

export default function AquaparkGame() {
    const router = useRouter();
    const [state, setState] = useState<LauncherState | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(LAUNCHER_URL, { method: "GET" })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                setState({
                    available: Boolean(data.available),
                    reason: String(data.reason ?? ""),
                    running: Boolean(data.running),
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setState({
                        available: false,
                        reason: "连不上本地启动服务",
                        running: false,
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const launch = useCallback(async () => {
        setBusy(true);
        setMessage(null);
        try {
            const response = await fetch(LAUNCHER_URL, { method: "POST" });
            const data = await response.json().catch(() => ({}));
            if (data?.already_running) {
                setMessage("游戏已经在运行了，切换到窗口就能玩");
            } else if (data?.started) {
                setMessage("游戏窗口已启动，切换到窗口就能玩");
                setState((current) => (current ? { ...current, running: true } : current));
            } else {
                setMessage(String(data?.detail ?? "启动失败"));
            }
        } catch {
            setMessage("启动失败：连不上后端");
        } finally {
            setBusy(false);
        }
    }, []);

    const shots = [
        { src: "/aquapark/race.png", alt: "比赛中：六名选手在滑道上竞速", caption: "竞速" },
        { src: "/aquapark/collection.png", alt: "收集环节：收藏品卡与稀有礼包", caption: "收集" },
        { src: "/aquapark/menu.png", alt: "主菜单：滑梯起点与六名选手", caption: "主菜单" },
    ];

    return (
        <main className="min-h-screen bg-gradient-to-b from-[#0a0e27] via-[#1a1e3e] to-[#0a0e27] text-white">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
                <header className="mb-6 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        返回首页
                    </button>
                    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                        <Waves className="h-4 w-4" />
                        本地桌面游戏（Ursina）
                    </span>
                </header>

                <section className="mb-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                    <div>
                        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
                            水乐园大乱斗
                        </h1>
                        <p className="mb-5 text-sm leading-relaxed text-white/70">
                            复刻 Poki 上的《Aquapark.io》（Voodoo 制作）。从巨型水滑梯顶端出发，
                            游泳加速、踩水柱腾空，空中俯冲把对手撞出水面淘汰——
                            谁先冲到底，谁就是冠军。
                        </p>

                        <div className="mb-4 flex flex-wrap gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-amber-100">
                                <Coins className="h-3.5 w-3.5" />
                                金币 / 钻石 / 票
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-300/30 bg-pink-400/10 px-3 py-1.5 text-pink-100">
                                <Gem className="h-3.5 w-3.5" />
                                稀有礼包
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/30 bg-teal-400/10 px-3 py-1.5 text-teal-100">
                                <Ticket className="h-3.5 w-3.5" />
                                本地存档
                            </span>
                        </div>

                        {state?.running ? (
                            <div className="mb-4 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                                游戏已经在运行了，切换到游戏窗口就能玩。
                            </div>
                        ) : null}

                        {state && !state.available ? (
                            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>
                                    这台机器上还跑不了桌面版：{state.reason || "启动器不可用"}。
                                    在仓库根目录执行 <code className="rounded bg-black/30 px-1 py-0.5">pip install -r aquapark/requirements.txt</code>{" "}
                                    之后重新启动后端即可。
                                </span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={launch}
                                disabled={busy || state?.running}
                                data-testid="aquapark-launch-button"
                                className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/40 bg-cyan-400/20 px-6 py-3 text-base font-semibold text-cyan-50 shadow-cyan-500/20 transition hover:bg-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Play className="h-5 w-5" />
                                {busy ? "正在启动…" : "启动游戏窗口"}
                            </button>
                        )}

                        {message ? (
                            <p className="mt-3 text-xs text-white/60" data-testid="aquapark-launch-status">
                                {message}
                            </p>
                        ) : null}

                        <p className="mt-4 text-[11px] leading-relaxed text-white/40">
                            桌面版是本地程序，不联网、不上传任何数据；
                            进度存在游戏目录下的 aquapark_save.json 里，跨局保留。
                        </p>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-2xl">
                        <Image
                            src="/aquapark/race.png"
                            alt="六名选手在巨型水滑梯上竞速"
                            width={1280}
                            height={720}
                            priority
                            className="h-auto w-full"
                        />
                    </div>
                </section>

                <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {HIGHLIGHTS.map((item) => (
                        <article
                            key={item.title}
                            className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-cyan-300/25 hover:bg-white/10"
                        >
                            <item.icon className="mb-3 h-5 w-5 text-cyan-300" />
                            <h2 className="mb-1.5 text-sm font-semibold">{item.title}</h2>
                            <p className="text-xs leading-relaxed text-white/60">{item.body}</p>
                        </article>
                    ))}
                </section>

                <section className="mb-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                            <Gamepad2 className="h-4 w-4 text-teal-300" />
                            操作
                        </h2>
                        <dl className="space-y-2.5 text-xs">
                            {CONTROLS.map(([label, keys]) => (
                                <div key={label} className="flex items-start gap-3">
                                    <dt className="w-10 shrink-0 text-white/45">{label}</dt>
                                    <dd className="text-white/80">{keys}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        {shots.map((shot) => (
                            <figure
                                key={shot.src}
                                className="overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                            >
                                <Image
                                    src={shot.src}
                                    alt={shot.alt}
                                    width={1280}
                                    height={720}
                                    className="h-auto w-full"
                                />
                                <figcaption className="px-3 py-2 text-center text-[11px] text-white/55">
                                    {shot.caption}
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
