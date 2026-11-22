"use client";

/** 3D 古墓剧本杀 · 主界面 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    BookOpen,
    ChevronLeft,
    Crosshair,
    Flame,
    Skull,
    Sparkles,
    X,
} from "lucide-react";

import { TombEngine, type HudState } from "./engine";
import DialoguePanel, { type DialogueEntry } from "./DialoguePanel";
import IntroScreen from "./IntroScreen";
import TouchControls from "./TouchControls";
import NotesPanel from "./NotesPanel";
import EndingOverlay from "./EndingOverlay";
import CodeChallengeModal from "./CodeChallengeModal";
import VotePanel from "./VotePanel";
import { NPC_NAMES, type NpcId } from "@/lib/tomb/dialogue";
import { CLUES, REQUIRED_CLUES, type EndingId, type TombState } from "@/lib/tomb/rules";
import {
    CHALLENGE_REWARD_SECONDS,
    FORCE_OPEN_SECONDS,
    getCodeChallenge,
    type ClueCodeChallenge,
} from "@/lib/tomb/codeChallenges";
import { voteEnding, type VoteResult } from "@/lib/tomb/vote";
import usePyodide from "@/hooks/usePyodide";

type Phase = "intro" | "playing" | "ended";

interface VoteSession {
    state: TombState;
    reason: "gate" | "timeup";
}

const EMPTY_HUD: HudState = {
    timeLeft: 240,
    clueIds: [],
    prompt: null,
    promptKind: null,
    promptNpc: null,
    promptClueId: null,
    threat: 0,
    identityKnown: false,
    playerImpostor: false,
    deadNpcs: [],
};

export default function TombGame() {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<TombEngine | null>(null);

    const [phase, setPhase] = useState<Phase>("intro");
    const [ready, setReady] = useState(false);
    const [hud, setHud] = useState<HudState>(EMPTY_HUD);
    const [talkingTo, setTalkingTo] = useState<NpcId | null>(null);
    const [showNotes, setShowNotes] = useState(false);
    const [logs, setLogs] = useState<Record<string, DialogueEntry[]>>({});
    const [ending, setEnding] = useState<EndingId | null>(null);
    const [toast, setToast] = useState<{ text: string; tone: "info" | "danger" | "good" } | null>(null);
    const [attackTarget, setAttackTarget] = useState<NpcId | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    /** 当前打开的线索编程关卡 */
    const [codeChallenge, setCodeChallenge] = useState<ClueCodeChallenge | null>(null);
    /** 石门表决：局面快照 + 触发原因 */
    const [voteSession, setVoteSession] = useState<VoteSession | null>(null);
    /** 表决结果，结算界面要显示票型 */
    const [voteResult, setVoteResult] = useState<VoteResult | null>(null);

    // 提前把 Python 运行时拉起来，玩家摸到线索机关时不用干等 wasm
    usePyodide(phase === "playing");
    const logIdRef = useRef(0);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((text: string, tone: "info" | "danger" | "good" = "info") => {
        setToast({ text, tone });
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToast(null), 3600);
    }, []);

    // ---------------------------------------------------------------- 引擎
    const startGame = useCallback(async () => {
        setPhase("playing");
        setEnding(null);
        setLogs({});
        setTalkingTo(null);
        setShowNotes(false);
        setReady(false);
        setCodeChallenge(null);
        setVoteSession(null);
        setVoteResult(null);

        engineRef.current?.dispose();
        engineRef.current = null;

        await new Promise((resolve) => setTimeout(resolve, 30));
        const node = containerRef.current;
        if (!node) return;

        const engine = new TombEngine(node, {
            onHud: (state) => setHud(state),
            onEnding: (result) => {
                setEnding(result);
                setPhase("ended");
                setTalkingTo(null);
                setShowNotes(false);
            },
            onClue: (clue) => {
                showToast(`拾取线索：${clue.text}`, "good");
            },
            onKill: (npc) => {
                showToast(`你袭击了 ${NPC_NAMES[npc]}`, "danger");
            },
            onIdentity: (_isImpostor, text) => {
                showToast(text, "danger");
            },
            onWarning: (text) => {
                showToast(text, "danger");
            },
            onVotePrompt: (reason) => {
                // 石门表决：引擎已经停摆，这里只负责把局面交给投票面板
                setCodeChallenge(null);
                setTalkingTo(null);
                setShowNotes(false);
                setVoteSession({ state: engine.getStateSnapshot(), reason });
            },
        });
        engineRef.current = engine;
        await engine.init();
        setReady(true);
    }, [showToast]);

    useEffect(() => {
        return () => {
            engineRef.current?.dispose();
            engineRef.current = null;
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    // ------------------------------------------------------------- 交互动作
    const doInteract = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const target = engine.getInteractable();
        if (!target) return;

        if (target.kind === "talk" && target.npc) {
            setTalkingTo(target.npc);
            engine.setPaused(true);
            return;
        }
        if (target.kind === "clue" && target.clueId) {
            // 线索要先破解对应的编程机关，通过了才真的拿到手
            const challenge = getCodeChallenge(target.clueId);
            if (!challenge) {
                engine.pickUpClue(target.clueId);
                return;
            }
            engine.setPaused(true);
            setCodeChallenge(challenge);
            return;
        }
        if (target.kind === "gate") {
            if (hud.clueIds.length >= REQUIRED_CLUES) {
                // 线索够了，但石门不会自己开：先过全队表决这一关
                engine.beginVote();
                return;
            }
            showToast(`石门纹丝不动，需要 ${REQUIRED_CLUES} 条线索`, "info");
        }
    }, [hud.clueIds.length, showToast]);

    const askQuestion = useCallback(
        (question: string) => {
            const engine = engineRef.current;
            if (!engine || !talkingTo) return;
            const reply = engine.ask(talkingTo, question);
            const entry: DialogueEntry = {
                id: logIdRef.current++,
                question,
                answer: reply.text,
                kind: reply.kind,
            };
            setLogs((prev) => ({
                ...prev,
                [talkingTo]: [...(prev[talkingTo] ?? []), entry],
            }));
        },
        [talkingTo],
    );

    const closeDialogue = useCallback(() => {
        setTalkingTo(null);
        engineRef.current?.setPaused(false);
    }, []);

    const requestAttack = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        // 对话中优先袭击正在对话的对象：距离够就行，不必先转身瞄准
        const target = engine.getAttackTarget(talkingTo);
        if (!target) {
            showToast("附近没有可以袭击的目标", "info");
            return;
        }
        setAttackTarget(target);
    }, [showToast, talkingTo]);

    const confirmAttack = useCallback(() => {
        const engine = engineRef.current;
        const target = attackTarget;
        setAttackTarget(null);
        if (!engine || !target) return;
        engine.attack(target);
        closeDialogue();
    }, [attackTarget, closeDialogue]);

    const toggleNotes = useCallback(() => {
        setShowNotes((prev) => {
            const next = !prev;
            engineRef.current?.setPaused(next || talkingTo !== null);
            return next;
        });
    }, [talkingTo]);

    // 关闭编程关卡（放弃 / 取消）
    const closeCodeChallenge = useCallback(() => {
        setCodeChallenge(null);
        engineRef.current?.setPaused(false);
    }, []);

    // 编程关卡通过 → 真正拾取这条线索，机关回赠时间
    const completeCodeChallenge = useCallback(() => {
        const clueId = codeChallenge?.clueId;
        setCodeChallenge(null);
        engineRef.current?.setPaused(false);
        if (!clueId) return;
        engineRef.current?.pickUpClue(clueId);
        engineRef.current?.addSeconds(CHALLENGE_REWARD_SECONDS);
        showToast(`机关认输，回赠 ${CHALLENGE_REWARD_SECONDS} 秒`, "good");
    }, [codeChallenge, showToast]);

    // 蛮力撬开：拿得到线索，但扣时间，而且表决时不能当证据
    const forceOpenCodeChallenge = useCallback(() => {
        const clueId = codeChallenge?.clueId;
        setCodeChallenge(null);
        engineRef.current?.setPaused(false);
        if (!clueId) return;
        engineRef.current?.addSeconds(-FORCE_OPEN_SECONDS);
        engineRef.current?.pickUpClue(clueId, { forced: true });
        showToast(`蛮力撬开，扣掉 ${FORCE_OPEN_SECONDS} 秒；这条线索不能当证据`, "danger");
    }, [codeChallenge, showToast]);

    // 表决出结果 → 落到对应结局
    const finishVote = useCallback(
        (result: VoteResult) => {
            if (!voteSession) return;
            setVoteResult(result);
            setEnding(voteEnding(voteSession.state, result));
            setVoteSession(null);
            setTalkingTo(null);
            setShowNotes(false);
            setPhase("ended");
            engineRef.current?.markVerdictEnded();
        },
        [voteSession],
    );

    // -------------------------------------------------------------- 键盘
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (phase !== "playing") return;
            const key = event.key.toLowerCase();

            // 编程关卡开着的时候，所有按键都让给代码输入框
            if (codeChallenge) {
                if (key === "escape") {
                    event.preventDefault();
                    closeCodeChallenge();
                }
                return;
            }

            // 表决面板开着时，键盘全部让给面板
            if (voteSession) return;

            if (key === "tab") {
                event.preventDefault();
                toggleNotes();
                return;
            }

            // 袭击确认弹窗优先处理：F / Enter 动手，Esc 取消
            if (attackTarget) {
                if (key === "f" || key === "enter") {
                    event.preventDefault();
                    confirmAttack();
                } else if (key === "escape") {
                    event.preventDefault();
                    setAttackTarget(null);
                }
                return;
            }

            if (key === "escape") {
                if (showNotes) {
                    toggleNotes();
                } else if (talkingTo) {
                    closeDialogue();
                }
                return;
            }
            if (showNotes) return;
            if (key === "e") {
                event.preventDefault();
                doInteract();
            } else if (key === "f") {
                event.preventDefault();
                requestAttack();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        phase,
        doInteract,
        requestAttack,
        confirmAttack,
        toggleNotes,
        closeDialogue,
        showNotes,
        talkingTo,
        attackTarget,
        codeChallenge,
        closeCodeChallenge,
        voteSession,
    ]);

    // ---------------------------------------------------------------- UI
    const minutes = Math.floor(hud.timeLeft / 60);
    const seconds = hud.timeLeft % 60;
    const timeLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const urgent = hud.timeLeft <= 60;

    if (phase === "intro") {
        return <IntroScreen onStart={startGame} onExit={() => router.push("/")} />;
    }

    return (
        <div className="relative h-[100dvh] w-full overflow-hidden bg-[#07060c] text-slate-100">
            <div ref={containerRef} className="absolute inset-0" />

            {/* 危险暗角 */}
            {hud.threat > 0.15 && (
                <div
                    className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
                    style={{
                        opacity: Math.min(0.85, hud.threat),
                        boxShadow: "inset 0 0 180px 40px rgba(190, 20, 30, 0.55)",
                    }}
                />
            )}

            {/* 顶部 HUD */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 sm:p-4">
                <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                    <div
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur ${
                            urgent
                                ? "border-rose-400/45 bg-rose-950/70 text-rose-200"
                                : "border-amber-300/25 bg-black/60 text-amber-100"
                        }`}
                    >
                        <Flame className={`h-4 w-4 ${urgent ? "animate-pulse" : ""}`} />
                        <span className="font-pixel text-lg tabular-nums">{timeLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-xl border border-amber-300/25 bg-black/60 px-3 py-2 text-xs text-amber-100 backdrop-blur">
                        <Sparkles className="h-4 w-4" />
                        线索 {hud.clueIds.length}/{CLUES.length}
                    </div>
                    {hud.deadNpcs.length > 0 && (
                        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-400/30 bg-black/60 px-3 py-2 text-xs text-rose-200 backdrop-blur">
                            <Skull className="h-4 w-4" />
                            死亡 {hud.deadNpcs.map((id) => NPC_NAMES[id]).join("、")}
                        </div>
                    )}
                </div>

                <div className="pointer-events-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={toggleNotes}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-300/25 bg-black/60 px-3 py-2 text-xs text-amber-100 backdrop-blur transition-colors hover:border-amber-300/50"
                    >
                        <BookOpen className="h-4 w-4" />
                        推理板
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowHelp((prev) => !prev)}
                        className="whitespace-nowrap rounded-xl border border-amber-300/25 bg-black/60 px-3 py-2 text-xs text-amber-100 backdrop-blur transition-colors hover:border-amber-300/50"
                    >
                        玩法
                    </button>
                    <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="rounded-xl border border-white/15 bg-black/60 p-2 text-slate-300 backdrop-blur transition-colors hover:bg-white/15"
                        aria-label="返回首页"
                        title="返回首页"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* 玩法速查 */}
            {showHelp && (
                <div className="pointer-events-auto absolute right-3 top-16 z-30 w-72 rounded-2xl border border-amber-300/25 bg-black/90 p-4 text-xs leading-relaxed text-slate-300 backdrop-blur sm:right-4 sm:top-20">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="font-pixel text-sm text-amber-200">操作说明</span>
                        <button type="button" onClick={() => setShowHelp(false)}>
                            <span className="sr-only">关闭操作说明</span>
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <ul className="space-y-1.5">
                        <li><b className="text-amber-200">W A S D / 方向键</b> 移动，按住 Shift 奔跑</li>
                        <li><b className="text-amber-200">拖动鼠标</b> 转动视角（点击画面可锁定鼠标）</li>
                            <li><b className="text-amber-200">E</b> 交谈 / 解谜拿线索 / 推石门</li>
                        <li><b className="text-amber-200">F</b> 袭击面前的 NPC（需二次确认）</li>
                        <li><b className="text-amber-200">Tab</b> 打开推理板，<b className="text-amber-200">Esc</b> 关闭面板</li>
                    </ul>
                </div>
            )}

            {/* 交互提示 */}
            {hud.prompt && !talkingTo && !showNotes && (
                <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
                    <div className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-black/75 px-4 py-2 text-sm text-amber-100 backdrop-blur">
                        <Crosshair className="h-4 w-4" />
                        {hud.prompt}
                        <kbd className="rounded bg-amber-300/20 px-1.5 py-0.5 text-[11px]">E</kbd>
                    </div>
                </div>
            )}

            {/* 提示条 */}
            {toast && (
                <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
                    <div
                        className={`max-w-xl rounded-xl border px-4 py-2 text-sm backdrop-blur ${
                            toast.tone === "danger"
                                ? "border-rose-400/45 bg-rose-950/80 text-rose-100"
                                : toast.tone === "good"
                                  ? "border-emerald-300/40 bg-emerald-950/80 text-emerald-100"
                                  : "border-white/15 bg-black/80 text-slate-200"
                        }`}
                    >
                        {toast.text}
                    </div>
                </div>
            )}

            {/* 袭击确认 */}
            {attackTarget && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-rose-400/35 bg-[#120708]/95 p-5 text-center">
                        <h3 className="font-pixel text-lg text-rose-200">确认袭击</h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-300">
                            你要袭击 <b className="text-rose-200">{NPC_NAMES[attackTarget]}</b>。
                            <br />
                            如果他是好人，队伍就永远少了一个人。
                            <br />
                            动手之后，没有收回的余地。
                        </p>
                        <div className="mt-4 flex justify-center gap-3">
                            <button
                                type="button"
                                onClick={confirmAttack}
                                className="rounded-xl bg-rose-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
                            >
                                动手
                            </button>
                            <button
                                type="button"
                                onClick={() => setAttackTarget(null)}
                                className="rounded-xl border border-white/15 bg-white/5 px-5 py-2 text-sm text-slate-200 transition-colors hover:bg-white/15"
                            >
                                取消
                            </button>
                        </div>
                        <p className="mt-3 text-xs text-slate-400">
                            按 <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-pixel text-rose-200">F</kbd> 或{" "}
                            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-pixel text-rose-200">Enter</kbd>{" "}
                            动手 · 按{" "}
                            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-pixel text-slate-200">Esc</kbd> 取消
                        </p>
                    </div>
                </div>
            )}

            {/* 线索编程机关 */}
            <CodeChallengeModal
                challenge={codeChallenge}
                onClose={closeCodeChallenge}
                onSuccess={completeCodeChallenge}
                onForceOpen={forceOpenCodeChallenge}
            />

            {/* 对话面板 */}
            {talkingTo && !showNotes && (
                <DialoguePanel
                    npc={talkingTo}
                    entries={logs[talkingTo] ?? []}
                    onAsk={askQuestion}
                    onClose={closeDialogue}
                    canAttack={engineRef.current?.getAttackTarget(talkingTo) === talkingTo}
                    onAttack={requestAttack}
                />
            )}

            {/* 推理板 */}
            {showNotes && (
                <NotesPanel
                    clueIds={hud.clueIds}
                    logs={logs}
                    onClose={() => {
                        setShowNotes(false);
                        engineRef.current?.setPaused(talkingTo !== null);
                    }}
                />
            )}

            {/* 石门表决 */}
            {voteSession && phase === "playing" && (
                <VotePanel
                    state={voteSession.state}
                    clueIds={voteSession.state.clueIds}
                    logs={logs}
                    reason={voteSession.reason}
                    onResult={finishVote}
                />
            )}

            {/* 结局 */}
            {phase === "ended" && ending && (
                <EndingOverlay
                    ending={ending}
                    clueCount={hud.clueIds.length}
                    deadNpcs={hud.deadNpcs}
                    playerImpostor={hud.playerImpostor}
                    identityKnown={hud.identityKnown}
                    vote={voteResult}
                    onRestart={startGame}
                    onExit={() => router.push("/")}
                />
            )}

            {!ready && phase === "playing" && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#07060c]">
                    <div className="text-center">
                        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-amber-300/20 border-t-amber-300" />
                        <p className="text-sm text-slate-400">正在生成古墓场景…</p>
                    </div>
                </div>
            )}

            <TouchControls
                onInteract={doInteract}
                onAttack={requestAttack}
                onJoystick={(x, y, active) => engineRef.current?.setJoystick(x, y, active)}
            />
        </div>
    );
}

