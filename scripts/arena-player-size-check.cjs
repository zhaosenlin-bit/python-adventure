/**
 * 竞技场玩家尺寸巡检：
 *  - 注册/登录 QA 账号，进入 /world
 *  - 切到 ArenaScene，读取玩家立绘的显示尺寸与碰撞体尺寸
 *  - 校验立绘没有按原图(256x383)铺满屏幕，同时截图存档
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
    username: 'qa_arena_bot',
    email: 'qa_arena_bot@example.com',
    password: 'QaArena#2026',
};
const API = `http://localhost:${readBackendPort()}/api/v1`;
const MAX_PLAYER_DISPLAY_HEIGHT = 60;

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

const readArenaPlayer = (page) =>
    page.evaluate(() => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('ArenaScene');
        if (!scene || !scene.player) return null;
        const body = scene.player.body;
        return {
            displayWidth: Math.round(scene.player.displayWidth),
            displayHeight: Math.round(scene.player.displayHeight),
            bodyWidth: body ? Math.round(body.width) : null,
            bodyHeight: body ? Math.round(body.height) : null,
            x: Math.round(scene.player.x),
            y: Math.round(scene.player.y),
            playerCount: scene.children.list.filter((child) => child.texture?.key === 'player').length,
        };
    });

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
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 400)));

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

    await page.evaluate(() => {
        window.__worldPhaserGame.scene.start('ArenaScene');
    });

    await page.waitForFunction(() => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('ArenaScene');
        return Boolean(scene && scene.player && scene.sys && scene.sys.settings.status === 5);
    }, { timeout: 60000 });
    await page.waitForTimeout(1500);

    const player = await readArenaPlayer(page);
    console.log('竞技场玩家:', JSON.stringify(player));
    await page.screenshot({ path: path.join(OUT, 'arena-01-player.png') });

    const sizedOk = Boolean(player && player.displayHeight > 0 && player.displayHeight <= MAX_PLAYER_DISPLAY_HEIGHT);
    const bodyOk = Boolean(player && player.bodyHeight && player.bodyHeight <= MAX_PLAYER_DISPLAY_HEIGHT);
    const singlePlayer = Boolean(player && player.playerCount === 1);

    console.log('立绘尺寸合理:', sizedOk ? 'PASS' : 'FAIL');
    console.log('碰撞体尺寸合理:', bodyOk ? 'PASS' : 'FAIL');
    console.log('场景只有一个人物:', singlePlayer ? 'PASS' : 'FAIL');

    console.log('--- 页面错误 ---');
    console.log(errors.slice(0, 20).join('\n') || '(无)');

    await browser.close();
    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (!sizedOk || !bodyOk || !singlePlayer) {
        process.exitCode = 1;
    }
})();
