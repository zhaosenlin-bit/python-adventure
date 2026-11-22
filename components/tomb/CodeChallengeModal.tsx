'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Code, Lightbulb, Loader2, Play, Terminal, X } from 'lucide-react';

import usePyodide from '@/hooks/usePyodide';
import {
    CHALLENGE_REWARD_SECONDS,
    FORCE_OPEN_SECONDS,
    TIER_LABELS,
    checkSimpleSolution,
    type ClueCodeChallenge,
} from '@/lib/tomb/codeChallenges';

interface CodeChallengeModalProps {
    challenge: ClueCodeChallenge | null;
    onClose: () => void;
    /** 挑战通过，交给上层真正挖出线索 */
    onSuccess: () => void;
    /** 蛮力撬开：扣时间，线索拿不到"证据资格" */
    onForceOpen: () => void;
}

export default function CodeChallengeModal({
    challenge,
    onClose,
    onSuccess,
    onForceOpen,
}: CodeChallengeModalProps) {
    const [code, setCode] = useState('');
    const [output, setOutput] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [failures, setFailures] = useState(0);
    const [confirmForce, setConfirmForce] = useState(false);
    const { isReady, isLoading, runCode: runPyodide } = usePyodide();

    // 每次打开都重置成初始代码
    useEffect(() => {
        if (!challenge) return;
        setCode(challenge.initialCode);
        setOutput([]);
        setIsRunning(false);
        setShowHint(false);
        setIsSuccess(false);
        setFailures(0);
        setConfirmForce(false);
    }, [challenge]);

    if (!challenge) return null;

    // 连续错两次，提示自动摊开——卡住的人不该被关在机关门口
    const noteFailure = (message: string) => {
        setOutput([message]);
        setFailures((count) => {
            const next = count + 1;
            if (next >= 2) setShowHint(true);
            return next;
        });
    };

    // Python 运行时加载失败时退回简易校验，避免玩家被卡死拿不到线索
    const runtimeUnavailable = !isReady && !isLoading;

    const finish = () => {
        setIsSuccess(true);
        setTimeout(() => {
            onSuccess();
            onClose();
        }, 1100);
    };

    const handleRun = async () => {
        if (isRunning || isSuccess) return;

        if (code.includes('___')) {
            setOutput(['还有 ___ 没有替换，先把空填上。']);
            return;
        }

        if (runtimeUnavailable) {
            if (checkSimpleSolution(code, challenge)) {
                setOutput(['机关咔哒一声，锁开了（简易校验）']);
                finish();
            } else {
                noteFailure('填入的内容还不对，再看看提示。');
            }
            return;
        }

        if (!isReady) {
            setOutput(['Python 运行时还在加载，稍等一下再运行。']);
            return;
        }

        setIsRunning(true);
        const lines = await runPyodide(code);
        setIsRunning(false);
        setOutput(lines);

        const normalized = lines.join('\n').trim();
        if (normalized === challenge.expectedOutput.trim()) {
            finish();
        } else {
            noteFailure('输出和机关上的铭文对不上，再试一次。');
        }
    };

    return (
        <AnimatePresence>
            {challenge && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
                >
                    <motion.div
                        initial={{ scale: 0.94, y: 16 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.94, y: 16 }}
                        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-400/30 bg-[#0d0a08]/95 shadow-2xl"
                    >
                        {/* 标题栏 */}
                        <div className="flex items-start justify-between gap-3 border-b border-amber-400/20 bg-amber-950/40 px-4 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-amber-300">
                                    <Code size={18} />
                                    <h3 className="font-pixel text-base sm:text-lg">{challenge.title}</h3>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
                                    写对这段 Python，机关才会把线索交给你；破解成功回赠 {CHALLENGE_REWARD_SECONDS} 秒。
                                </p>
                                <span className="mt-1.5 inline-block rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200/90">
                                    {TIER_LABELS[challenge.tier]}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                                aria-label="关闭"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 题面 */}
                        <p className="px-4 pt-3 text-sm leading-relaxed text-slate-300">
                            {challenge.description}
                        </p>

                        {/* 代码 + 输出 */}
                        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-4 py-3 md:grid-cols-5">
                            <div className="md:col-span-3">
                                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                                    <span>编辑代码</span>
                                    <span className="font-mono text-amber-300/70">
                                        期望输出：{challenge.expectedOutput}
                                    </span>
                                </div>
                                <textarea
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    spellCheck={false}
                                    autoFocus
                                    className="h-56 w-full resize-none rounded-xl border border-white/10 bg-black/70 p-3 font-mono text-sm leading-relaxed text-emerald-200 outline-none focus:border-amber-400/50 sm:h-64"
                                />
                                {!showHint && (
                                    <button
                                        type="button"
                                        onClick={() => setShowHint(true)}
                                        className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-amber-300"
                                    >
                                        <Lightbulb size={14} />
                                        需要提示？
                                    </button>
                                )}
                                {showHint && (
                                    <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-200">
                                        {challenge.hint}
                                    </p>
                                )}
                            </div>
                            <div className="flex min-h-0 flex-col md:col-span-2">
                                <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
                                    <Terminal size={13} />
                                    输出
                                </div>
                                <div className="min-h-24 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-xs leading-relaxed text-amber-100/90">
                                    {output.length > 0 ? (
                                        output.map((line, index) => (
                                            <div
                                                key={index}
                                                className={
                                                    line.startsWith('Error') ? 'text-rose-400' : undefined
                                                }
                                            >
                                                {line}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-slate-600">点击「运行」查看结果</span>
                                    )}
                                </div>

                                {runtimeUnavailable && (
                                    <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                                        Python 运行时没能加载，已切换到简易校验：只要填空正确即可通过。
                                    </p>
                                )}

                                <button
                                    type="button"
                                    onClick={handleRun}
                                    disabled={isRunning || isSuccess}
                                    className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                                        isSuccess
                                            ? 'bg-emerald-600 text-white'
                                            : isRunning || !isReady
                                              ? 'cursor-wait bg-slate-700 text-slate-300'
                                              : 'bg-amber-600 text-white hover:bg-amber-500'
                                    }`}
                                >
                                    {isSuccess ? (
                                        <>
                                            <CheckCircle size={18} />
                                            机关已破解！
                                        </>
                                    ) : isRunning ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            运行中…
                                        </>
                                    ) : !isReady && !runtimeUnavailable ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Python 加载中…
                                        </>
                                    ) : (
                                        <>
                                            <Play size={18} />
                                            运行代码
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* 常驻底栏：解不开时的退路，不随代码栏一起滚走 */}
                        {isSuccess ? (
                            <div className="border-t border-emerald-400/20 bg-emerald-950/30 px-4 py-2 text-center text-[11px] text-emerald-300/80">
                                机关认输，线索归你。
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-white/10 bg-black/40 px-4 py-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!confirmForce) {
                                            setConfirmForce(true);
                                            return;
                                        }
                                        onForceOpen();
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-[11px] leading-none transition-colors ${
                                        confirmForce
                                            ? 'border-rose-400/50 bg-rose-950/60 text-rose-200'
                                            : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-rose-400/35 hover:text-rose-200'
                                    }`}
                                >
                                    {confirmForce
                                        ? `再点一次确认：扣掉 ${FORCE_OPEN_SECONDS} 秒`
                                        : `实在解不开？蛮力撬开（-${FORCE_OPEN_SECONDS} 秒）`}
                                </button>
                                <span className="text-[10px] leading-relaxed text-slate-500">
                                    撬开的线索表决时不能当证据，只能算&quot;知道&quot;
                                </span>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
