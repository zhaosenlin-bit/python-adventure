/**
 * 开发期「一键启动后端」工具的纯逻辑部分。
 *
 * 单独拆出来是为了能直接跑单测：
 * - netstat 输出解析（找出占着端口的 PID）
 * - 进程命令行识别（区分「我们自己拉起来的 uvicorn」和「别的程序占着端口」）
 * - 启动窗口/健康状态的判定
 */

export interface ProcessInfo {
    pid: number;
    name: string;
    commandLine: string;
}

/**
 * 从 `netstat -ano -p tcp` 的输出里，找出正在 LISTENING 指定端口的 PID。
 * 去重后返回字符串数组（netstat 给的就是字符串形式的 PID）。
 */
export function parseListeningPids(netstatOutput: string, port: number): string[] {
    // 端口后面必须跟空白，避免 8000 误匹配到 80000
    const portPattern = new RegExp(`:${port}\\s`);
    const pids = new Set<string>();

    for (const rawLine of (netstatOutput || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !portPattern.test(line)) continue;
        if (!/LISTENING/i.test(line)) continue;

        const columns = line.split(/\s+/);
        const pid = columns[columns.length - 1];
        if (pid && /^\d+$/.test(pid)) {
            pids.add(pid);
        }
    }

    return Array.from(pids);
}

/**
 * 判断一条命令行是不是「我们自己拉起来的那个 uvicorn 后端」。
 * 只有确认是我们自己的进程时才允许清理，绝不误杀用户别的程序。
 */
export function isBackendCommandLine(commandLine: string): boolean {
    const lower = (commandLine || '').toLowerCase();
    // 必须命中我们自己的 FastAPI 模块名（app.main:app）。
    // 本机另一个项目的后端用的是 app.主程序:app，不会误伤。
    if (!lower.includes('app.main:app')) return false;
    // 两种启动方式都要认：
    //   python -m uvicorn app.main:app ...   （命令行直启）
    //   python launcher.py app.main:app ...  （带 SO_REUSEADDR 的启动器）
    return lower.includes('uvicorn') || lower.includes('launcher.py');
}

/**
 * 从后端日志里判断有没有「端口被占用」的报错。
 * Windows 是 [WinError 10048]，Linux 是 [Errno 98]。
 */
export function isBindConflict(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (lower.includes('10048')) return true;
    if (lower.includes('errno 98')) return true;
    if (lower.includes('address already in use')) return true;
    if (lower.includes('only one usage of each socket address')) return true;
    return false;
}

/** 启动锁是不是已经过期（上次进程崩了没来得及删锁文件） */
export function isStaleLock(lastModifiedAt: number, now: number, maxAgeMs: number): boolean {
    if (!Number.isFinite(lastModifiedAt) || lastModifiedAt <= 0) return true;
    if (!Number.isFinite(now) || now <= 0) return false;
    const elapsed = now - lastModifiedAt;
    return elapsed >= 0 && elapsed >= maxAgeMs;
}

/** 给端口占用方生成一句人能看懂的描述 */
export function describeProcess(info: ProcessInfo): string {
    const name = (info.name || '未知程序').replace(/\.exe$/i, '');
    const commandLine = (info.commandLine || '').trim();
    const short = commandLine.length > 60 ? `${commandLine.slice(0, 60)}…` : commandLine;
    return short ? `${name}（${short}）` : name;
}

/** 进程信息分类：自己的后端 / 别的程序 */
export function classifyHolder(info: ProcessInfo): 'backend' | 'foreign' {
    return isBackendCommandLine(info.commandLine) ? 'backend' : 'foreign';
}

/** 启动窗口：拉起后这段时间内都算「正在启动」，避免重复 spawn */
export function isWithinLaunchWindow(startedAt: number, now: number, windowMs: number): boolean {
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    if (!Number.isFinite(now) || now <= 0) return false;
    const elapsed = now - startedAt;
    return elapsed >= 0 && elapsed < windowMs;
}

/** 端口占用方是否已经「卡住」超过阈值（端口开着但 HTTP 一直不通） */
export function isStuckSince(suspectSince: number, now: number, thresholdMs: number): boolean {
    if (!Number.isFinite(suspectSince) || suspectSince <= 0) return false;
    const elapsed = now - suspectSince;
    return elapsed >= 0 && elapsed >= thresholdMs;
}
