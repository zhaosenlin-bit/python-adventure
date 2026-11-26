/**
 * 迷宫探险门 —— 音效
 *
 * 用 Web Audio 现场合成（振荡器），不需要任何音频文件；
 * 静音开关持久化到 localStorage。所有函数在静音或
 * AudioContext 不可用时静默跳过。
 */

let ctx: AudioContext | null = null;
let muted = false;

const MUTE_KEY = 'maze-door-muted';

function resolveStorage(storage?: Storage | null): Storage | null {
    if (storage !== undefined) return storage;
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

export function loadMuted(storage?: Storage | null): boolean {
    try {
        muted = resolveStorage(storage)?.getItem(MUTE_KEY) === '1';
    } catch {
        muted = false;
    }
    return muted;
}

export function setMuted(value: boolean, storage?: Storage | null): void {
    muted = value;
    try {
        resolveStorage(storage)?.setItem(MUTE_KEY, value ? '1' : '0');
    } catch {
        // 忽略存储失败
    }
}

function getCtx(): AudioContext | null {
    if (muted || typeof window === 'undefined') return null;
    if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    if (ctx.state === 'suspended') {
        void ctx.resume();
    }
    return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType = 'square', gain = 0.04, delay = 0): void {
    const audio = getCtx();
    if (!audio) return;
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = audio.currentTime + delay;
    vol.gain.setValueAtTime(gain, t0);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(vol).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
}

function sweep(from: number, to: number, duration: number): void {
    const audio = getCtx();
    if (!audio) return;
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.type = 'sine';
    const t0 = audio.currentTime;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    vol.gain.setValueAtTime(0.05, t0);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.05);
    osc.connect(vol).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.1);
}

export const sfx = {
    /** 机器人前进一步 */
    step: () => tone(660, 0.06, 'square', 0.03),
    /** 原地转弯 */
    turn: () => tone(440, 0.06, 'square', 0.03),
    /** 捡到宝石/钥匙、踩压力板 */
    pickup: () => {
        tone(880, 0.09, 'sine', 0.05);
        tone(1320, 0.12, 'sine', 0.05, 0.08);
    },
    /** 传送阵 */
    warp: () => sweep(220, 900, 0.28),
    /** 撞墙/撞门 */
    crash: () => tone(110, 0.22, 'sawtooth', 0.06),
    /** 代码写错了 */
    error: () => tone(200, 0.15, 'sawtooth', 0.05),
    /** 通关小旋律 */
    win: () => {
        [523, 659, 784, 1047].forEach((freq, i) => tone(freq, 0.14, 'triangle', 0.05, i * 0.12));
    },
};
