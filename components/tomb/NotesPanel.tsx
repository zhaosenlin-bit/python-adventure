"use client";

/** 推理板：已拾取的线索碎片 + 每个 NPC 的问答记录 */

import { useState } from "react";
import { CLUES, REQUIRED_CLUES } from "@/lib/tomb/rules";
import { NPC_NAMES, NPC_TITLES, type NpcId } from "@/lib/tomb/dialogue";
import { TRUSTED_QUOTES, assessClues, extractTrustStatements } from "@/lib/tomb/deduction";
import type { DialogueEntry } from "./DialoguePanel";

interface NotesPanelProps {
    clueIds: string[];
    logs: Record<string, DialogueEntry[]>;
    onClose: () => void;
}

const NPC_ORDER: NpcId[] = ["gao", "xiaoyuan", "xiaolin", "aze", "laozhang"];

const VERDICT_STYLE = {
    genuine: { label: "判定为真线索", className: "bg-emerald-400/15 text-emerald-200" },
    forged: { label: "判定为伪造", className: "bg-rose-400/15 text-rose-200" },
    unverified: { label: "真伪待验证", className: "bg-white/10 text-slate-400" },
} as const;

export default function NotesPanel({ clueIds, logs, onClose }: NotesPanelProps) {
    const [tab, setTab] = useState<"clues" | "talks">("clues");
    const collected = CLUES.filter((clue) => clueIds.includes(clue.id));
    // 关键词提问拿到的证词 × 已拾取的碎片 → 交叉验证出真伪
    const statements = extractTrustStatements(logs);
    const assessments = assessClues(clueIds, statements);
    const verdictOf = (clueId: string) =>
        assessments.find((item) => item.clueId === clueId)?.verdict ?? "unverified";
    const reasonOf = (clueId: string) =>
        assessments.find((item) => item.clueId === clueId)?.reason ?? "";

    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6">
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-300/25 bg-[#0d0a12]/97 shadow-[0_24px_70px_rgba(0,0,0,0.7)]">
                <div className="flex items-center justify-between gap-3 border-b border-amber-300/15 px-4 py-3">
                    <div>
                        <h2 className="font-pixel text-lg text-amber-200">推理板</h2>
                        <p className="text-xs text-slate-400">
                            线索 {clueIds.length}/5 · 集齐 {REQUIRED_CLUES} 条可开启石门 · 可信证词{" "}
                            {TRUSTED_QUOTES.filter((item) =>
                                statements.some((s) => s.quote === item.quote),
                            ).length}
                            /{TRUSTED_QUOTES.length}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/15"
                    >
                        关闭 (Tab)
                    </button>
                </div>

                <div className="flex gap-1 border-b border-amber-300/10 px-3 pt-2">
                    {(
                        [
                            ["clues", `线索碎片 ${clueIds.length}`],
                            ["talks", "询问记录"],
                        ] as const
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setTab(key)}
                            className={`rounded-t-lg px-3 py-2 text-xs transition-colors ${
                                tab === key
                                    ? "bg-amber-300/12 text-amber-200"
                                    : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {tab === "clues" && (
                        <div className="space-y-2">
                            {collected.length === 0 && (
                                <p className="text-sm text-slate-500">
                                    还没有拾取任何线索。靠近发光的符文地砖按 E 拾取。
                                </p>
                            )}
                            {collected.map((clue) => (
                                <div
                                    key={clue.id}
                                    className="rounded-xl border border-amber-300/18 bg-amber-300/5 px-3 py-2.5"
                                >
                                    <div className="flex items-center gap-2 text-[11px] text-amber-300/80">
                                        <span className="rounded bg-amber-400/15 px-1.5 py-0.5">
                                            {clue.location}
                                        </span>
                                        <span
                                            className={`rounded px-1.5 py-0.5 ${
                                                VERDICT_STYLE[verdictOf(clue.id)].className
                                            }`}
                                        >
                                            {VERDICT_STYLE[verdictOf(clue.id)].label}
                                        </span>
                                    </div>
                                    <p className="mt-1.5 text-sm leading-relaxed text-amber-50/90">
                                        {clue.text}
                                    </p>
                                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                        {reasonOf(clue.id)}
                                    </p>
                                </div>
                            ))}
                            <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
                                提示：同一个问题多问几个人，答案对不上的地方就是破绽。
                                说辞前后打结、每次都不一样的人，更值得盯着。
                            </p>
                        </div>
                    )}

                    {tab === "talks" && (
                        <div className="space-y-3">
                            <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/5 px-3 py-2.5">
                                <div className="text-[11px] text-emerald-300/80">
                                    已记录的证词
                                </div>
                                {statements.length === 0 ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                        还没有。用任务关键词向高教授或小远提问，证词会自动记录在这里。
                                    </p>
                                ) : (
                                    <ul className="mt-1.5 space-y-1">
                                        {statements.map((item, index) => (
                                            <li
                                                key={`${item.quote}-${index}`}
                                                className="text-xs leading-relaxed text-emerald-100/80"
                                            >
                                                {NPC_NAMES[item.source]}：「{item.quote}」
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {NPC_ORDER.map((id) => {
                                const entries = logs[id] ?? [];
                                const distinct = new Set(entries.map((entry) => entry.answer)).size;
                                return (
                                    <div
                                        key={id}
                                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                                    >
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-sm text-slate-200">
                                                {NPC_NAMES[id]}
                                            </span>
                                            <span className="text-[11px] text-slate-500">
                                                {NPC_TITLES[id]} · 已问 {entries.length} 次 · 不同回答{" "}
                                                {distinct} 句
                                            </span>
                                        </div>
                                        {entries.length === 0 ? (
                                            <p className="mt-1 text-xs text-slate-500">
                                                还没有询问过。
                                            </p>
                                        ) : (
                                            <ul className="mt-1.5 space-y-1">
                                                {entries.map((entry) => (
                                                    <li key={entry.id} className="text-xs text-slate-400">
                                                        「{entry.question}」→「{entry.answer}」
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
