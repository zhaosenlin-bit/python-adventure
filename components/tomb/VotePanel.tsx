"use client";

/**
 * 石门表决
 *
 * 集齐 3 条线索后，石门不会自己打开——它只认"人"。
 * 全队（活着的 NPC + 你）各投一票，被票出的人留在门里。
 *
 * 你的票有分量：呈堂一条已验证线索 +0.5，呈堂一条被证伪的线索 −0.5，
 * 而且后者会让别人把怀疑落到你身上。所以"解谜拿到的线索"在这里才真正变成武器。
 */

import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, Gavel, Scale, Vote } from "lucide-react";

import { CLUES, type TombState } from "@/lib/tomb/rules";
import { NPC_NAMES, NPC_TITLES } from "@/lib/tomb/dialogue";
import { assessClues, extractTrustStatements } from "@/lib/tomb/deduction";
import {
    CITATION_LIMIT,
    castVotes,
    livingNpcIds,
    playerVoteWeight,
    previewSentiment,
    voteTargetName,
    type VoteResult,
    type VoteTarget,
} from "@/lib/tomb/vote";
import type { DialogueEntry } from "./DialoguePanel";

interface VotePanelProps {
    state: TombState;
    clueIds: string[];
    logs: Record<string, DialogueEntry[]>;
    reason: "gate" | "timeup";
    onResult: (result: VoteResult) => void;
}

const VERDICT_BADGE = {
    genuine: { label: "已验真", className: "bg-emerald-400/15 text-emerald-200" },
    forged: { label: "已被证伪", className: "bg-rose-400/15 text-rose-200" },
    unverified: { label: "真伪待验", className: "bg-white/10 text-slate-400" },
} as const;

type Stage = "ballot" | "counting" | "verdict";

export default function VotePanel({ state, clueIds, logs, reason, onResult }: VotePanelProps) {
    const [stage, setStage] = useState<Stage>("ballot");
    const [ballot, setBallot] = useState<VoteTarget | null>(null);
    const [cited, setCited] = useState<string[]>([]);
    const [result, setResult] = useState<VoteResult | null>(null);
    const [revealed, setRevealed] = useState(0);

    const living = livingNpcIds(state);
    const statements = useMemo(() => extractTrustStatements(logs), [logs]);
    const assessments = useMemo(() => assessClues(clueIds, statements), [clueIds, statements]);
    const forced = state.forcedClueIds ?? [];
    const sentiment = useMemo(() => previewSentiment(state), [state]);

    const verdictOf = (clueId: string) =>
        forced.includes(clueId)
            ? ("unverified" as const)
            : (assessments.find((item) => item.clueId === clueId)?.verdict ?? "unverified");

    const citations = cited.map((clueId) => ({
        clueId,
        verdict: verdictOf(clueId),
    }));
    const weight = playerVoteWeight(citations);

    const toggleCite = (clueId: string) => {
        setCited((prev) => {
            if (prev.includes(clueId)) return prev.filter((id) => id !== clueId);
            if (prev.length >= CITATION_LIMIT) return prev;
            return [...prev, clueId];
        });
    };

    const submit = (target: VoteTarget | "abstain") => {
        const next = castVotes({ state, playerBallot: target, citations });
        setResult(next);
        setRevealed(0);
        setStage("counting");
    };

    // 逐票揭晓
    useEffect(() => {
        if (stage !== "counting" || !result) return;
        if (revealed >= result.records.length) {
            const timer = setTimeout(() => setStage("verdict"), 420);
            return () => clearTimeout(timer);
        }
        const timer = setTimeout(() => setRevealed((count) => count + 1), 520);
        return () => clearTimeout(timer);
    }, [stage, revealed, result]);

    const collectedClues = CLUES.filter((clue) => clueIds.includes(clue.id));
    const maxScore = result ? Math.max(0.5, ...result.tallies.map((item) => item.score)) : 1;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6">
            <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-amber-300/30 bg-[#0b0906]/97 shadow-[0_30px_90px_rgba(0,0,0,0.8)]">
                {/* 标题 */}
                <div className="flex items-start justify-between gap-3 border-b border-amber-300/20 bg-amber-950/40 px-4 py-3">
                    <div>
                        <div className="flex items-center gap-2 text-amber-300">
                            <Scale size={18} />
                            <h2 className="font-pixel text-lg">石门表决</h2>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
                            {reason === "timeup"
                                ? "倒计时归零，你们只能站在石门前把话说完。石门只记录票数，不记录沉默。"
                                : "石门只认人：被票出的人留在门里，其余人走出去。"}
                        </p>
                    </div>
                    <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400">
                        在场 {living.length} 人 + 你
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {stage === "ballot" && (
                        <div className="space-y-3">
                            {/* 现场与风向 */}
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                    <div className="text-xs text-slate-400">现场的人</div>
                                    <ul className="mt-2 space-y-1.5">
                                        {living.map((id) => (
                                            <li key={id} className="flex items-baseline justify-between gap-2 text-sm">
                                                <span className="text-slate-200">{NPC_NAMES[id]}</span>
                                                <span className="text-[11px] text-slate-500">{NPC_TITLES[id]}</span>
                                            </li>
                                        ))}
                                        {state.deadNpcs.length > 0 && (
                                            <li className="mt-1 border-t border-white/10 pt-1.5 text-[11px] text-rose-300/70">
                                                已死：{state.deadNpcs.map((id) => NPC_NAMES[id]).join("、")}
                                            </li>
                                        )}
                                    </ul>
                                    {state.playerKills.length > 0 && (
                                        <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-950/30 px-2 py-1.5 text-[11px] leading-relaxed text-rose-200">
                                            你亲手杀过 {state.playerKills.length} 个人。这件事所有人都记得，他们的票会往你身上偏。
                                        </p>
                                    )}
                                </div>

                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                    <div className="text-xs text-slate-400">投票前的风向</div>
                                    <ul className="mt-2 space-y-1.5 text-xs">
                                        {sentiment.map((item) => (
                                            <li key={item.voter} className="flex items-baseline justify-between gap-2">
                                                <span className="text-slate-300">{NPC_NAMES[item.voter]}</span>
                                                <span className="text-slate-500">
                                                    目光落在{" "}
                                                    <b className="text-amber-200">{voteTargetName(item.target)}</b>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                        风向只是他们此刻的成见，不是最终票型。他们嘴上说投谁，手上未必照做。
                                    </p>
                                </div>
                            </div>

                            {/* 投票 */}
                            <div>
                                <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                                    <Vote size={13} />
                                    你的一票投给谁
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {[...living, "player" as VoteTarget].map((target) => {
                                        const active = ballot === target;
                                        return (
                                            <button
                                                key={target}
                                                type="button"
                                                onClick={() => setBallot(target)}
                                                className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                                                    active
                                                        ? "border-amber-300/60 bg-amber-400/15 text-amber-100"
                                                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-amber-300/35"
                                                }`}
                                            >
                                                {voteTargetName(target)}
                                                {target === "player" && (
                                                    <span className="ml-1 text-[11px] text-slate-500">（投自己）</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 呈堂线索 */}
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                                    <span>呈堂证据（最多 {CITATION_LIMIT} 条）</span>
                                    <span className="text-amber-200/80">当前票重 ×{weight.toFixed(1)}</span>
                                </div>
                                {collectedClues.length === 0 ? (
                                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
                                        你手里一条线索都没有。这一票只是一句空话。
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {collectedClues.map((clue) => {
                                            const verdict = verdictOf(clue.id);
                                            const active = cited.includes(clue.id);
                                            const badge = VERDICT_BADGE[verdict];
                                            return (
                                                <li key={clue.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleCite(clue.id)}
                                                        className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                                                            active
                                                                ? "border-amber-300/50 bg-amber-400/10"
                                                                : "border-white/10 bg-white/[0.03] hover:border-white/25"
                                                        }`}
                                                    >
                                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-slate-300">
                                                                碎片 {CLUES.findIndex((item) => item.id === clue.id) + 1}
                                                            </span>
                                                            <span className={`rounded px-1.5 py-0.5 ${badge.className}`}>
                                                                {badge.label}
                                                            </span>
                                                            {forced.includes(clue.id) && (
                                                                <span className="rounded bg-rose-400/15 px-1.5 py-0.5 text-rose-200">
                                                                    蛮力撬开
                                                                </span>
                                                            )}
                                                            {active && <CheckCircle2 size={13} className="text-amber-300" />}
                                                        </div>
                                                        <p className="mt-1 text-xs leading-relaxed text-slate-300">
                                                            {clue.text}
                                                        </p>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                {statements.length === 0 && (
                                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                        你还没问出可信证词，线索真伪只能标成「待验」——待验的线索不给你加票重。
                                    </p>
                                )}
                                {cited.some((id) => verdictOf(id) === "forged") && (
                                    <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                                        警告：你正在拿一条已经被证伪的线索指认别人。这会让所有人觉得你在栽赃。
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {stage !== "ballot" && result && (
                        <div className="space-y-2">
                            <div className="rounded-xl border border-amber-300/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
                                {result.note}
                            </div>

                            {result.records.slice(0, revealed).map((record, index) => (
                                <div
                                    key={`${record.voter}-${index}`}
                                    className={`rounded-xl border px-3 py-2 ${
                                        record.voter === "player"
                                            ? "border-amber-300/40 bg-amber-400/10"
                                            : "border-white/10 bg-white/[0.03]"
                                    }`}
                                >
                                    <div className="flex items-baseline justify-between gap-2 text-sm">
                                        <span className="text-slate-200">
                                            {voteTargetName(record.voter)}
                                            <span className="mx-1.5 text-slate-500">→</span>
                                            <b className="text-amber-200">{voteTargetName(record.target)}</b>
                                        </span>
                                        {record.weight !== 1 && (
                                            <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-200">
                                                票重 ×{record.weight.toFixed(1)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                        「{record.line}」
                                    </p>
                                </div>
                            ))}

                            {revealed < result.records.length && (
                                <p className="pt-1 text-center text-[11px] text-slate-500">正在揭票…</p>
                            )}
                        </div>
                    )}

                    {stage === "verdict" && result && (
                        <div className="mt-3 space-y-3">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                                    <Gavel size={13} />
                                    票型
                                </div>
                                <ul className="space-y-1.5">
                                    {result.tallies.map((item) => (
                                        <li key={item.target} className="text-xs">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-slate-300">{voteTargetName(item.target)}</span>
                                                <span className="tabular-nums text-slate-500">
                                                    {item.ballots} 票 · {item.score.toFixed(1)} 分
                                                </span>
                                            </div>
                                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                                                <div
                                                    className={`h-full rounded-full ${
                                                        item.target === result.condemned ? "bg-rose-400" : "bg-amber-400/60"
                                                    }`}
                                                    style={{ width: `${Math.round((item.score / maxScore) * 100)}%` }}
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div
                                className={`rounded-xl border px-4 py-3 ${
                                    result.condemned
                                        ? "border-rose-400/40 bg-rose-950/40"
                                        : "border-white/15 bg-white/[0.04]"
                                }`}
                            >
                                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">表决结果</div>
                                <p className="mt-1 font-pixel text-lg text-amber-100">
                                    {result.condemned
                                        ? `${voteTargetName(result.condemned)} 被留在门里`
                                        : "票数咬死 · 僵局"}
                                </p>
                                {result.tieAtTop && result.condemned && (
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        平票，是你那一票把结论压了下来。
                                    </p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => onResult(result)}
                                className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
                            >
                                推开石门
                            </button>
                        </div>
                    )}
                </div>

                {stage === "ballot" && (
                    <div className="border-t border-white/10 px-4 py-3">
                        <button
                            type="button"
                            disabled={!ballot}
                            onClick={() => ballot && submit(ballot)}
                            className={`w-full rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                                ballot
                                    ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                                    : "cursor-not-allowed bg-slate-800 text-slate-500"
                            }`}
                        >
                            {ballot ? `提交表决 · 指认 ${voteTargetName(ballot)}` : "先选一个人"}
                        </button>
                        <button
                            type="button"
                            onClick={() => submit("abstain")}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                        >
                            <Ban size={12} />
                            弃权（不投票，结果可能变成僵局）
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
