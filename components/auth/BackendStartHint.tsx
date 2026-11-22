"use client";

import { useEffect, useRef, useState } from 'react';
import { Loader2, ServerCog } from 'lucide-react';

type Status = 'idle' | 'starting' | 'done' | 'failed';

/** 后端冷启动大约 8 秒；机器负载高时会更慢，这里留足余量 */
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 75;
/** dev server 正在热更新时，第一次请求可能落空，这里重试几次 */
const START_MAX_ATTEMPTS = 3;
const START_RETRY_DELAY_MS = 1500;

type StartResponse = {
    running?: boolean;
    starting?: boolean;
    started?: boolean;
    message?: string;
};

type StartOutcome = {
    ok: boolean;
    status: number;
    data: StartResponse | null;
};

/** 发起启动请求，失败自动重试（dev server 重建时最容易第一次失败） */
async function requestBackendStart(): Promise<StartOutcome> {
    let last: StartOutcome = { ok: false, status: 0, data: null };

    for (let attempt = 0; attempt < START_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch('/api/dev/backend', { method: 'POST' });
            const data = (await response.json().catch(() => null)) as StartResponse | null;
            last = { ok: response.ok, status: response.status, data };
            // 403（生产环境）和 409（端口冲突）都有明确答复，重试也没用
            if (response.ok || response.status === 403 || response.status === 409) {
                return last;
            }
        } catch {
            // 继续重试
        }
        if (attempt < START_MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
        }
    }
    return last;
}

/** 轮询后端状态，直到它真的能服务 */
async function waitForBackend(isCancelled: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (isCancelled()) return false;

        try {
            const response = await fetch('/api/dev/backend', { cache: 'no-store' });
            if (!response.ok) continue;
            const data = await response.json();
            if (data?.running === true) return true;
        } catch {
            // 开发服务器这一瞬间不可用，继续等
        }
    }
    return false;
}

/**
 * 后端没连上时的一键启动入口。
 * 走 Next 的开发期接口拉起后端，避免用户手动开窗口。
 * 接口是「异步拉起 + 立刻返回」的，所以这里拿到 starting 后要轮询等待。
 */
export default function BackendStartHint() {
    const [status, setStatus] = useState<Status>('idle');
    const [message, setMessage] = useState('');

    /**
     * 生命周期令牌。
     *
     * 开发模式下 React StrictMode 会把组件挂载两次（挂载 → 卸载 → 挂载）。
     * 如果用「卸载就置 true」的取消标志位，第二次挂载后标志位会一直是 true，
     * 轮询会在第一轮就判定失败，按钮永远显示「启动超时」。
     * 这里改成自增令牌：每次挂载刷新，点击时记下当时的令牌，
     * 只有令牌变了才说明组件已经不是刚才那一个了。
     */
    const lifecycleRef = useRef(0);

    useEffect(() => {
        lifecycleRef.current += 1;
        const token = lifecycleRef.current;
        return () => {
            if (lifecycleRef.current === token) {
                lifecycleRef.current += 1;
            }
        };
    }, []);

    const startBackend = async () => {
        const token = lifecycleRef.current;
        if (token === 0) return;

        setStatus('starting');
        setMessage('正在启动后端服务…');
        try {
            const outcome = await requestBackendStart();
            if (lifecycleRef.current !== token) return;

            if (!outcome.data) {
                setStatus('failed');
                setMessage('启动请求没能送达，请手动运行 scripts/start-backend.bat');
                return;
            }
            if (outcome.status === 403) {
                setStatus('failed');
                setMessage('当前环境不支持自动启动，请手动启动后端服务。');
                return;
            }

            const data = outcome.data;
            if (data.running) {
                setStatus('done');
                setMessage('后端已经在运行，可以重新提交了。');
            } else if (data.starting) {
                setMessage('后端正在启动，通常 8 秒左右…');
                const alive = await waitForBackend(() => lifecycleRef.current !== token);
                if (lifecycleRef.current !== token) return;
                if (alive) {
                    setStatus('done');
                    setMessage('后端已启动，可以重新提交了。');
                } else {
                    setStatus('failed');
                    setMessage('后端启动超时，请查看 backend/backend.log，或手动运行 scripts/start-backend.bat');
                }
            } else {
                setStatus('failed');
                setMessage(data.message || '后端启动失败，请查看 backend/backend.log');
            }
        } catch {
            if (lifecycleRef.current !== token) return;
            setStatus('failed');
            setMessage('启动请求本身也失败了，请手动运行 scripts/start-backend.bat');
        }
    };

    return (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/40 p-3 text-sm text-amber-200">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                    <ServerCog className="h-4 w-4 shrink-0" />
                    后端服务没连上
                </span>
                <button
                    type="button"
                    data-testid="backend-start-button"
                    onClick={startBackend}
                    disabled={status === 'starting' || status === 'done'}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 px-3 py-1.5 text-xs font-pixel text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {status === 'starting' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {status === 'starting' ? '启动中…' : status === 'done' ? '已启动' : '一键启动'}
                </button>
            </div>
            {message ? <p className="mt-2 text-xs leading-5 text-amber-300/80">{message}</p> : null}
        </div>
    );
}
