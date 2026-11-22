"use client";

/** 结局结算界面 */

import { ENDINGS, type EndingId } from "@/lib/tomb/rules";
import { NPC_NAMES, type NpcId } from "@/lib/tomb/dialogue";
import { voteTargetName, type VoteResult } from "@/lib/tomb/vote";

interface EndingOverlayProps {
    ending: EndingId;
    clueCount: number;
    deadNpcs: NpcId[];
    playerImpostor: boolean;
    identityKnown: boolean;
    /** 走过石门表决的话，把票型也带进结算 */
    vote?: VoteResult | null;
    onRestart: () => void;
    onExit: () => void;
}

export default function EndingOverlay({
    ending,
    clueCount,
    deadNpcs,
    playerImpostor,
    identityKnown,
    vote,
    onRestart,
    onExit,
}: EndingOverlayProps) {
    const definition = ENDINGS[ending];
    const good = definition.tone === "good";

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div
                className={`w-full max-w-xl overflow-hidden rounded-3xl border shadow-[0_30px_90px_rgba(0,0,0,0.8)] ${
                    good ? "border-emerald-300/30 bg-[#080f0c]/95" : "border-rose-400/30 bg-[#120708]/95"
                }`}
            >
                <div
                    className={`px-6 py-5 text-center ${
                        good
                            ? "bg-gradient-to-b from-emerald-500/20 to-transparent"
                            : "bg-gradient-to-b from-rose-500/20 to-transparent"
                    }`}
                >
                    <div className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
                        结局达成
                    </div>
                    <h2
                        className={`mt-1 font-pixel text-3xl ${
                            good ? "text-emerald-300" : "text-rose-300"
                        }`}
                    >
                        {definition.title}
                    </h2>
                    <div
                        className={`mt-2 inline-block rounded-full px-3 py-1 text-xs ${
                            good
                                ? "bg-emerald-400/15 text-emerald-200"
                                : "bg-rose-400/15 text-rose-200"
                        }`}
                    >
                        成就 · {definition.achievement}
                    </div>
                </div>

                <div className="px-6 py-5">
                    <p className="text-sm leading-7 text-slate-200">{definition.text}</p>

                    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                            <dt className="text-slate-500">收集线索</dt>
                            <dd className="mt-0.5 text-slate-200">{clueCount} / 5</dd>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                            <dt className="text-slate-500">你的真实身份</dt>
                            <dd className="mt-0.5 text-slate-200">
                                {identityKnown ? (playerImpostor ? "伪人" : "好人") : "未知"}
                            </dd>
                        </div>
                    </dl>

                    {deadNpcs.length > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                            死者：{deadNpcs.map((id) => NPC_NAMES[id]).join("、")}
                        </p>
                    )}

                    {vote && vote.tallies.length > 0 && (
                        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[11px] text-slate-500">
                                石门表决 ·{" "}
                                {vote.condemned
                                    ? `${voteTargetName(vote.condemned)} 被票出`
                                    : "没有结论（僵局）"}
                                {vote.tieAtTop && vote.condemned === vote.playerBallot ? "（平票由你那票裁定）" : ""}
                            </div>
                            <ul className="mt-1 space-y-0.5">
                                {vote.tallies.map((item) => {
                                    const condemned = item.target === vote.condemned;
                                    return (
                                        <li
                                            key={item.target}
                                            className={`flex justify-between text-[11px] ${
                                                condemned ? "text-rose-200" : "text-slate-400"
                                            }`}
                                        >
                                            <span className="flex items-center gap-1">
                                                {voteTargetName(item.target)}
                                                {condemned && (
                                                    <span className="rounded bg-rose-400/15 px-1 py-0.5 text-[10px] text-rose-200">
                                                        票出
                                                    </span>
                                                )}
                                            </span>
                                            <span className="tabular-nums">
                                                {item.ballots} 票 · {item.score.toFixed(1)} 分
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button
                            type="button"
                            onClick={onRestart}
                            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
                        >
                            再来一局
                        </button>
                        <button
                            type="button"
                            onClick={onExit}
                            className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-slate-200 transition-colors hover:bg-white/15"
                        >
                            返回首页
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
