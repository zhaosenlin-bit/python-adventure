"use client";

/**
 * 开局界面。
 *
 * 设计约定：这里只给「能看见的东西」——世界观、操作键位。
 * 身份分布、伪人说谎比例、线索真伪、回赠/撬开的秒数等全部是隐藏设定，
 * 一律不在界面上讲，靠玩家自己在局内摸出来（改文案前先想清楚这一点）。
 */

interface IntroScreenProps {
    onStart: () => void;
    onExit: () => void;
}

export default function IntroScreen({ onStart, onExit }: IntroScreenProps) {
    return (
        <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#07060c] px-4 py-8 text-slate-100">
            <div
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                    background:
                        "radial-gradient(ellipse at 50% 0%, rgba(120,70,30,0.35), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(20,40,70,0.3), transparent 60%)",
                }}
            />

            <div className="relative w-full max-w-3xl">
                <div className="text-center">
                    <div className="text-[11px] uppercase tracking-[0.4em] text-amber-400/70">
                        3D 古墓剧本杀
                    </div>
                    <h1 className="mt-2 font-pixel text-3xl text-amber-100 sm:text-4xl">
                        墓道迷踪 · 谁是伪人
                    </h1>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                        六个人被困在古墓，队伍里混着伪装成人类的伪人。
                        门不会为你打开——问、试、看他们怎么答，然后自己拿主意。
                    </p>
                </div>

                <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-300/15 bg-white/[0.03] p-5 text-center">
                    <p className="text-xs leading-6 text-amber-200/80">
                        墙上没有说明书。墓里发生的一切都要你自己判断。
                    </p>
                </div>

                <div className="mt-7 rounded-2xl border border-white/10 bg-black/40 p-4 text-[11px] leading-6 text-slate-500">
                    <p className="mb-1 text-slate-400">操作：</p>
                    <p>W A S D / 方向键移动（Shift 奔跑） · 拖动鼠标转视角 · E 交谈 / 解谜拿线索 · F 袭击 · Tab 推理板</p>
                    <p className="mt-1">
                        3D 素材来自 polyfork.dev 的免费低多边形模型库（Dungeon &amp; Crypt 等套件）。
                    </p>
                    <p className="mt-1 text-slate-600">联合开发 · 孙铭泽</p>
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <button
                        type="button"
                        onClick={onStart}
                        className="rounded-xl bg-amber-500 px-7 py-3 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
                    >
                        进入古墓
                    </button>
                    <button
                        type="button"
                        onClick={onExit}
                        className="rounded-xl border border-white/15 bg-white/5 px-7 py-3 text-sm text-slate-200 transition-colors hover:bg-white/15"
                    >
                        返回首页
                    </button>
                </div>
            </div>
        </div>
    );
}
