"use client";

/**
 * 3D 打字闯关（网页版）。
 *
 * 玩法：走到发光的答题面板前 → 按 E 打开打字框 → 敲对这一关的题 → 门打开 →
 * 穿过门进入下一关。每天的题目固定，闯完当天所有关卡出结算。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Check,
    Keyboard,
    Loader2,
    RotateCcw,
    Sparkles,
    Target,
    TriangleAlert,
} from "lucide-react";

import {
    TYPING3D_BANK_URL,
    dateKeyFor,
    hashString,
    isAnswerCorrect,
    parseBank,
    prefixMatches,
    remainingTarget,
    selectDailyQuestions,
    targetFor,
} from "@/lib/typing3d/bank";
import { buildLevel } from "@/lib/typing3d/level";
import type { Typing3DInputMode, Typing3DQuestion } from "@/lib/typing3d/types";
import { useAuthStore } from "@/store/authStore";
import { Typing3DEngine, WebGLUnavailableError, type EngineView } from "./engine";

type Phase = "intro" | "spawn" | "playing" | "typing" | "transition" | "paused" | "finished";
type AnswerState = "idle" | "correct" | "wrong";

interface RunStats {
    solved: number;
    wrong: number;
    chars: number;
    startedAt: number;
    bestCombo: number;
    combo: number;
}

const BEST_KEY = "python-island:typing3d:best";

const KIND_TEXT: Record<string, string> = {
    zh: "中文",
    en: "英文",
    code: "代码",
    sym: "符号",
};

function emptyStats(): RunStats {
    return { solved: 0, wrong: 0, chars: 0, startedAt: Date.now(), bestCombo: 0, combo: 0 };
}

function formatTime(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}

export default function Typing3DGame() {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<Typing3DEngine | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const keysRef = useRef<Set<string>>(new Set());
    const levelIndexRef = useRef(0);
    const questionsRef = useRef<Typing3DQuestion[]>([]);
    const phaseRef = useRef<Phase>("intro");
    const joystickRef = useRef({ x: 0, y: 0 });
    const knobRef = useRef<HTMLDivElement | null>(null);
    const statsRef = useRef<RunStats>(emptyStats());
    const openTypingRef = useRef<() => void>(() => {});

    const [phase, setPhase] = useState<Phase>("intro");
    const [loadError, setLoadError] = useState<string | null>(null);
    const [questions, setQuestions] = useState<Typing3DQuestion[]>([]);
    const [engineReady, setEngineReady] = useState(false);
    const [levelIndex, setLevelIndex] = useState(0);
    /** 引擎起不来（比如浏览器没 WebGL）时的一句话提示。 */
    const [engineError, setEngineError] = useState<string | null>(null);
    const [nearPanel, setNearPanel] = useState(false);
    const [typed, setTyped] = useState("");
    const [answerState, setAnswerState] = useState<AnswerState>("idle");
    const [stats, setStats] = useState<RunStats>(emptyStats);
    const [inputMode, setInputMode] = useState<Typing3DInputMode>("pinyin");
    const [view, setView] = useState<EngineView>("third");
    const [best, setBest] = useState<{ solved: number; accuracy: number } | null>(null);
    const [topScores, setTopScores] = useState<
        Array<{ username: string; speed: number; accuracy: number }>
    >([]);
    const { token, user } = useAuthStore();

    /**
     * 成绩上报。
     *
     * * 本地历史（lexiang.typing.history）：打字训练中心的游戏卡片靠它显示最好成绩
     * * 服务端记录（mode=3d-typing）：换台设备也能看到，用独立 mode 避免和
     *   其它游戏（分数单位不一样）混在一个榜单里
     */
    const submitScore = useCallback(
        async (run: { solved: number; wrong: number; chars: number; seconds: number }) => {
            const accuracy =
                run.solved + run.wrong > 0
                    ? Math.round((run.solved / (run.solved + run.wrong)) * 100)
                    : 100;
            const cpm = run.seconds > 0 ? Math.round((run.chars / run.seconds) * 60) : 0;
            const record = {
                mode: "game",
                source: "typing-3d",
                game_id: "typing-3d",
                title: "3D 打字闯关",
                speed: cpm,
                accuracy,
                chars: run.chars,
                seconds: run.seconds,
                date: new Date().toISOString(),
                username: user?.username,
                user_id: user?.id,
            };

            try {
                const key = "lexiang.typing.history";
                const raw = window.localStorage.getItem(key);
                const list = raw ? JSON.parse(raw) : [];
                const history = Array.isArray(list) ? list : [];
                history.push(record);
                window.localStorage.setItem(key, JSON.stringify(history.slice(-300)));
            } catch {
                /* 本地存不下就算了 */
            }

            try {
                await fetch("/api/typing/scores", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...record,
                        mode: "3d-typing",
                        token,
                        user_id: user?.id,
                        username: user?.username,
                    }),
                });
            } catch {
                /* 网络不通就只留本地记录 */
            }
        },
        [token, user],
    );

    // 排行榜（服务端记录，跨设备可见）
    useEffect(() => {
        let cancelled = false;
        fetch("/api/typing/rankings?mode=3d-typing&limit=5")
            .then((response) => (response.ok ? response.json() : null))
            .then((
                payload: {
                    rankings?: Array<{
                        username?: string;
                        speed?: number;
                        accuracy?: number;
                    }>;
                } | null,
            ) => {
                if (cancelled || !Array.isArray(payload?.rankings)) return;
                setTopScores(
                    payload.rankings.slice(0, 5).map((item) => ({
                        username: String(item.username || "学习者"),
                        speed: Number(item.speed || 0),
                        accuracy: Number(item.accuracy || 0),
                    })),
                );
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);
    const [elapsed, setElapsed] = useState(0);
    const [desktopStatus, setDesktopStatus] = useState<string | null>(null);
    const [desktopAvailable, setDesktopAvailable] = useState(false);

    // 桌面版（Ursina）是可选组件：只部署网页版的后端没有这个接口。
    // 暂停面板里才有那个按钮，所以等玩家真的按了暂停再去探测，
    // 探测不到就不显示，别给用户一个点了没反应的死按钮。
    const desktopProbedRef = useRef(false);
    useEffect(() => {
        if (phase !== "paused" || desktopProbedRef.current) return;
        desktopProbedRef.current = true;
        let cancelled = false;
        fetch("/api/v1/launcher/3d-typing", { method: "GET" })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (!cancelled) setDesktopAvailable(Boolean(data?.available));
            })
            .catch(() => {
                if (!cancelled) setDesktopAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, [phase]);
    const [selectedSpawn, setSelectedSpawn] = useState<number | null>(null);

    phaseRef.current = phase;
    levelIndexRef.current = levelIndex;
    questionsRef.current = questions;
    statsRef.current = stats;

    const dateKey = useMemo(() => dateKeyFor(new Date()), []);
    const layout = useMemo(
        () => buildLevel(levelIndex, hashString(`typing3d:${dateKey}`)),
        [levelIndex, dateKey],
    );
    const currentQuestion = questions[levelIndex] ?? null;
    const accuracyNow =
        stats.solved + stats.wrong > 0
            ? Math.round((stats.solved / (stats.solved + stats.wrong)) * 100)
            : 100;

    // ---------------------------------------------------------------- 载入题库

    useEffect(() => {
        let cancelled = false;
        fetch(TYPING3D_BANK_URL, { cache: "force-cache" })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((raw: unknown) => {
                if (cancelled) return;
                const items = parseBank(raw);
                if (!items.length) throw new Error("题库是空的");
                setQuestions(selectDailyQuestions(items, dateKey));
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setLoadError(error instanceof Error ? error.message : "题库加载失败");
            });
        return () => {
            cancelled = true;
        };
    }, [dateKey]);

    // ---------------------------------------------------------------- 结算

    const finishRun = useCallback(() => {
        const final = statsRef.current;
        const finalAccuracy =
            final.solved + final.wrong > 0
                ? Math.round((final.solved / (final.solved + final.wrong)) * 100)
                : 100;
        setPhase("finished");
        setElapsed(Date.now() - final.startedAt);
        try {
            const previous = window.localStorage.getItem(BEST_KEY);
            const previousBest = previous
                ? (JSON.parse(previous) as { solved: number; accuracy: number })
                : null;
            if (!previousBest || final.solved > previousBest.solved) {
                const record = { solved: final.solved, accuracy: finalAccuracy };
                window.localStorage.setItem(BEST_KEY, JSON.stringify(record));
                setBest(record);
            }
        } catch {
            /* 存不下就算了 */
        }

        // 成绩上报：本地历史 + 服务端记录
        void submitScore({
            solved: final.solved,
            wrong: final.wrong,
            chars: final.chars,
            seconds: Math.max(1, Math.round((Date.now() - final.startedAt) / 1000)),
        });
    }, [submitScore]);

    // ---------------------------------------------------------------- 创建引擎

    useEffect(() => {
        if (!questions.length || !containerRef.current) return;

        let engine: Typing3DEngine;
        try {
            engine = new Typing3DEngine(containerRef.current, {
                onNearPanel: (panel) => setNearPanel(Boolean(panel)),
                onSpawnPick: (index) => setSelectedSpawn(index),
                onPanelClick: () => openTypingRef.current(),
                onReachDoor: () => {
                    if (phaseRef.current !== "playing") return;
                    setPhase("transition");
                    window.setTimeout(() => {
                        const next = levelIndexRef.current + 1;
                        if (next >= questionsRef.current.length) {
                            finishRun();
                        } else {
                            setLevelIndex(next);
                            setPhase("playing");
                        }
                    }, 900);
                },
            });
        } catch (error) {
            // 浏览器没 WebGL、显卡驱动有问题：给句人话，别整页白屏
            setEngineError(
                error instanceof WebGLUnavailableError
                    ? "这台设备的浏览器打不开 3D 画面（WebGL）。"
                    : "3D 场景初始化失败，刷新页面重试一下。",
            );
            return;
        }
        engineRef.current = engine;
        setEngineReady(true);

        try {
            const saved = window.localStorage.getItem(BEST_KEY);
            if (saved) setBest(JSON.parse(saved) as { solved: number; accuracy: number });
        } catch {
            /* 本地存储不可用就当没有历史成绩 */
        }

        return () => {
            engine.dispose();
            engineRef.current = null;
            setEngineReady(false);
        };
    }, [questions.length]);

    // 载入关卡
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !engineReady || !currentQuestion) return;
        engine.loadLevel(layout, currentQuestion.item);
        setNearPanel(false);
        setTyped("");
        setAnswerState("idle");
    }, [engineReady, levelIndex, currentQuestion, layout]);

    // 出生点选择界面：摆出光环、把镜头拉高；离开这一阶段就把光环收掉
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !engineReady) return;
        if (phase === "spawn") {
            engine.showSpawnMarkers(layout.spawns ?? [], selectedSpawn ?? -1);
            engine.setOverview(true);
        } else {
            engine.hideSpawnMarkers();
            engine.setOverview(false);
        }
        // selectedSpawn 变化时只更新高亮，不重建场景（下面单独一个 effect 处理）
    }, [phase, engineReady, layout]);

    // 换了出生点：只更新光环高亮 + 把玩家挪过去
    useEffect(() => {
        if (phase !== "spawn" || selectedSpawn === null) return;
        engineRef.current?.selectSpawn(selectedSpawn);
    }, [phase, selectedSpawn]);

    // 中文题切换拼音模式时，面板上的字跟着换（不用重开一关）
    useEffect(() => {
        engineRef.current?.setPinyinMode(inputMode === "pinyin");
    }, [inputMode]);

    // ---------------------------------------------------------------- 计时

    useEffect(() => {
        if (phase !== "playing" && phase !== "typing") return;
        const timer = window.setInterval(() => {
            setElapsed(Date.now() - stats.startedAt);
        }, 500);
        return () => window.clearInterval(timer);
    }, [phase, stats.startedAt]);

    // ---------------------------------------------------------------- 打字

    const openTyping = useCallback(() => {
        if (phaseRef.current !== "playing") return;
        setPhase("typing");
        setTyped("");
        setAnswerState("idle");
        if (document.pointerLockElement) document.exitPointerLock();
        window.setTimeout(() => inputRef.current?.focus(), 30);
    }, []);

    // 引擎回调里要用到 openTyping，用 ref 转一手，避免为了它重建整个引擎
    useEffect(() => {
        openTypingRef.current = openTyping;
    }, [openTyping]);

    const closeTyping = useCallback(() => {
        setPhase("playing");
        setTyped("");
        setAnswerState("idle");
    }, []);

    const handleSubmit = useCallback(() => {
        if (phaseRef.current !== "typing" || !currentQuestion) return;
        const answer = targetFor(currentQuestion, inputMode);
        if (isAnswerCorrect(typed, currentQuestion, inputMode)) {
            engineRef.current?.solvePanel();
            setAnswerState("correct");
            setStats((previous) => ({
                ...previous,
                solved: previous.solved + 1,
                chars: previous.chars + answer.length,
                combo: previous.combo + 1,
                bestCombo: Math.max(previous.bestCombo, previous.combo + 1),
            }));
            window.setTimeout(() => {
                setTyped("");
                setAnswerState("idle");
                setPhase("playing");
            }, 750);
        } else {
            setAnswerState("wrong");
            setStats((previous) => ({ ...previous, wrong: previous.wrong + 1, combo: 0 }));
            // 不清空输入框：打错了可以退格改，别让人从头再敲一遍
        }
    }, [currentQuestion, inputMode, typed]);

    const startRun = useCallback(() => {
        const fresh = emptyStats();
        setStats(fresh);
        statsRef.current = fresh;
        setElapsed(0);
        setLevelIndex(0);
        setSelectedSpawn(null);
        setPhase("spawn");
    }, []);

    /** 选好出生点，确认出发。 */
    const confirmSpawn = useCallback(() => {
        const engine = engineRef.current;
        const options = layout.spawns ?? [];
        const index = selectedSpawn ?? 0;
        const option = options[index] ?? options[0];
        if (engine && option) {
            engine.selectSpawn(index);
            engine.hideSpawnMarkers();
            engine.setOverview(false);
        }
        setPhase("playing");
    }, [layout, selectedSpawn]);

    /** 网页版玩腻了？可以把本地 Ursina 桌面版叫起来（仅本地环境可用）。 */
    const launchDesktop = useCallback(async () => {
        try {
            const response = await fetch("/api/v1/launcher/3d-typing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json().catch(() => ({}));
            setDesktopStatus(
                data?.already_running
                    ? "桌面版已经在运行了，切换到窗口就能玩"
                    : data?.started
                      ? "桌面版窗口已启动，切换到窗口就能玩"
                      : data?.detail || "桌面版启动失败",
            );
        } catch {
            setDesktopStatus("桌面版启动失败：连不上后端");
        }
    }, []);

    // ---------------------------------------------------------------- 键盘

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (phaseRef.current === "typing") return;
            const key = event.key.toLowerCase();
            keysRef.current.add(key);
            if (key === "e" && phaseRef.current === "playing" && nearPanel) {
                event.preventDefault();
                openTyping();
            }
            if (key === "v" && phaseRef.current === "playing") {
                setView(engineRef.current?.toggleView() ?? "third");
            }
            if (phaseRef.current === "spawn" && /^[1-9]$/.test(key)) {
                const index = Number(key) - 1;
                if (index < (layout.spawns ?? []).length) {
                    setSelectedSpawn(index);
                    engineRef.current?.selectSpawn(index);
                }
            }
            if (event.key === "Escape" && phaseRef.current === "spawn") {
                setPhase("intro");
            }
            if (event.key === "Escape" && phaseRef.current === "playing") {
                setPhase("paused");
            }
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            keysRef.current.delete(event.key.toLowerCase());
        };
        const handleBlur = () => keysRef.current.clear();

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [nearPanel, openTyping, layout]);

    // 打字面板开着的时候焦点必须留在输入框上。用户点一下画面、点一下题目文字，
    // 焦点就跑到 body 去了，之后按键全丢，表现为「打不了字」。
    // 这里在捕获阶段把点击拦下来（按钮除外），把焦点抢回输入框。
    useEffect(() => {
        if (phase !== "typing") return;
        const keepFocus = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target || target.closest("button")) return;
            // 点输入框本身时交给浏览器默认行为，不然手机上软键盘可能弹不出来
            if (target === inputRef.current) return;
            event.preventDefault();
            inputRef.current?.focus();
        };
        window.addEventListener("pointerdown", keepFocus, true);
        return () => window.removeEventListener("pointerdown", keepFocus, true);
    }, [phase]);

    // 把按键状态同步给引擎
    useEffect(() => {
        const timer = window.setInterval(() => {
            const keys = keysRef.current;
            const forward =
                (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
                (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
            const right =
                (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
                (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
            const run = keys.has("shift");
            const joystick = joystickRef.current;
            engineRef.current?.setInput({
                forward: forward + joystick.y,
                right: right + joystick.x,
                run,
            });
        }, 40);
        return () => window.clearInterval(timer);
    }, []);

    // ---------------------------------------------------------------- 界面

    // 触屏判定必须等挂载后再做，否则服务端和客户端渲染结果不一致
    const [isTouch, setIsTouch] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(pointer: coarse)");
        setIsTouch(query.matches);
        const handleChange = () => setIsTouch(query.matches);
        query.addEventListener("change", handleChange);
        return () => query.removeEventListener("change", handleChange);
    }, []);

    const handleJoystick = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let x = (event.clientX - centerX) / (rect.width / 2);
        let y = (event.clientY - centerY) / (rect.height / 2);
        const length = Math.hypot(x, y);
        if (length > 1) {
            x /= length;
            y /= length;
        }
        joystickRef.current = { x, y: -y };
        if (knobRef.current) {
            knobRef.current.style.transform = `translate(${x * 32}px, ${y * 32}px)`;
        }
    };

    return (
        <main className="fixed inset-0 overflow-hidden bg-[#070b1d] text-white">
            <div ref={containerRef} className="absolute inset-0" />

            {/* 引擎起不来时的兜底：告诉玩家怎么修，而不是留一块黑屏 */}
            {engineError && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#070b1d] p-6">
                    <div className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-[#0c1228]/95 p-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
                            <TriangleAlert className="h-7 w-7" />
                        </div>
                        <h2 className="mb-2 text-xl font-bold text-amber-100">3D 画面开不起来</h2>
                        <p className="mb-4 text-sm text-slate-300">{engineError}</p>
                        <p className="mb-6 text-xs leading-relaxed text-slate-400">
                            这个游戏需要浏览器的 WebGL（硬件加速）。换用新版 Chrome / Edge，
                            或者在浏览器设置里打开「使用硬件加速」，再刷新页面试试。
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push("/")}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/50 bg-teal-500/25 px-5 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-400/35"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            返回大厅
                        </button>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------- 顶栏 */}
            <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
                <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#0a0e27]/80 px-3 py-2 backdrop-blur">
                    <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-sm text-slate-200 transition hover:bg-white/10 hover:text-white"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        返回
                    </button>
                    <span className="hidden text-sm font-semibold text-cyan-200 sm:inline">3D 打字闯关</span>
                    <span data-testid="typing-3d-level" className="whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                        第 {Math.min(levelIndex + 1, questions.length)} / {questions.length} 关
                    </span>
                </div>

                <div className="pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-[#0a0e27]/80 px-2.5 py-2 text-[11px] text-slate-200 backdrop-blur sm:px-3 sm:text-xs">
                    <span className="tabular-nums">{formatTime(elapsed)}</span>
                    <span className="text-white/20">|</span>
                    <span>正确率 {accuracyNow}%</span>
                    <span className="text-white/20">|</span>
                    <span>连击 x{stats.combo}</span>
                </div>
            </header>

            {/* ---------------------------------------------------------- 左侧设置 */}
            <div className="pointer-events-none absolute left-3 top-20 z-20 flex flex-col items-start gap-2 sm:left-4 sm:top-24">
                <button
                    type="button"
                    onClick={() => setInputMode((mode) => (mode === "pinyin" ? "hanzi" : "pinyin"))}
                    className="pointer-events-auto flex items-center gap-2 rounded-lg border border-teal-300/30 bg-[#0a0e27]/80 px-3 py-2 text-xs text-teal-100 backdrop-blur transition hover:border-teal-200/60"
                >
                    <Keyboard className="h-3.5 w-3.5" />
                    {inputMode === "pinyin" ? "中文：打拼音" : "中文：打汉字"}
                </button>
                <button
                    type="button"
                    onClick={() => setView(engineRef.current?.toggleView() ?? "third")}
                    className="pointer-events-auto rounded-lg border border-white/10 bg-[#0a0e27]/80 px-3 py-2 text-xs text-slate-200 backdrop-blur transition hover:border-white/30"
                >
                    {isTouch
                        ? view === "third"
                            ? "第三人称视角"
                            : "第一人称视角"
                        : view === "third"
                          ? "视角：第三人称（V 切换）"
                          : "视角：第一人称（V 切换）"}
                </button>
                {phase === "playing" && (
                    <button
                        type="button"
                        onClick={() => setPhase("paused")}
                        className="pointer-events-auto rounded-lg border border-white/10 bg-[#0a0e27]/80 px-3 py-2 text-xs text-slate-200 backdrop-blur transition hover:border-white/30"
                    >
                        {isTouch ? "暂停" : "暂停（Esc）"}
                    </button>
                )}
            </div>

            {/* ---------------------------------------------------------- 底部提示 */}
            {phase === "playing" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-3 px-4">
                    {nearPanel && (
                        <button
                            type="button"
                            data-testid="typing-3d-panel-button"
                            onClick={openTyping}
                            className="pointer-events-auto flex items-center gap-2 rounded-full border border-teal-300/50 bg-teal-500/20 px-5 py-2.5 text-sm font-semibold text-teal-50 shadow-[0_0_28px_rgba(56,232,200,0.35)] backdrop-blur transition hover:bg-teal-400/30"
                        >
                            <Target className="h-4 w-4" />
                            {isTouch ? "点这里打开打字面板" : "按 E 打开打字面板"}
                        </button>
                    )}
                    {isTouch ? (
                        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#0a0e27]/70 px-4 py-1.5 text-xs text-slate-300 backdrop-blur">
                            <span>左侧摇杆移动</span>
                            <span>拖动屏幕转视角</span>
                        </div>
                    ) : (
                        <div className="hidden items-center gap-4 rounded-full border border-white/10 bg-[#0a0e27]/70 px-4 py-1.5 text-xs text-slate-300 backdrop-blur sm:flex">
                            <span>WASD 移动</span>
                            <span>拖动鼠标转视角</span>
                            <span>E 答题</span>
                            <span>V 切换视角</span>
                            <span>Shift 疾跑</span>
                        </div>
                    )}
                </div>
            )}

            {/* ---------------------------------------------------------- 过关提示 */}
            {phase === "transition" && (
                <div className="pointer-events-none absolute inset-x-0 top-1/3 z-20 flex justify-center">
                    <p className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-5 py-2 text-sm font-semibold text-emerald-100 backdrop-blur">
                        答对啦！进入第 {Math.min(levelIndex + 2, questions.length)} 关
                    </p>
                </div>
            )}

            {/* ---------------------------------------------------------- 虚拟摇杆 */}
            {phase === "playing" && isTouch && (
                <div
                    className="pointer-events-auto absolute bottom-6 left-6 z-20 h-28 w-28 touch-none rounded-full border border-white/15 bg-white/5 backdrop-blur"
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        handleJoystick(event);
                    }}
                    onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            handleJoystick(event);
                        }
                    }}
                    onPointerUp={() => {
                        joystickRef.current = { x: 0, y: 0 };
                        if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
                    }}
                    onPointerCancel={() => {
                        joystickRef.current = { x: 0, y: 0 };
                        if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
                    }}
                >
                    <div
                        ref={knobRef}
                        className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -ml-6 -mt-6 rounded-full border border-white/30 bg-white/20"
                    />
                </div>
            )}

            {/* ---------------------------------------------------------- 打字框 */}
            {phase === "typing" && currentQuestion && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04060f]/70 p-4 backdrop-blur-sm">
                    <div
                        className={`max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-[#0c1228]/95 p-4 shadow-2xl transition sm:p-6 ${
                            answerState === "correct"
                                ? "border-emerald-400/70 shadow-emerald-500/25"
                                : answerState === "wrong"
                                  ? "border-rose-400/70 shadow-rose-500/25"
                                  : "border-teal-300/30"
                        }`}
                    >
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                            <span className="flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5 text-teal-300" />
                                第 {levelIndex + 1} 关 · {KIND_TEXT[currentQuestion.item.kind] ?? "练习"}
                            </span>
                            <span className="tabular-nums">用时 {formatTime(Date.now() - stats.startedAt)}</span>
                        </div>

                        <p data-testid="typing-3d-question" className="mb-1 text-center text-2xl font-semibold tracking-wide text-white sm:text-3xl">
                            {currentQuestion.item.text}
                        </p>
                        {currentQuestion.item.kind === "zh" && currentQuestion.item.pinyin ? (
                            <p data-testid="typing-3d-pinyin" className="mb-4 text-center text-lg text-teal-200/90">
                                {inputMode === "pinyin"
                                    ? currentQuestion.item.pinyin
                                    : "（用中文输入法打出上面的字）"}
                            </p>
                        ) : (
                            <div className="mb-4" />
                        )}

                        <div className="relative rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                            <label
                                htmlFor="typing3d-answer"
                                className="flex min-h-[2rem] cursor-text flex-wrap items-baseline gap-x-1 text-2xl font-mono"
                            >
                                {answerState === "wrong" ? (
                                    <span className="text-rose-300">{typed || "再试一次"}</span>
                                ) : (
                                    <>
                                        <span className="text-teal-300">{typed}</span>
                                        {answerState === "idle" && (
                                            <span className="inline-block h-6 w-0.5 animate-pulse bg-teal-300 align-baseline" />
                                        )}
                                        <span className="text-white/25">
                                            {remainingTarget(typed, currentQuestion, inputMode)}
                                        </span>
                                    </>
                                )}
                            </label>
                            {/* 真输入框直接铺在这个框上：点它就能聚焦，
                                中文输入法的候选框也会弹在这个位置。文字画在下面，
                                这样能同时显示「已输入 / 剩余」两种颜色。 */}
                            <input
                                id="typing3d-answer"
                                name="typing3dAnswer"
                                ref={inputRef}
                                value={typed}
                                onBlur={(event) => {
                                    // 焦点不能丢：只有点到按钮上才放行，其余情况立刻拉回来
                                    const next = event.relatedTarget as HTMLElement | null;
                                    if (next?.closest("button")) return;
                                    window.setTimeout(() => inputRef.current?.focus(), 0);
                                }}
                                onChange={(event) => {
                                    setTyped(event.target.value);
                                    // 开始改就撤掉「打错了」的标记
                                    if (answerState === "wrong") setAnswerState("idle");
                                }}
                                onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    if (
                                        (event.nativeEvent as unknown as { isComposing?: boolean }).isComposing
                                    ) {
                                        return;
                                    }
                                    event.preventDefault();
                                    handleSubmit();
                                }}
                                aria-label="打字输入框"
                                data-testid="typing-3d-input"
                                className="absolute inset-0 h-full w-full cursor-text opacity-0"
                            />
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                            <span>
                                {answerState === "correct"
                                    ? "正确！门开了，穿过去进入下一关"
                                    : answerState === "wrong"
                                      ? "没对上，再来一次"
                                      : prefixMatches(typed, currentQuestion, inputMode)
                                        ? "继续敲…"
                                        : "和上面的文字对一下"}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={closeTyping}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 transition hover:bg-white/10"
                                >
                                    取消（Esc）
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    className="rounded-lg border border-teal-300/40 bg-teal-500/20 px-4 py-1.5 font-medium text-teal-50 transition hover:bg-teal-400/30"
                                >
                                    提交（Enter）
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------- 出生点选择 */}
            {phase === "spawn" && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center bg-gradient-to-t from-[#04060f]/92 via-[#04060f]/28 to-transparent p-4 pb-6 sm:pb-8">
                    <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-teal-300/25 bg-[#0c1228]/95 p-6 text-center shadow-2xl">
                        <h2 className="mb-1 text-lg font-bold">选择出生点</h2>
                        <p className="mb-4 text-xs text-slate-400">
                            点击地面上的光环，或者按 1 ~ {Math.max(1, (layout.spawns ?? []).length)} 键
                        </p>
                        <div className="mb-5 grid grid-cols-2 gap-2">
                            {(layout.spawns ?? []).map((option, index) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    data-testid={`typing-3d-spawn-option-${index}`}
                                    onClick={() => {
                                        setSelectedSpawn(index);
                                        engineRef.current?.selectSpawn(index);
                                    }}
                                    className={`rounded-xl border px-3 py-2.5 text-sm transition ${
                                        selectedSpawn === index
                                            ? "border-teal-300/70 bg-teal-500/25 text-teal-50"
                                            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                                    }`}
                                >
                                    <span className="mr-1.5 text-xs text-slate-400">{index + 1}</span>
                                    {option.name}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            data-testid="typing-3d-spawn-confirm"
                            onClick={confirmSpawn}
                            className="w-full rounded-xl border border-teal-300/50 bg-teal-500/25 px-5 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-400/35"
                        >
                            确认出发
                        </button>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------- 开场 */}
            {phase === "intro" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04060f]/80 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-teal-300/25 bg-[#0c1228]/95 p-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
                            <Keyboard className="h-7 w-7" />
                        </div>
                        <h1 className="mb-2 text-2xl font-bold text-white">3D 打字闯关</h1>
                        <p className="mb-5 text-sm leading-relaxed text-slate-300">
                            走到发光的打字面板前，敲出题目上的字，门就会打开。
                            <br />
                            每天 {questions.length || 24} 关，题目当天固定，第二天换新。
                        </p>

                        {loadError && (
                            <p className="mb-4 flex items-center justify-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                                <TriangleAlert className="h-4 w-4" />
                                题库加载失败：{loadError}
                            </p>
                        )}

                        <div className="mb-6 grid grid-cols-3 gap-2 text-xs text-slate-300">
                            <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-3">
                                <p className="mb-1 text-slate-400">移动</p>
                                <p className="font-semibold text-white">WASD</p>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-3">
                                <p className="mb-1 text-slate-400">转视角</p>
                                <p className="font-semibold text-white">拖动鼠标</p>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-3">
                                <p className="mb-1 text-slate-400">答题</p>
                                <p className="font-semibold text-white">走到面板按 E</p>
                            </div>
                        </div>

                        {best && (
                            <p className="mb-4 text-xs text-slate-400">
                                历史最好：闯过 {best.solved} 关 · 正确率 {best.accuracy}%
                            </p>
                        )}
                        {topScores.length > 0 && (
                            <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left">
                                <p className="mb-1 text-[11px] text-slate-400">排行榜 · 每分钟字符数</p>
                                {topScores.slice(0, 3).map((row, index) => (
                                    <p
                                        key={`${row.username}-${index}`}
                                        className="flex items-center justify-between gap-2 text-xs text-slate-200"
                                    >
                                        <span className="truncate">
                                            {index + 1}. {row.username}
                                        </span>
                                        <span className="tabular-nums text-teal-200">
                                            {row.speed} CPM · {row.accuracy}%
                                        </span>
                                    </p>
                                ))}
                            </div>
                        )}

                        <button
                            type="button"
                            data-testid="typing-3d-start"
                            disabled={!questions.length}
                            onClick={startRun}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/50 bg-teal-500/25 px-5 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-400/35 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {questions.length ? (
                                "开始闯关"
                            ) : (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    正在载入题库…
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------- 暂停 */}
            {phase === "paused" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04060f]/75 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0c1228]/95 p-6 text-center">
                        <h2 className="mb-4 text-lg font-bold">暂停中</h2>
                        <ul className="mb-6 space-y-1.5 text-left text-sm text-slate-300">
                            <li>WASD / 方向键：移动</li>
                            <li>按住鼠标拖动：转视角</li>
                            <li>E：打开打字面板</li>
                            <li>V：切换第一 / 第三人称</li>
                            <li>Shift：疾跑</li>
                        </ul>
                        {desktopStatus && (
                            <p className="mb-3 text-xs text-teal-200">{desktopStatus}</p>
                        )}
                        {desktopAvailable && (
                            <button
                                type="button"
                                onClick={launchDesktop}
                                className="mb-3 w-full rounded-xl border border-teal-300/30 px-4 py-2 text-xs text-teal-100 transition hover:bg-teal-400/20"
                            >
                                打开本地桌面版（Ursina）
                            </button>
                        )}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => router.push("/")}
                                className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm transition hover:bg-white/10"
                            >
                                返回首页
                            </button>
                            <button
                                type="button"
                                onClick={() => setPhase("playing")}
                                className="flex-1 rounded-xl border border-teal-300/40 bg-teal-500/25 px-4 py-2.5 text-sm font-semibold text-teal-50 transition hover:bg-teal-400/35"
                            >
                                继续
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---------------------------------------------------------- 结算 */}
            {phase === "finished" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04060f]/80 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-emerald-300/30 bg-[#0c1228]/95 p-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                            <Check className="h-7 w-7" />
                        </div>
                        <h2 data-testid="typing-3d-finished" className="mb-1 text-2xl font-bold">闯关完成</h2>
                        <p className="mb-6 text-sm text-slate-300">
                            今天的 {questions.length} 关全部走完了
                        </p>

                        <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                <p className="text-xs text-slate-400">答对</p>
                                <p className="text-xl font-bold text-emerald-200">
                                    {stats.solved} / {questions.length}
                                </p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                <p className="text-xs text-slate-400">正确率</p>
                                <p className="text-xl font-bold text-teal-200">{accuracyNow}%</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                <p className="text-xs text-slate-400">总用时</p>
                                <p className="text-xl font-bold tabular-nums">{formatTime(elapsed)}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                <p className="text-xs text-slate-400">最高连击</p>
                                <p className="text-xl font-bold text-amber-200">x{stats.bestCombo}</p>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => router.push("/")}
                                className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm transition hover:bg-white/10"
                            >
                                返回首页
                            </button>
                            <button
                                type="button"
                                onClick={startRun}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-300/40 bg-teal-500/25 px-4 py-2.5 text-sm font-semibold text-teal-50 transition hover:bg-teal-400/35"
                            >
                                <RotateCcw className="h-4 w-4" />
                                再来一局
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
