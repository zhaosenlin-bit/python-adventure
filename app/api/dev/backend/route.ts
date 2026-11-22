import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
    classifyHolder,
    describeProcess,
    isBindConflict,
    isStaleLock,
    isStuckSince,
    isWithinLaunchWindow,
    parseListeningPids,
    type ProcessInfo,
} from '@/lib/dev/backendControl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKEND_PORT =
    Number(process.env.BACKEND_PORT) || Number(process.env.NEXT_PUBLIC_API_PORT) || 8000;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

/**
 * 拉起后多久之内都算「正在启动」。
 *
 * 后端启动要把整个 FastAPI 应用 import 一遍，机器负载高的时候要几十秒
 * （实测最慢见过 70 秒）。窗口给太短的话，轮询会误以为它已经死了，
 * 于是一遍遍重启，永远也起不来。
 */
const LAUNCH_WINDOW_MS = 300_000;
const STUCK_THRESHOLD_MS = 15_000;
const TCP_PROBE_TIMEOUT_MS = 800;
const HEALTH_TIMEOUT_MS = 4_000;
const HEALTH_RETRY_DELAY_MS = 500;
const AUTO_RESPAWN_MIN_INTERVAL_MS = 4_000;
const AUTO_RESPAWN_MAX_ATTEMPTS = 5;
const LOCK_MAX_AGE_MS = 30_000;
const LOCK_WAIT_TIMEOUT_MS = 20_000;
const POST_WAIT_FOR_READY_MS = 6_000;

interface LaunchState {
    startedAt: number;
    suspectSince: number;
    pid: number;
    desired: boolean;
    attempts: number;
    lastError: string;
}

const EMPTY_STATE: LaunchState = {
    startedAt: 0,
    suspectSince: 0,
    pid: 0,
    desired: false,
    attempts: 0,
    lastError: '',
};

function isDev(): boolean {
    return process.env.NODE_ENV !== 'production';
}

const BACKEND_CANDIDATES = [
    path.join(process.cwd(), 'backend'),
    path.join(process.cwd(), '..', 'backend'),
    path.join(process.cwd(), '..', '..', 'backend'),
];

function resolveBackendDir(): string {
    for (const candidate of BACKEND_CANDIDATES) {
        if (fs.existsSync(/* turbopackIgnore: true */ path.join(candidate, 'app', 'main.py'))) {
            return candidate;
        }
    }

    return BACKEND_CANDIDATES[0];
}

const BACKEND_DIR = resolveBackendDir();
const LOG_FILE = path.join(BACKEND_DIR, 'backend.log');
const STATE_FILE = path.join(BACKEND_DIR, '.dev-backend-state.json');
const LOCK_FILE = path.join(BACKEND_DIR, '.dev-backend-start.lock');

function readState(): LaunchState {
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LaunchState>;
        return {
            startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
            suspectSince: typeof parsed.suspectSince === 'number' ? parsed.suspectSince : 0,
            pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
            desired: parsed.desired === true,
            attempts: typeof parsed.attempts === 'number' ? parsed.attempts : 0,
            lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
        };
    } catch {
        return { ...EMPTY_STATE };
    }
}

function writeState(state: LaunchState): void {
    try {
        fs.mkdirSync(BACKEND_DIR, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
    } catch {
        // 写不了状态文件不影响主流程
    }
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException)?.code === 'EPERM';
    }
}

function isPortOpen(port = BACKEND_PORT): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, '127.0.0.1');
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
        const response = await fetch(HEALTH_URL, {
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!response.ok) return false;
        // 端口被别的项目占用时，它们的 SPA 回退页也会返回 200 + HTML，
        // 只看 response.ok 会把别人误判成我们的后端在线。
        const payload = (await response.json()) as { status?: unknown } | null;
        return payload?.status === 'healthy';
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function isBackendAlive(options: { retries?: number } = {}): Promise<boolean> {
    const retries = Math.max(0, options.retries ?? 0);
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (await probeHealth()) return true;
        if (attempt < retries) await delay(HEALTH_RETRY_DELAY_MS);
    }
    return false;
}

async function waitForHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probeHealth()) return true;
        await delay(500);
    }
    return false;
}

function listPortHolders(port: number): ProcessInfo[] {
    let netstatOutput = '';
    try {
        netstatOutput = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
            encoding: 'utf8',
            windowsHide: true,
        });
    } catch {
        return [];
    }

    const pids = parseListeningPids(netstatOutput, port);
    if (pids.length === 0) return [];

    const details = readProcessInfos(pids);
    const byPid = new Map(details.map((item) => [item.pid, item]));

    return pids.map((pid) => byPid.get(Number(pid)) ?? { pid: Number(pid), name: '', commandLine: '' });
}

function readProcessInfos(pids: string[]): ProcessInfo[] {
    const pidList = pids.map((pid) => Number(pid)).filter(Number.isFinite);
    if (pidList.length === 0) return [];

    const script = [
        'Get-CimInstance Win32_Process',
        `Where-Object { $_.ProcessId -in @(${pidList.join(',')}) }`,
        'Select-Object ProcessId,Name,CommandLine',
        'ConvertTo-Json -Compress',
    ].join(' | ');

    let output = '';
    try {
        output = execFileSync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8',
            windowsHide: true,
        });
    } catch {
        return [];
    }

    const trimmed = (output || '').trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        return rows
            .filter((row) => row && typeof row === 'object')
            .map((row) => ({
                pid: Number(row.ProcessId),
                name: String(row.Name || ''),
                commandLine: String(row.CommandLine || ''),
            }))
            .filter((row) => Number.isFinite(row.pid));
    } catch {
        return [];
    }
}

function killBackendHolders(holders: ProcessInfo[]): number[] {
    const killed: number[] = [];
    for (const holder of holders) {
        if (classifyHolder(holder) !== 'backend') continue;
        try {
            execFileSync('taskkill', ['/F', '/PID', String(holder.pid), '/T'], {
                stdio: 'ignore',
                windowsHide: true,
            });
            killed.push(holder.pid);
        } catch {
            // 进程可能已经退出，忽略
        }
    }
    return killed;
}

function killBackendPid(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    const info = readProcessInfos([String(pid)]).find((item) => item.pid === pid);
    if (!info || classifyHolder(info) !== 'backend') return false;
    try {
        execFileSync('taskkill', ['/F', '/PID', String(pid), '/T'], {
            stdio: 'ignore',
            windowsHide: true,
        });
        return true;
    } catch {
        return false;
    }
}

function resolvePython(): string | null {
    for (const backendDir of BACKEND_CANDIDATES) {
        const candidates = [
            path.join(backendDir, 'venv', 'Scripts', 'python.exe'),
            path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
            path.join(backendDir, 'venv', 'bin', 'python'),
            path.join(backendDir, '.venv', 'bin', 'python'),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(/* turbopackIgnore: true */ candidate)) return candidate;
        }
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

interface SpawnResult {
    spawned: boolean;
    pid: number;
    error: string;
}

/** 拉起后端：独立进程组 + 日志落盘，Next dev 退出也不会带走它 */
function spawnBackend(): SpawnResult {
    const python = resolvePython();
    if (!python) {
        return { spawned: false, pid: 0, error: '找不到 Python 解释器（backend/venv 不存在）' };
    }

    let logFd: number | null = null;
    try {
        fs.mkdirSync(BACKEND_DIR, { recursive: true });
        logFd = fs.openSync(LOG_FILE, 'a');
    } catch {
        logFd = null;
    }

    let child;
    try {
        child = spawn(
            /* turbopackIgnore: true */
            python,
            ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(BACKEND_PORT)],
            {
                cwd: BACKEND_DIR,
                detached: true,
                windowsHide: true,
                stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
                env: {
                    ...process.env,
                    BACKEND_PORT: String(BACKEND_PORT),
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUNBUFFERED: '1',
                },
            },
        );
    } catch (error) {
        if (logFd !== null) {
            try {
                fs.closeSync(logFd);
            } catch {
                // 忽略
            }
        }
        return {
            spawned: false,
            pid: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    // 必须挂 error 监听，否则异步 spawn 失败会变成未捕获异常
    child.on('error', () => {
        // 真实错误通过下面的 pid 检查兜住，这里只负责不炸
    });

    // 父进程里这份句柄用完就关掉：子进程已经拿到了自己的副本，
    // 不关的话每启动一次就漏一个 fd，最后连日志都写不进去。
    if (logFd !== null) {
        try {
            fs.closeSync(logFd);
        } catch {
            // 忽略
        }
    }

    if (typeof child.pid !== 'number') {
        return { spawned: false, pid: 0, error: `无法启动 ${python}` };
    }

    child.unref();
    return { spawned: true, pid: child.pid, error: '' };
}

/** 读后端日志的最后一段 */
function readLogTail(maxBytes = 16_384): string {
    try {
        const size = fs.statSync(LOG_FILE).size;
        const start = Math.max(0, size - maxBytes);
        const length = size - start;
        if (length <= 0) return '';
        const fd = fs.openSync(LOG_FILE, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const read = fs.readSync(fd, buffer, 0, length, start);
            return buffer.subarray(0, read).toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return '';
    }
}

/** 从日志尾部找一条端口冲突的报错 */
function readBindConflict(): string {
    const tail = readLogTail();
    if (!tail) return '';
    const lines = tail.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0 && index > lines.length - 40; index -= 1) {
        if (isBindConflict(lines[index])) {
            return `端口 ${BACKEND_PORT} 绑定失败（可能还有残留占用），正在自动重试。`;
        }
    }
    return '';
}

/**
 * 串行化「拉起后端」这类会改变系统状态的动作。
 *
 * 之前有两个并发的 POST：它们都在 await 之前读了状态文件，
 * 都读到「还没启动过」，于是各起了一个 uvicorn，
 * 第二个必然因为端口被占而自杀（[Errno 10048]）。
 */
let startChain: Promise<unknown> = Promise.resolve();

function withStartLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = startChain.then(fn, fn);
    startChain = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

/** 跨进程的文件锁：dev server 多 worker 时也能保证只有一个在拉起 */
async function acquireStartLock(waitMs = LOCK_WAIT_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        try {
            const fd = fs.openSync(LOCK_FILE, 'wx');
            try {
                fs.writeSync(fd, String(Date.now()));
            } finally {
                fs.closeSync(fd);
            }
            return true;
        } catch {
            let mtime = 0;
            try {
                mtime = fs.statSync(LOCK_FILE).mtimeMs;
            } catch {
                mtime = 0;
            }
            if (isStaleLock(mtime, Date.now(), LOCK_MAX_AGE_MS)) {
                try {
                    fs.rmSync(LOCK_FILE, { force: true });
                } catch {
                    // 忽略
                }
                continue;
            }
            await delay(200);
        }
    }
    return false;
}

function releaseStartLock(): void {
    try {
        fs.rmSync(LOCK_FILE, { force: true });
    } catch {
        // 忽略
    }
}

/** 加锁执行一次「拉起后端」的操作 */
async function runStartOperation<T>(fn: () => Promise<T>, lockWaitMs = LOCK_WAIT_TIMEOUT_MS): Promise<T> {
    return withStartLock(async () => {
        const locked = await acquireStartLock(lockWaitMs);
        if (!locked) {
            throw new Error('等待启动锁超时，请稍后再试');
        }
        try {
            return await fn();
        } finally {
            releaseStartLock();
        }
    });
}

interface EnsureOptions {
    /** 手动触发（用户点了按钮）：重置失败计数，给足重试预算 */
    manual?: boolean;
    /** 返回前额外等一会儿，确认后端真的起来了 */
    waitForReadyMs?: number;
}

interface EnsureResult {
    started: boolean;
    running: boolean;
    starting: boolean;
    message: string;
    pid?: number;
    status?: number;
}

/** 核心逻辑：保证后端在线。幂等，重复调用不会重复拉起。 */
async function ensureBackendRunning(options: EnsureOptions = {}): Promise<EnsureResult> {
    const now = Date.now();
    let state = readState();

    // 1) 后端已经健康
    if (await isBackendAlive({ retries: 2 })) {
        writeState({ ...state, startedAt: 0, suspectSince: 0, pid: 0, attempts: 0, lastError: '' });
        return {
            started: false,
            running: true,
            starting: false,
            message: '后端已经在运行，可以重新提交了。',
        };
    }

    // 2) 我们拉起的进程还活着
    if (state.startedAt > 0 && state.pid > 0 && isProcessAlive(state.pid)) {
        if (isWithinLaunchWindow(state.startedAt, now, LAUNCH_WINDOW_MS)) {
            return {
                started: false,
                running: false,
                starting: true,
                message: '后端正在启动中，通常 8 秒左右，请稍候。',
            };
        }
        // 超过启动窗口还是不通，这个进程卡死了，清掉重来
        killBackendPid(state.pid);
        await delay(800);
        state = { ...state, pid: 0 };
    }

    // 3) 端口被占
    const portOpen = await isPortOpen();
    if (portOpen) {
        const holders = listPortHolders(BACKEND_PORT);
        const foreign = holders.filter((holder) => classifyHolder(holder) === 'foreign');
        const ours = holders.filter((holder) => classifyHolder(holder) === 'backend');

        if (foreign.length > 0) {
            return {
                started: false,
                running: false,
                starting: false,
                status: 409,
                message: `端口 ${BACKEND_PORT} 被其他程序占用：${foreign.map(describeProcess).join('；')}，请先释放该端口。`,
            };
        }

        if (ours.length === 0) {
            return {
                started: false,
                running: false,
                starting: false,
                status: 409,
                message: `端口 ${BACKEND_PORT} 已被占用，但无法确认占用程序，请先释放该端口再试。`,
            };
        }

        // 占着端口的是我们自己的后端：再耐心探一次，别急着杀
        if (await isBackendAlive({ retries: 2 })) {
            writeState({
                ...state,
                startedAt: 0,
                suspectSince: 0,
                pid: ours[0].pid,
                attempts: 0,
                lastError: '',
            });
            return {
                started: false,
                running: true,
                starting: false,
                message: '后端已经在运行，可以重新提交了。',
            };
        }

        // 刚占上不久，可能只是冷启动慢，先等等
        if (!isStuckSince(state.suspectSince, now, STUCK_THRESHOLD_MS)) {
            writeState({ ...state, suspectSince: state.suspectSince || now, desired: true });
            return {
                started: false,
                running: false,
                starting: true,
                message: '后端端口已占用但响应较慢，请稍候几秒再试。',
            };
        }

        // 确认卡死，清掉僵死实例
        killBackendHolders(ours);
        await delay(1_500);

        const remaining = listPortHolders(BACKEND_PORT);
        if (remaining.length > 0) {
            return {
                started: false,
                running: false,
                starting: false,
                status: 409,
                message: `端口 ${BACKEND_PORT} 仍被占用，请稍后再试。`,
            };
        }
    }

    // 4) 端口干净了，拉起后端
    const result = spawnBackend();
    if (!result.spawned) {
        writeState({
            ...state,
            startedAt: now,
            pid: 0,
            attempts: state.attempts + 1,
            lastError: result.error,
        });
        return {
            started: false,
            running: false,
            starting: false,
            status: 500,
            message: `启动失败：${result.error}`,
        };
    }

    writeState({
        startedAt: Date.now(),
        suspectSince: 0,
        pid: result.pid,
        desired: true,
        attempts: options.manual ? 1 : state.attempts + 1,
        lastError: '',
    });

    // 5) 等一小会儿，确认它真的起来了（顺便抓出立刻 bind 失败的场景）
    const waitMs = options.waitForReadyMs ?? 0;
    if (waitMs > 0 && (await waitForHealthy(waitMs))) {
        writeState({ ...readState(), startedAt: 0, suspectSince: 0, pid: 0, attempts: 0 });
        return {
            started: true,
            running: true,
            starting: false,
            pid: result.pid,
            message: '后端已启动，可以重新提交了。',
        };
    }

    return {
        started: true,
        running: false,
        starting: true,
        pid: result.pid,
        message: '后端正在启动，通常 8 秒左右，请稍候。',
    };
}

export async function GET() {
    if (!isDev()) {
        return Response.json({ error: '仅开发环境可用' }, { status: 403 });
    }

    const [portOpen, alive] = await Promise.all([isPortOpen(), isBackendAlive()]);
    const now = Date.now();
    let state = readState();

    if (alive) {
        // 后端在线，之前记的启动状态可以作废
        if (state.startedAt !== 0 || state.suspectSince !== 0 || state.attempts !== 0) {
            state = { ...state, startedAt: 0, suspectSince: 0, attempts: 0, lastError: '' };
            writeState(state);
        }
    } else if (state.startedAt > 0 && state.pid > 0 && !isProcessAlive(state.pid)) {
        // 我们拉起的进程已经退了，多半是端口被占导致 bind 失败自杀
        state = { ...state, pid: 0, lastError: readBindConflict() };
        writeState(state);
    } else if (portOpen && state.suspectSince === 0) {
        // 端口开着但 HTTP 不通，记下第一次出现的时间
        state = { ...state, suspectSince: now };
        writeState(state);
    } else if (!portOpen && state.suspectSince !== 0) {
        // 端口没人了，之前那个「可疑占用」记录可以清掉
        state = { ...state, suspectSince: 0 };
        writeState(state);
    }

    const processAlive = state.pid > 0 && isProcessAlive(state.pid);
    const starting = processAlive && isWithinLaunchWindow(state.startedAt, now, LAUNCH_WINDOW_MS);

    // 自愈：用户点过「一键启动」之后，后端意外挂了就自动拉回来
    if (!alive && !starting && state.desired && state.attempts < AUTO_RESPAWN_MAX_ATTEMPTS) {
        const sinceAttempt =
            state.startedAt === 0 ? Number.POSITIVE_INFINITY : now - state.startedAt;
        if (sinceAttempt >= AUTO_RESPAWN_MIN_INTERVAL_MS) {
            // 自愈只等很短的时间：拿不到锁说明已经有别的拉起动作在跑，
            // 不然每隔一秒的轮询会越积越多，把 dev server 拖垮。
            void runStartOperation(() => ensureBackendRunning({ manual: false }), 2_000).catch(() => {
                // 自愈失败就等下一次轮询
            });
        }
    }

    return Response.json({
        running: alive,
        alive,
        starting,
        portOpen,
        port: BACKEND_PORT,
        desired: state.desired,
        attempts: state.attempts,
        message: state.lastError || undefined,
    });
}

export async function POST() {
    if (!isDev()) {
        return Response.json({ error: '仅开发环境可用' }, { status: 403 });
    }

    let result: EnsureResult;
    try {
        result = await runStartOperation(() =>
            ensureBackendRunning({ manual: true, waitForReadyMs: POST_WAIT_FOR_READY_MS }),
        );
    } catch (error) {
        return Response.json(
            {
                started: false,
                running: false,
                starting: false,
                message: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }

    return Response.json(result, { status: result.status ?? 200 });
}
