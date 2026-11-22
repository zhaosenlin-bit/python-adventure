/**
 * Pyodide 标准库巡检：
 *  - 进入竞技场并打开挑战弹窗（弹窗会加载 Pyodide）
 *  - 校验 python_stdlib.zip 能正常安装，Python 代码可以执行
 *  - 校验控制台不再出现「Error occurred while installing the standard library」
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { removeUserByUsername } = require('./qaUserCleanup.cjs');
const { readBackendPort } = require('./backendPort.cjs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const OUT = path.join(__dirname, '..', 'qa-world');
const QA_USER = {
    username: 'qa_pyodide_bot',
    email: 'qa_pyodide_bot@example.com',
    password: 'QaPyodide#2026',
};
const API = `http://localhost:${readBackendPort()}/api/v1`;

async function postJson(pathname, body) {
    const response = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
}

async function ensureQaUser() {
    const registered = await postJson('/auth/register', QA_USER);
    if (registered && registered.access_token) return registered;
    return postJson('/auth/login', {
        username: QA_USER.username,
        password: QA_USER.password,
    });
}

(async () => {
    let auth = null;
    try {
        auth = await ensureQaUser();
    } catch (error) {
        console.log('后端不可用，无法登录：', error.message);
        process.exitCode = 1;
        return;
    }
    if (!auth || !auth.access_token) {
        console.log('QA 账号登录失败');
        process.exitCode = 1;
        return;
    }

    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
        ],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => consoleErrors.push('[pageerror] ' + String(e).slice(0, 400)));

    fs.mkdirSync(OUT, { recursive: true });

    await page.addInitScript((payload) => {
        window.localStorage.setItem(
            'auth-storage',
            JSON.stringify({ state: payload, version: 0 }),
        );
    }, { token: auth.access_token, user: auth.user, isAuthenticated: true });

    await page.goto('http://localhost:3000/world', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
    });
    await page.waitForFunction(() => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('MainScene');
        return Boolean(scene && scene.player && scene.sys && scene.sys.settings.status === 5);
    }, { timeout: 90000 });
    await page.waitForTimeout(1000);

    // 进入竞技场并用 E 打开挑战弹窗（弹窗挂载即加载 Pyodide）
    await page.evaluate(() => {
        window.__worldPhaserGame.scene.start('ArenaScene');
    });
    await page.waitForFunction(() => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('ArenaScene');
        return Boolean(scene && scene.player && scene.sys && scene.sys.settings.status === 5);
    }, { timeout: 60000 });
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
        const scene = window.__worldPhaserGame.scene.getScene('ArenaScene');
        const zone = scene.challengeZones[1];
        scene.player.setPosition(zone.x, zone.y + 20);
        scene.player.body.reset(zone.x, zone.y + 20);
    });
    await page.waitForTimeout(400);
    await page.keyboard.down('e');
    await page.waitForTimeout(250);
    await page.keyboard.up('e');

    const challengeOpened = await page
        .waitForFunction(
            () => {
                const scene = window.__worldPhaserGame.scene.getScene('ArenaScene');
                return Boolean(scene && scene.currentChallenge);
            },
            { timeout: 20000 },
        )
        .then(() => true)
        .catch(() => false);
    console.log('挑战弹窗已打开:', challengeOpened ? 'PASS' : 'FAIL');

    // 等待 Pyodide 就绪
    const pyodideReady = await page
        .waitForFunction(() => Boolean(window.__pyodideInstance), { timeout: 180000 })
        .then(() => true)
        .catch(() => false);
    console.log('Pyodide 实例就绪:', pyodideReady ? 'PASS' : 'FAIL');

    let pythonResult = null;
    if (pyodideReady) {
        pythonResult = await page.evaluate(async () => {
            try {
                const value = await window.__pyodideInstance.runPythonAsync(
                    "sum(range(10))",
                );
                return String(value);
            } catch (error) {
                return 'ERROR: ' + error.message;
            }
        });
    }
    const pythonOk = pythonResult === '45';
    console.log('Python 可执行:', pythonOk ? 'PASS' : 'FAIL', 'result=' + pythonResult);

    const stdlibError = consoleErrors.filter((text) =>
        text.includes('standard library'),
    );
    console.log('无标准库安装报错:', stdlibError.length === 0 ? 'PASS' : 'FAIL');

    await page.screenshot({ path: path.join(OUT, 'pyodide-arena-challenge.png') });

    console.log('--- 控制台错误 ---');
    console.log(consoleErrors.slice(0, 10).join('\n') || '(无)');

    await browser.close();
    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (!challengeOpened || !pyodideReady || !pythonOk || stdlibError.length > 0) {
        process.exitCode = 1;
    }
})();
