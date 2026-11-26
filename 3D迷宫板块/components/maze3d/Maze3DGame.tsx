'use client';

/**
 * 3D 编程迷宫 —— 游戏主界面
 *
 * 流程：难度选择 → 3D 第一人称迷宫 → 右上角写 Python 代码 → 运行 → 逐格回放。
 * 踩到陷阱门会弹出 Python 语法题，答对才被放回迷宫；
 * 走到真正的出口门就通关，金币数量决定评价。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    Bot,
    ChevronDown,
    ChevronUp,
    Code2,
    Coins,
    Compass,
    Footprints,
    Navigation,
    Palette,
    Play,
    RefreshCw,
    ShieldQuestion,
    Sparkles,
    Timer,
    TriangleAlert,
    Trophy,
} from 'lucide-react';
import CodeEditor from '@/components/maze/CodeEditor';
import { interpretMazeCode } from '@/lib/maze/interpreter';
import { sfx } from '@/lib/maze/sound';
import MazeWorld, { type Maze3DCommand, type MazeWorldHandle, type PlayResult } from './MazeWorld';
import Minimap from './Minimap';
import { DIFFICULTIES, createLevel, type Difficulty, type Door } from '@/lib/maze3d/level';
import { createRunState, type RunState } from '@/lib/maze3d/engine';
import { MAZE_THEMES, getTheme } from '@/lib/maze3d/themes';
import { pickQuiz, type QuizQuestion } from '@/lib/maze3d/quiz';
import { senseGizmo, type GizmoMood } from '@/lib/maze3d/gizmo';

type Phase = 'difficulty' | 'playing';

interface QuizState {
    door: Door;
    question: QuizQuestion;
    wrong: number[];
}

const STARTER_CODE = `# 只能写代码：move() 走一步，turn_left() / turn_right() 转弯
move()
move()
turn_right()
move()
`;

const COMMAND_HINTS = ['move()', 'turn_left()', 'turn_right()', 'for i in range(3):'];

/** 难度卡片各自的强调色（边框光晕 + 徽标） */
const DIFFICULTY_STYLES: Record<Difficulty, { glow: string; badge: string }> = {
    easy: {
        glow: 'hover:border-emerald-300/40 hover:shadow-[0_20px_60px_rgba(52,211,153,0.18)]',
        badge: 'bg-emerald-400/15 text-emerald-200',
    },
    medium: {
        glow: 'hover:border-amber-300/40 hover:shadow-[0_20px_60px_rgba(251,191,36,0.18)]',
        badge: 'bg-amber-400/15 text-amber-200',
    },
    hard: {
        glow: 'hover:border-rose-300/40 hover:shadow-[0_20px_60px_rgba(251,113,133,0.18)]',
        badge: 'bg-rose-400/15 text-rose-200',
    },
};

export default function Maze3DGame() {
    const [phase, setPhase] = useState<Phase>('difficulty');
    const [difficulty, setDifficulty] = useState<Difficulty>('easy');
    const [themeId, setThemeId] = useState(MAZE_THEMES[0].id);
    const [code, setCode] = useState(STARTER_CODE);
    const [runState, setRunState] = useState<RunState | null>(null);
    const [running, setRunning] = useState(false);
    const [ready, setReady] = useState(false);
    const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' | 'ok' } | null>(null);
    const [quiz, setQuiz] = useState<QuizState | null>(null);
    const [result, setResult] = useState<{ coins: number; steps: number; seconds: number } | null>(null);
    const [leading, setLeading] = useState(true);
    const [panelOpen, setPanelOpen] = useState(true);
    const [elapsed, setElapsed] = useState(0);
    const [hitFlash, setHitFlash] = useState(0);
    const [coinPop, setCoinPop] = useState(0);

    // 手机窄屏默认收起指令面板，避免一进关就盖住大半个画面
    useEffect(() => {
        if (window.matchMedia('(max-width: 639px)').matches) {
            setPanelOpen(false);
        }
    }, []);

    const worldRef = useRef<MazeWorldHandle | null>(null);
    const quizResolverRef = useRef<((decision: 'resume' | 'abort') => void) | null>(null);
    const usedQuizRef = useRef<string[]>([]);
    const startedAtRef = useRef<number | null>(null);
    /** 方向键的待执行队列：一次只推一条进播放管线，避免连按互相打断 */
    const keyQueueRef = useRef<Maze3DCommand[]>([]);
    const keyBusyRef = useRef(false);
    const busyRef = useRef(false);

    const level = useMemo(() => (phase === 'playing' ? createLevel(difficulty) : null), [phase, difficulty]);
    const theme = getTheme(themeId);
    const totalCoins = level?.coins.length ?? 0;
    const coins = runState?.coins.length ?? 0;
    const steps = runState?.steps ?? 0;

    const startGame = (next: Difficulty) => {
        setDifficulty(next);
        setCode(STARTER_CODE);
        setRunState(createRunState(createLevel(next)));
        setResult(null);
        setMessage({ text: '写代码，让探险家自己走进迷宫', tone: 'info' });
        setReady(false);
        startedAtRef.current = null;
        setElapsed(0);
        usedQuizRef.current = [];
        setPhase('playing');
    };

    const backToDifficulty = () => {
        worldRef.current?.stop();
        setRunning(false);
        setPhase('difficulty');
        setQuiz(null);
        setResult(null);
    };

    const handleReset = () => {
        worldRef.current?.reset();
        if (level) setRunState(createRunState(level));
        setRunning(false);
        setResult(null);
        startedAtRef.current = null;
        setElapsed(0);
        setMessage({ text: '已回到起点，金币也放回去了', tone: 'info' });
    };

    const handleTrap = useCallback(
        (door: Door) =>
            new Promise<'resume' | 'abort'>((resolve) => {
                const seed = door.x * 31 + door.z * 17 + usedQuizRef.current.length * 7;
                const question = pickQuiz(seed, usedQuizRef.current);
                usedQuizRef.current = [...usedQuizRef.current, question.id];
                quizResolverRef.current = resolve;
                setQuiz({ door, question, wrong: [] });
            }),
        [],
    );

    const finishQuiz = (decision: 'resume' | 'abort') => {
        setQuiz(null);
        const resolve = quizResolverRef.current;
        quizResolverRef.current = null;
        resolve?.(decision);
    };

    const answerQuiz = (option: number) => {
        if (!quiz) return;
        if (option === quiz.question.answer) {
            sfx.pickup();
            finishQuiz('resume');
            setMessage({ text: '答对了，陷阱门放你回去 —— 换个方向找路吧', tone: 'ok' });
            return;
        }
        sfx.error();
        setQuiz({
            ...quiz,
            wrong: quiz.wrong.includes(option) ? quiz.wrong : [...quiz.wrong, option],
        });
    };

    const run = async () => {
        if (running || !level) return;
        const parsed = interpretMazeCode(code, '探险家');
        if (!parsed.ok) {
            sfx.error();
            setMessage({ text: parsed.error ?? '代码有问题', tone: 'error' });
            return;
        }

        if (startedAtRef.current === null) startedAtRef.current = Date.now();
        setMessage({ text: `执行中：一共 ${parsed.commands.length} 条指令`, tone: 'info' });
        setRunning(true);

        const outcome: PlayResult | undefined = await worldRef.current?.play(parsed.commands, {
            onState: setRunState,
            onBlocked: () => {
                setMessage({ text: '前面是墙 —— 先 turn_left() / turn_right() 换个方向', tone: 'error' });
                setHitFlash((value) => value + 1);
            },
            onTrap: handleTrap,
        });

        setRunning(false);
        if (!outcome) return;

        if (outcome.status === 'win') {
            const seconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
            setResult({ coins: outcome.state.coins.length, steps: outcome.state.steps, seconds });
            setMessage({ text: '找到出口了！', tone: 'ok' });
        } else if (outcome.status === 'done') {
            setMessage({ text: '指令执行完了，但还没走到出口 —— 再补几句 move()', tone: 'info' });
        }
    };

    /**
     * 方向键：把单条指令推进和「运行」完全相同的播放管线，
     * 所以撞墙抖动、金币粒子、陷阱门答题、通关结算都不用另写一套。
     */
    const stepByKey = useCallback(
        async (command: Maze3DCommand) => {
            if (!level || busyRef.current) return;
            if (keyQueueRef.current.length >= 2) return;
            keyQueueRef.current.push(command);
            if (keyBusyRef.current) return;

            keyBusyRef.current = true;
            if (startedAtRef.current === null) startedAtRef.current = Date.now();
            try {
                while (keyQueueRef.current.length > 0) {
                    const next = keyQueueRef.current.shift()!;
                    const outcome = await worldRef.current?.play([next], {
                        onState: setRunState,
                        onBlocked: () => {
                            setMessage({ text: '前面是墙 —— 换个方向，或按 ↓ 退一步', tone: 'error' });
                            setHitFlash((value) => value + 1);
                        },
                        onTrap: handleTrap,
                    });
                    if (!outcome) break;

                    if (outcome.status === 'win') {
                        const seconds = startedAtRef.current
                            ? Math.round((Date.now() - startedAtRef.current) / 1000)
                            : 0;
                        setResult({ coins: outcome.state.coins.length, steps: outcome.state.steps, seconds });
                        setMessage({ text: '找到出口了！', tone: 'ok' });
                        keyQueueRef.current = [];
                        break;
                    }
                    if (outcome.status !== 'done') {
                        keyQueueRef.current = [];
                        break;
                    }
                }
            } finally {
                keyBusyRef.current = false;
            }
        },
        [level, handleTrap],
    );

    // 答题弹窗、通关弹窗、代码执行中都不吃方向键
    useEffect(() => {
        busyRef.current = running || quiz !== null || result !== null || !ready;
    }, [running, quiz, result, ready]);

    // 方向键走动；焦点在代码编辑器里时不抢键（那是光标移动）
    useEffect(() => {
        if (phase !== 'playing') return;

        const KEY_MAP: Record<string, Maze3DCommand> = {
            ArrowUp: 'forward',
            ArrowDown: 'back',
            ArrowLeft: 'left',
            ArrowRight: 'right',
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;

            const target = event.target as HTMLElement | null;
            const editing =
                !!target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable ||
                    !!target.closest('.monaco-editor'));
            if (editing) return;

            const command = KEY_MAP[event.key];
            if (!command) return;

            event.preventDefault();
            void stepByKey(command);
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [phase, stepByKey]);

    const stars = result ? (result.coins >= totalCoins ? (result.steps <= (level?.par ?? 0) * 1.5 ? 3 : 2) : 1) : 0;

    // 小弟的台词由纯函数算，跟 3D 里的表情共用同一套判断
    const hint = useMemo(() => {
        if (!level || !runState) return null;
        return senseGizmo(level, runState, leading);
    }, [level, runState, leading]);

    useEffect(() => {
        worldRef.current?.setLeading(leading);
    }, [leading, ready]);

    useEffect(() => {
        if (phase !== 'playing' || result) return;
        const id = window.setInterval(() => {
            setElapsed(startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0);
        }, 500);
        return () => window.clearInterval(id);
    }, [phase, result, running]);

    const gizmoFace: Record<GizmoMood, { icon: typeof Bot; ring: string; text: string }> = {
        idle: { icon: Bot, ring: 'border-cyan-300/40 text-cyan-200', text: 'text-slate-300' },
        lead: { icon: Navigation, ring: 'border-amber-300/50 text-amber-200', text: 'text-amber-100' },
        warn: { icon: TriangleAlert, ring: 'border-rose-400/60 text-rose-300', text: 'text-rose-100' },
        cheer: { icon: Sparkles, ring: 'border-amber-200/60 text-amber-200', text: 'text-amber-100' },
    };

    // 撞墙红闪：一层红色渐变盖一下就消失
    useEffect(() => {
        if (hitFlash === 0) return;
        const id = window.setTimeout(() => setHitFlash(0), 500);
        return () => window.clearTimeout(id);
    }, [hitFlash]);

    // 收到金币时 HUD 数字弹跳一下
    const prevCoinsRef = useRef(0);
    useEffect(() => {
        if (coins > prevCoinsRef.current) setCoinPop((value) => value + 1);
        prevCoinsRef.current = coins;
    }, [coins]);

    if (phase === 'difficulty') {
        return (
            <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07060c] px-4 py-10 text-white">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,0.28),transparent_60%)]" />
                <div className="relative w-full max-w-4xl">
                    <Link
                        href="/"
                        className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                    >
                        <ArrowLeft className="h-4 w-4" /> 回到主页
                    </Link>
                    <h1 className="font-pixel text-3xl text-cyan-200 sm:text-4xl">迷宫探索</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                        第一人称 3D 迷宫。在右上角写 Python 代码让探险家自己走，也可以直接用方向键手动探索。
                        收金币、避开陷阱门、找到真正的出口。所有门长得一模一样，进错门会被 Python 语法题拦住 —— 答对才放你回来。
                    </p>

                    <div className="mt-8 grid gap-4 sm:grid-cols-3">
                        {DIFFICULTIES.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => startGame(item.id)}
                                className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.02] p-6 text-left transition hover:-translate-y-1 ${DIFFICULTY_STYLES[item.id].glow}`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-pixel text-2xl text-white">{item.label}</span>
                                    <Play
                                        className={`h-5 w-5 transition group-hover:translate-x-1 ${DIFFICULTY_STYLES[item.id].badge.split(' ')[1]}`}
                                    />
                                </div>
                                <p className="mt-3 text-sm text-slate-300">{item.subtitle}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {item.size * item.size} 格 · {item.coinCount} 枚金币
                                </p>
                            </button>
                        ))}
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        {[
                            { icon: Bot, title: '小跟班 · 小弟', text: '飘在你右前方，帮你嗅金币、两格内有门就发抖报警' },
                            { icon: Compass, title: '探索式小地图', text: '只画走过的地方，去过哪、漏了哪一目了然' },
                            { icon: Palette, title: '四种墙材质', text: '墓园石墙 / 熔岩地宫 / 冰霜回廊 / 赛博霓虹' },
                        ].map((feature) => (
                            <div
                                key={feature.title}
                                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.05]"
                            >
                                <feature.icon className="h-4 w-4 text-cyan-300" />
                                <div className="mt-2 text-sm font-medium text-slate-100">{feature.title}</div>
                                <p className="mt-1 text-[11px] leading-5 text-slate-400">{feature.text}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-300">
                        <div className="mb-2 font-pixel text-cyan-200">可用指令</div>
                        <div className="flex flex-wrap gap-2">
                            {COMMAND_HINTS.map((hint) => (
                                <code key={hint} className="rounded-lg bg-slate-900/80 px-2.5 py-1 font-mono text-[13px] text-amber-200">
                                    {hint}
                                </code>
                            ))}
                        </div>
                        <p className="mt-3 text-xs leading-6 text-slate-400">
                            提示：迷宫的墙是低多边形墓园石墙模型，关卡里可以随时换材质主题；金币踩上去的一瞬间会炸成一片光点。
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
            <div className="absolute inset-0">
                {level && (
                    <MazeWorld
                        ref={worldRef}
                        level={level}
                        themeId={themeId}
                        onReady={() => setReady(true)}
                    />
                )}
            </div>

            {/* 加载中 */}
            {!ready && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#07060c]">
                    <div className="text-center">
                        <div className="font-pixel text-xl text-cyan-200 animate-pulse">正在生成 3D 迷宫…</div>
                        <div className="mt-2 text-xs text-slate-500">加载墓园石墙模型</div>
                    </div>
                </div>
            )}

            {/* 暗角，让画面中间更聚焦 */}
            <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 42%, rgba(0,0,0,0.62) 100%)' }}
            />

            {/* 撞墙红闪 */}
            {hitFlash > 0 && (
                <div
                    key={hitFlash}
                    className="animate-hit-flash pointer-events-none absolute inset-0 z-[15]"
                    style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 38%, rgba(190,18,60,0.55) 100%)' }}
                />
            )}

            {/* 左上 HUD */}
            <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col gap-2">
                <div className="pointer-events-auto overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-black/72 to-black/45 shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur">
                    <div className="flex flex-wrap items-center gap-2 py-2 pl-3 pr-28 sm:pr-3">
                        <button
                            onClick={backToDifficulty}
                            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                            title="换难度"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <span className="rounded-md bg-cyan-400/15 px-1.5 py-0.5 font-pixel text-xs text-cyan-200">
                            {DIFFICULTIES.find((item) => item.id === difficulty)?.label}
                        </span>
                        <span key={coinPop} className={`flex items-center gap-1 text-sm text-amber-200 ${coinPop > 0 ? 'animate-coin-pop' : ''}`}>
                            <Coins className="h-4 w-4" /> {coins}/{totalCoins}
                        </span>
                        <span className="flex items-center gap-1 text-sm text-slate-300">
                            <Footprints className="h-4 w-4" /> {steps}
                        </span>
                        <span className="flex items-center gap-1 text-sm text-slate-300 tabular-nums">
                            <Timer className="h-4 w-4" /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                        </span>
                        <span className="hidden text-xs text-slate-500 sm:inline">最短 {level?.par ?? 0} 步</span>
                        <button
                            onClick={handleReset}
                            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                            title="回到起点（金币复原）"
                        >
                            <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    <div className="h-[3px] w-full bg-white/[0.06]">
                        <div
                            className="h-full bg-gradient-to-r from-amber-300 to-amber-500 transition-all duration-500"
                            style={{ width: `${totalCoins > 0 ? (coins / totalCoins) * 100 : 0}%` }}
                        />
                    </div>
                </div>

                <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/45 px-2.5 py-2 backdrop-blur">
                    <Palette className="mr-1 h-3.5 w-3.5 text-slate-400" />
                    {MAZE_THEMES.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setThemeId(item.id)}
                            title={item.hint}
                            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                                themeId === item.id
                                    ? 'font-medium text-slate-950 shadow-[0_0_18px_rgba(255,255,255,0.25)]'
                                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                            style={themeId === item.id ? { backgroundColor: item.accent } : undefined}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* 右上代码面板（收窄版，可折叠） */}
            {panelOpen ? (
                <div className="absolute right-3 top-3 z-20 w-[min(88vw,300px)] overflow-hidden rounded-2xl border border-white/12 bg-[#0d0b14]/92 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur">
                    <div className="flex items-center justify-between gap-1.5 border-b border-white/10 px-2.5 py-1.5">
                        <div className="min-w-0">
                            <div className="font-pixel text-xs text-cyan-200">指令面板</div>
                            <div className="truncate text-[10px] text-slate-500">写代码运行，或用方向键手动走</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                onClick={run}
                                disabled={running}
                                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                                    running
                                        ? 'cursor-not-allowed bg-white/10 text-slate-400'
                                        : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                                }`}
                            >
                                <Play className="h-3.5 w-3.5" /> {running ? '执行中' : '运行'}
                            </button>
                            <button
                                onClick={() => setPanelOpen(false)}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                                title="收起指令面板（画面全给迷宫）"
                            >
                                <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    <CodeEditor value={code} onChange={setCode} onRun={run} height={216} />
                    <div className="flex flex-wrap items-center gap-1 border-t border-white/10 px-2.5 py-1.5">
                        {COMMAND_HINTS.map((hint) => (
                            <code key={hint} className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px] text-amber-200/90">
                                {hint}
                            </code>
                        ))}
                        <span className="ml-auto text-[10px] text-slate-500">↑↓←→ 可走 · Ctrl/⌘ + Enter</span>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setPanelOpen(true)}
                    className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#0d0b14]/90 px-2.5 py-1.5 text-xs text-cyan-200 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur transition hover:bg-[#161225]"
                    title="展开指令面板"
                >
                    <Code2 className="h-3.5 w-3.5" />
                    指令面板
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>
            )}

            {/* 左下：小跟班 */}
            <div className="absolute bottom-3 left-3 z-20 w-[min(74vw,318px)]">
                <div className="rounded-2xl border border-white/12 bg-gradient-to-b from-black/72 to-black/50 p-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur">
                    <div className="flex items-start gap-2.5">
                        <div className="relative">
                            <span
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border bg-white/[0.04] ${
                                    gizmoFace[hint?.mood ?? 'idle'].ring
                                }`}
                            >
                                {(() => {
                                    const Icon = gizmoFace[hint?.mood ?? 'idle'].icon;
                                    return <Icon className="h-4 w-4" />;
                                })()}
                            </span>
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full bg-cyan-300/70" />
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-cyan-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span className="font-pixel text-[11px] text-slate-200">小跟班</span>
                                <span className="rounded bg-white/5 px-1 py-[1px] text-[10px] text-slate-500">跟着你 · 不占指令</span>
                            </div>
                            <p className={`mt-1 text-xs leading-5 ${gizmoFace[hint?.mood ?? 'idle'].text}`}>
                                {hint?.text ?? '我在你右前方，别把我忘了'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setLeading((value) => !value)}
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] transition ${
                            leading
                                ? 'border-amber-300/40 bg-amber-400/15 text-amber-100'
                                : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                        }`}
                    >
                        <Compass className="h-3.5 w-3.5" />
                        {leading ? '带路：开 · 金币方向有箭头' : '带路：关 · 让小弟闭嘴'}
                    </button>
                </div>
            </div>

            {/* 左上：迷宫小地图（HUD 与材质主题下方；手机上展开面板时让位给面板） */}
            {level && (
                <Minimap
                    level={level}
                    state={runState}
                    size={168}
                    className={`absolute left-3 top-[9.5rem] z-20 md:top-[7.6rem] ${panelOpen ? 'hidden md:block' : ''}`}
                />
            )}

            {/* 底部提示 */}
            {message && (
                <div className="pointer-events-none absolute bottom-[8.6rem] left-1/2 z-20 w-[min(92vw,560px)] -translate-x-1/2 md:bottom-4 md:w-[min(46vw,520px)]">
                    <div
                        className={`rounded-2xl border px-4 py-2.5 text-center text-sm backdrop-blur ${
                            message.tone === 'error'
                                ? 'border-rose-400/40 bg-rose-950/70 text-rose-100'
                                : message.tone === 'ok'
                                  ? 'border-emerald-400/40 bg-emerald-950/70 text-emerald-100'
                                  : 'border-white/10 bg-black/60 text-slate-200'
                        }`}
                    >
                        {message.text}
                    </div>
                </div>
            )}

            {/* 陷阱门答题 */}
            {quiz && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-rose-400/30 bg-[#120a10] shadow-[0_30px_90px_rgba(244,63,94,0.25)]">
                        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
                            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
                                <ShieldQuestion className="h-5 w-5" />
                            </span>
                            <div>
                                <div className="font-pixel text-lg text-rose-200">陷阱门</div>
                                <div className="text-xs text-slate-400">这不是出口。答对这道 Python 题才放你回迷宫。</div>
                            </div>
                        </div>
                        <div className="space-y-4 px-5 py-5">
                            <p className="text-sm text-slate-100">{quiz.question.prompt}</p>
                            {quiz.question.code && (
                                <pre className="overflow-x-auto rounded-xl bg-black/60 px-4 py-3 font-mono text-[13px] leading-6 text-amber-100">
                                    {quiz.question.code}
                                </pre>
                            )}
                            <div className="grid gap-2">
                                {quiz.question.options.map((option, index) => {
                                    const wrong = quiz.wrong.includes(index);
                                    return (
                                        <button
                                            key={option}
                                            onClick={() => answerQuiz(index)}
                                            className={`rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                                                wrong
                                                    ? 'border-rose-400/50 bg-rose-500/10 text-rose-200 line-through'
                                                    : 'border-white/10 bg-white/5 text-slate-200 hover:border-cyan-300/40 hover:bg-white/10'
                                            }`}
                                        >
                                            <span className="mr-2 font-mono text-xs text-slate-500">
                                                {String.fromCharCode(65 + index)}
                                            </span>
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                            {quiz.wrong.length > 0 && (
                                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-100">
                                    {quiz.question.explain}
                                </div>
                            )}
                            <button
                                onClick={() => finishQuiz('abort')}
                                className="w-full rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 transition hover:bg-white/5"
                            >
                                放弃这局，回到起点重来
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 通关 */}
            {result && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-3xl border border-amber-300/30 bg-[#100d08] p-6 text-center shadow-[0_30px_90px_rgba(251,191,36,0.25)]">
                        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
                            <Trophy className="h-7 w-7" />
                        </span>
                        <div className="mt-3 font-pixel text-2xl text-amber-200">找到出口了</div>
                        <div className="mt-1 text-lg text-amber-300">
                            {Array.from({ length: 3 }, (_, index) => (
                                <span
                                    key={index}
                                    className={`inline-block ${index < stars ? 'animate-star-pop' : ''}`}
                                    style={{ animationDelay: `${0.25 + index * 0.22}s` }}
                                >
                                    {index < stars ? '★' : '☆'}
                                </span>
                            ))}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                            <div className="rounded-xl bg-white/5 py-2">
                                <div className="text-xs text-slate-400">金币</div>
                                <div className="text-amber-200">
                                    {result.coins}/{totalCoins}
                                </div>
                            </div>
                            <div className="rounded-xl bg-white/5 py-2">
                                <div className="text-xs text-slate-400">步数</div>
                                <div className="text-slate-100">{result.steps}</div>
                            </div>
                            <div className="rounded-xl bg-white/5 py-2">
                                <div className="text-xs text-slate-400">用时</div>
                                <div className="text-slate-100">{result.seconds}s</div>
                            </div>
                        </div>
                        <div className="mt-5 flex flex-col gap-2">
                            <button
                                onClick={() => {
                                    handleReset();
                                    setCode(STARTER_CODE);
                                }}
                                className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-300"
                            >
                                再走一次
                            </button>
                            <button
                                onClick={backToDifficulty}
                                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/5"
                            >
                                换个难度
                            </button>
                            <Link
                                href="/"
                                className="rounded-xl px-4 py-2 text-xs text-slate-400 transition hover:text-slate-200"
                            >
                                回到主页
                            </Link>
                        </div>
                    </div>
                </div>
            )}

            {/* 主题角标（小地图正下方） */}
            <div className="pointer-events-none absolute left-3 top-[19rem] z-10 hidden text-[11px] text-slate-500 md:block">
                墙面材质 · {theme.name}
            </div>
        </main>
    );
}
