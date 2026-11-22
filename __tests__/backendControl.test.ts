import {
    classifyHolder,
    describeProcess,
    isBindConflict,
    isBackendCommandLine,
    isStaleLock,
    isStuckSince,
    isWithinLaunchWindow,
    parseListeningPids,
} from '@/lib/dev/backendControl';

const NETSTAT_SAMPLE = [
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5144',
    '  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       21196',
    '  TCP    127.0.0.1:8000         127.0.0.1:50364       TIME_WAIT       0',
    '  TCP    0.0.0.0:80000          0.0.0.0:0              LISTENING       99999',
].join('\r\n');

describe('parseListeningPids', () => {
    it('找出正在监听指定端口的 PID', () => {
        expect(parseListeningPids(NETSTAT_SAMPLE, 8000)).toEqual(['21196']);
    });

    it('忽略 TIME_WAIT 等非监听状态', () => {
        expect(parseListeningPids(NETSTAT_SAMPLE, 8000)).not.toContain('0');
    });

    it('不会把 8000 端口误匹配成 80000', () => {
        expect(parseListeningPids(NETSTAT_SAMPLE, 8000)).not.toContain('99999');
    });

    it('同一 PID 出现多次时去重', () => {
        const duplicated = [
            '  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       777',
            '  TCP    [::]:8000              [::]:0                 LISTENING       777',
        ].join('\n');
        expect(parseListeningPids(duplicated, 8000)).toEqual(['777']);
    });

    it('空输入返回空数组', () => {
        expect(parseListeningPids('', 8000)).toEqual([]);
    });
});

describe('isBackendCommandLine', () => {
    it('认得出我们自己拉起的 uvicorn', () => {
        expect(
            isBackendCommandLine(
                '"C:\\...\\backend\\venv\\Scripts\\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000',
            ),
        ).toBe(true);
    });

    it('不会把别的 uvicorn 应用当成我们的后端', () => {
        expect(isBackendCommandLine('python.exe -m uvicorn other.app:api --port 8000')).toBe(false);
    });

    it('普通 python 进程不算', () => {
        expect(isBackendCommandLine('python.exe some_script.py')).toBe(false);
    });

    it('认得出走 launcher.py 的启动方式', () => {
        expect(
            isBackendCommandLine(
                '"C:\\...\\backend\\venv\\Scripts\\python.exe" launcher.py app.main:app --host 0.0.0.0 --port 8010',
            ),
        ).toBe(true);
    });

    it('不会把本机另一个项目（app.主程序:app）当成自家后端', () => {
        expect(
            isBackendCommandLine(
                'D:\\...\\ai-study\\.venv\\Scripts\\python.exe -m uvicorn app.主程序:app --host 0.0.0.0 --port 8000',
            ),
        ).toBe(false);
    });

    it('空命令行返回 false', () => {
        expect(isBackendCommandLine('')).toBe(false);
    });
});

describe('classifyHolder', () => {
    it('自家后端归为 backend', () => {
        expect(
            classifyHolder({
                pid: 1,
                name: 'python.exe',
                commandLine: 'python.exe -m uvicorn app.main:app --port 8000',
            }),
        ).toBe('backend');
    });

    it('别的程序归为 foreign', () => {
        expect(
            classifyHolder({
                pid: 2,
                name: 'node.exe',
                commandLine: 'node.exe some-server.js',
            }),
        ).toBe('foreign');
    });
});

describe('describeProcess', () => {
    it('去掉 .exe 后缀并带上命令行', () => {
        const text = describeProcess({
            pid: 3,
            name: 'node.exe',
            commandLine: 'node.exe server.js',
        });
        expect(text).toContain('node');
        // 进程名去掉 .exe，命令行保持原样
        expect(text.startsWith('node（')).toBe(true);
        expect(text).toContain('server.js');
    });

    it('命令行过长时截断', () => {
        const text = describeProcess({
            pid: 4,
            name: 'node.exe',
            commandLine: 'x'.repeat(200),
        });
        expect(text.length).toBeLessThan(100);
    });
});

describe('isWithinLaunchWindow', () => {
    it('窗口内返回 true', () => {
        expect(isWithinLaunchWindow(1000, 1500, 90_000)).toBe(true);
    });

    it('窗口外返回 false', () => {
        expect(isWithinLaunchWindow(1000, 100_000, 90_000)).toBe(false);
    });

    it('从未启动过（0）返回 false', () => {
        expect(isWithinLaunchWindow(0, 5000, 90_000)).toBe(false);
    });
});

describe('isStuckSince', () => {
    it('卡够时间才算僵死', () => {
        expect(isStuckSince(1000, 3000, 2000)).toBe(true);
    });

    it('刚出现还不算', () => {
        expect(isStuckSince(1000, 1500, 2000)).toBe(false);
    });

    it('没记录就返回 false', () => {
        expect(isStuckSince(0, 9999, 100)).toBe(false);
    });
});

describe('isBindConflict', () => {
    it('认得出 Windows 的 10048', () => {
        expect(
            isBindConflict(
                "ERROR:    [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8010)",
            ),
        ).toBe(true);
    });

    it('认得出 Linux 的 98', () => {
        expect(isBindConflict('[Errno 98] error while attempting to bind on address')).toBe(true);
    });

    it('认得出英文描述', () => {
        expect(isBindConflict('error: Address already in use')).toBe(true);
    });

    it('普通日志不算冲突', () => {
        expect(isBindConflict('INFO:     Started server process [1234]')).toBe(false);
    });
});

describe('isStaleLock', () => {
    it('超过最大存活时间算过期锁', () => {
        expect(isStaleLock(1000, 40_000, 30_000)).toBe(true);
    });

    it('还在有效期内不算过期', () => {
        expect(isStaleLock(1000, 5000, 30_000)).toBe(false);
    });

    it('读不到修改时间按过期处理', () => {
        expect(isStaleLock(0, 5000, 30_000)).toBe(true);
    });
});
