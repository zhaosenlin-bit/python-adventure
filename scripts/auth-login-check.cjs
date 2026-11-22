/** 登录/注册错误提示的端到端检查：界面文案、控制台日志、账号清理 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const { removeUserByUsername } = require('./qaUserCleanup.cjs');
const { readBackendPort } = require('./backendPort.cjs');

const QA_USER = { username: 'qa_auth_bot', email: 'qa_auth_bot@example.com', password: 'QaAuth#2026' };
const BACKEND_PORT = readBackendPort();
const API = `http://localhost:${BACKEND_PORT}/api/v1`;

async function postJson(pathname, body) {
    const response = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
}

/** 把本项目的后端停掉，用来模拟「后端没连上」 */
function stopBackend() {
    let output = '';
    try {
        output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    } catch {
        return false;
    }

    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
        if (!new RegExp(`:${BACKEND_PORT}\\s`).test(line) || !/LISTENING/i.test(line)) continue;
        const columns = line.trim().split(/\s+/);
        pids.add(columns[columns.length - 1]);
    }

    let stopped = false;
    for (const pid of pids) {
        try {
            execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
            stopped = true;
        } catch {
            // 进程可能已经退出
        }
    }

    // venv 的 python.exe 是个转发器，会作为父进程残留下来，这里按命令行精确清掉。
    // 只认 app.main:app（本机另一个项目用的是 app.主程序:app，不会误伤）；
    // 两种启动方式都覆盖：uvicorn app.main:app 与 launcher.py app.main:app。
    const cleanup = [
        'Get-CimInstance Win32_Process',
        "Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*app.main:app*' }",
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    ].join(' | ');
    try {
        execSync(`powershell -NoProfile -Command "${cleanup}"`, { stdio: 'ignore' });
    } catch {
        // 清理失败不影响用例结论
    }
    return stopped;
}

/** 确认后端在线（脚本收尾时保证环境是好的） */
async function ensureBackend() {
    try {
        const response = await fetch('http://localhost:3000/api/dev/backend', { method: 'POST' });
        return response.ok;
    } catch {
        return false;
    }
}

/** 读取表单上红色提示框里的文案 */
async function readErrorBox(page) {
    return page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('div'));
        const box = nodes.find(
            (node) => typeof node.className === 'string' && node.className.includes('bg-red-900/50'),
        );
        return box ? (box.textContent || '').trim() : '';
    });
}

(async () => {
    const results = [];
    const fail = (name, detail) => results.push({ name, ok: false, detail });
    const pass = (name, detail) => results.push({ name, ok: true, detail });

    // 开跑前先确保后端在线，否则前面的用例测的是「后端没起」而不是被测逻辑
    await ensureBackend();

    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const consoleErrors = [];
    const consoleWarns = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
        if (message.type() === 'warning') consoleWarns.push(message.text());
    });

    try {
        await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('input[placeholder="输入用户名"]', { timeout: 30000 });

        // 1) 密码错误：界面要给中文提示，不能出现 {}
        await page.fill('input[placeholder="输入用户名"]', 'codextest1');
        await page.fill('input[placeholder="输入密码"]', 'definitely-wrong-password');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2500);

        const wrongPwdText = await readErrorBox(page);
        if (wrongPwdText.includes('{}')) {
            fail('密码错误提示', `界面仍然显示原始 JSON：${wrongPwdText}`);
        } else if (!wrongPwdText) {
            fail('密码错误提示', '界面没有出现任何错误提示');
        } else {
            pass('密码错误提示', wrongPwdText);
        }

        // 2) 密码错误不应该触发 console.error（否则 Next 开发浮层会弹红框）
        const authConsoleErrors = consoleErrors.filter((text) => text.includes('[AuthStore]'));
        if (authConsoleErrors.length > 0) {
            fail('控制台日志等级', `仍然有 console.error：${authConsoleErrors.join(' | ')}`);
        } else {
            pass('控制台日志等级', '密码错误只记 warn，不触发开发浮层红框');
        }

        // 3) 注册页：非法邮箱应该在前端就被拦下
        await page.click('text=立即注册');
        await page.waitForTimeout(600);
        await page.fill('input[placeholder="输入用户名"]', QA_USER.username);
        await page.fill('input[type="email"]', '12sds@fdvd');
        await page.fill('input[placeholder="至少 6 位"]', QA_USER.password);
        await page.fill('input[placeholder="再次输入密码"]', QA_USER.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(1200);

        const emailText = await readErrorBox(page);
        if (emailText.includes('邮箱')) {
            pass('非法邮箱前端拦截', emailText);
        } else {
            fail('非法邮箱前端拦截', `期望出现邮箱提示，实际是：${emailText || '(无)'}`);
        }

        // 4) 合法注册 → 自动登录 → 进入首页
        await page.fill('input[type="email"]', QA_USER.email);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(4000);

        const loggedIn = await page.evaluate(() => {
            const raw = window.localStorage.getItem('auth-storage');
            return raw ? JSON.parse(raw)?.state?.isAuthenticated === true : false;
        });
        if (loggedIn) {
            pass('注册后自动登录', 'isAuthenticated = true');
        } else {
            fail('注册后自动登录', '本地存储里没有登录态');
        }

        // 5) 后端掉线 → 界面给一键启动入口 → 点了能恢复
        // 用全新 context（没有本地登录态），避开首页大场景初始化拖慢重载
        const offlinePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await offlinePage.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await offlinePage.waitForSelector('input[placeholder="输入用户名"]', { timeout: 30000 });

        stopBackend();
        await offlinePage.waitForTimeout(1200);

        await offlinePage.fill('input[placeholder="输入用户名"]', QA_USER.username);
        await offlinePage.fill('input[placeholder="输入密码"]', 'whatever-password');
        await offlinePage.click('button[type="submit"]');
        await offlinePage.waitForTimeout(3000);

        const hintVisible = await offlinePage.locator('text=后端服务没连上').count();
        if (hintVisible > 0) {
            pass('后端掉线提示', '界面出现「后端服务没连上」');
        } else {
            fail('后端掉线提示', '没有出现一键启动入口');
        }

        const startButton = offlinePage.locator('[data-testid="backend-start-button"]').first();
        if ((await startButton.count()) > 0) {
            // 启动后端要十几秒（机器负载高的时候更久），这里轮询等待而不是死等固定时间。
            // 按钮在启动过程中是禁用的，点不动不代表失败，继续等就行。
            let backendAlive = false;
            const deadline = Date.now() + 120000;
            for (let round = 0; round < 3 && !backendAlive; round += 1) {
                try {
                    await startButton.click({ timeout: 5000 });
                } catch {
                    // 按钮已经是「启动中…」或「已启动」，说明拉起动作在进行中
                }
                while (!backendAlive && Date.now() < deadline) {
                    await offlinePage.waitForTimeout(1000);
                    backendAlive = await offlinePage
                        .evaluate(async () => {
                            const response = await fetch('/api/dev/backend');
                            const data = await response.json();
                            return data.running === true;
                        })
                        .catch(() => false);
                }
            }
            if (backendAlive) {
                pass('一键启动后端', '点击后端已恢复在线');
            } else {
                fail('一键启动后端', '点击之后后端仍未在线');
            }
        } else {
            fail('一键启动后端', '没找到「一键启动」按钮');
        }
    } catch (error) {
        fail('执行异常', error && error.message ? error.message : String(error));
    } finally {
        await browser.close();
        removeUserByUsername(QA_USER.username);
        await ensureBackend();
    }

    let failed = 0;
    for (const result of results) {
        console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  ->  ${result.detail}`);
        if (!result.ok) failed += 1;
    }
    console.log(`\n${results.length - failed}/${results.length} 通过`);
    // 给残留的句柄一点收尾时间，避免 Node 退出时的 libuv 断言
    await new Promise((resolve) => setTimeout(resolve, 800));
    process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
    console.error('FATAL', error);
    process.exit(1);
});
