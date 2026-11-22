"use client";

/** 对话面板：关键词匹配提问，记录每一轮回答 */

import { useEffect, useRef, useState } from "react";
import { NPC_NAMES, NPC_TITLES, type NpcId } from "@/lib/tomb/dialogue";
import type { NpcReply } from "@/lib/tomb/dialogueEngine";

export interface DialogueEntry {
    id: number;
    question: string;
    answer: string;
    kind: NpcReply["kind"];
}

interface DialoguePanelProps {
    npc: NpcId;
    entries: DialogueEntry[];
    onAsk: (question: string) => void;
    onClose: () => void;
    canAttack: boolean;
    onAttack: () => void;
}

const QUICK_QUESTIONS: { label: string; question: string }[] = [
    { label: "你是伪人吗？", question: "你是伪人吗" },
    { label: "队伍里有几个伪人？", question: "队伍里一共有几个伪人" },
    { label: "谁最可疑？", question: "谁最可疑" },
    { label: "线索有被篡改吗？", question: "笔记线索有没有被篡改" },
    { label: "落单会被偷袭吗？", question: "落单会不会被偷袭" },
    { label: "石门怎么打开？", question: "石门要怎么才能打开离开" },
    { label: "你多大了？", question: "你今年几岁" },
    { label: "你叫什么名字？", question: "你的名字是什么" },
];

export default function DialoguePanel({
    npc,
    entries,
    onAsk,
    onClose,
    canAttack,
    onAttack,
}: DialoguePanelProps) {
    const [input, setInput] = useState("");
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = logRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [entries]);

    const submit = () => {
        const question = input.trim();
        if (!question) return;
        onAsk(question);
        setInput("");
    };

    return (
        <div className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-6">
            <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300/25 bg-[#0d0a12]/95 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur">
                <div className="flex items-center justify-between gap-3 border-b border-amber-300/15 px-4 py-2.5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                            <span className="truncate font-pixel text-base text-amber-200">
                                {NPC_NAMES[npc]}
                            </span>
                        </div>
                        <p className="truncate text-[11px] text-slate-400">{NPC_TITLES[npc]}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {canAttack && (
                            <button
                                type="button"
                                onClick={onAttack}
                                className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs text-rose-200 transition-colors hover:bg-rose-500/30"
                            >
                                袭击
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/15"
                        >
                            结束对话 (Esc)
                        </button>
                    </div>
                </div>

                <div
                    ref={logRef}
                    className="max-h-[26vh] min-h-[92px] space-y-2 overflow-y-auto px-4 py-3 text-sm leading-relaxed"
                >
                    {entries.length === 0 && (
                        <p className="text-slate-500">
                            提问只会命中关键词，AI 不会自由发挥。用下面的快捷问题或自己输入。
                        </p>
                    )}
                    {entries.map((entry) => (
                        <div key={entry.id} className="space-y-1">
                            <p className="text-slate-400">你：{entry.question}</p>
                            <p
                                className={
                                    entry.kind === "default"
                                        ? "text-slate-400"
                                        : entry.kind === "casual"
                                          ? "text-sky-200"
                                          : "text-amber-100"
                                }
                            >
                                {NPC_NAMES[npc]}：{entry.answer}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap gap-1.5 border-t border-amber-300/10 px-3 py-2.5">
                    {QUICK_QUESTIONS.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            onClick={() => onAsk(item.question)}
                            className="rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1 text-[11px] text-amber-100/80 transition-colors hover:border-amber-300/50 hover:bg-amber-300/15"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                    className="flex items-center gap-2 border-t border-amber-300/10 px-3 py-2.5"
                >
                    <input
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        placeholder="输入你的问题…"
                        className="min-w-0 flex-1 rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-300/50"
                    />
                    <button
                        type="submit"
                        className="rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
                    >
                        提问
                    </button>
                </form>
            </div>
        </div>
    );
}
