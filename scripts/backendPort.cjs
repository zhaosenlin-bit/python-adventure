/**
 * 读取后端端口，和前端 .env.local 的 NEXT_PUBLIC_API_PORT 保持一致。
 * QA 脚本、启动脚本共用，避免各处再写死 8000。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readBackendPort() {
    const fromEnv = Number(process.env.BACKEND_PORT || process.env.NEXT_PUBLIC_API_PORT);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

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

module.exports = { readBackendPort };
