/**
 * 启动本地后端（FastAPI + uvicorn）。
 *
 * 端口从 .env.local 的 NEXT_PUBLIC_API_PORT 读取（默认 8000），
 * 保证前端请求地址、WebSocket、界面里的「一键启动」用的是同一个端口。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');

/** 从 .env.local / .env 里读 NEXT_PUBLIC_API_PORT */
function readPortFromEnvFile() {
    for (const name of ['.env.local', '.env']) {
        const file = path.join(ROOT, name);
        if (!fs.existsSync(file)) continue;
        try {
            const content = fs.readFileSync(file, 'utf8');
            const match = content.match(/^\s*NEXT_PUBLIC_API_PORT\s*=\s*(\d+)\s*$/m);
            if (match) return Number(match[1]);
        } catch {
            // 读不了就继续找下一个
        }
    }
    return 8000;
}

const port = Number(process.env.BACKEND_PORT) || readPortFromEnvFile();
const python = process.platform === 'win32'
    ? path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(BACKEND_DIR, 'venv', 'bin', 'python');

if (!fs.existsSync(python)) {
    console.error(`找不到 Python 解释器：${python}`);
    console.error('请先在 backend 目录创建虚拟环境：python -m venv venv');
    process.exit(1);
}

console.log(`后端启动中：http://localhost:${port}`);

const child = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(port)],
    { cwd: BACKEND_DIR, stdio: 'inherit' },
);

child.on('error', (error) => {
    console.error('后端启动失败：', error.message);
    process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
