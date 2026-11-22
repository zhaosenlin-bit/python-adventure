/**
 * 开放世界「O 键瞬移回起点」自动巡检：
 *  - 注册/登录 QA 账号，进入 /world
 *  - 把玩家挪到远处，按 O，校验坐标回到起点
 *  - 冷却期内再按一次 O，校验不会重复触发
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
    username: 'qa_world_bot',
    email: 'qa_world_bot@example.com',
    password: 'QaWorld#2026',
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

const readScene = (page) =>
    page.evaluate(() => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('MainScene');
        if (!scene || !scene.player) return null;
        return {
            x: Math.round(scene.player.x),
            y: Math.round(scene.player.y),
            spawn: scene.spawnPoint
                ? { x: Math.round(scene.spawnPoint.x), y: Math.round(scene.spawnPoint.y) }
                : null,
            cooldown: scene.teleportCooldown,
            skills: scene.playerSkills ? [...scene.playerSkills] : [],
            hud: scene.infoText ? scene.infoText.text : '',
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
    await page.waitForTimeout(1500);

    const spawn = await readScene(page);
    console.log('起点状态:', JSON.stringify(spawn));

    // 把玩家挪到远离起点的位置
    await page.evaluate(() => {
        const scene = window.__worldPhaserGame.scene.getScene('MainScene');
        scene.player.setPosition(2200, 180);
        scene.player.body.reset(2200, 180);
    });
    await page.waitForTimeout(700);
    const before = await readScene(page);
    console.log('瞬移前:', JSON.stringify(before));
    await page.screenshot({ path: path.join(OUT, 'world-01-far.png') });

    // 按 O 触发瞬移
    await page.keyboard.press('o');
    await page.waitForTimeout(1300);
    const after = await readScene(page);
    console.log('瞬移后:', JSON.stringify(after));
    await page.screenshot({ path: path.join(OUT, 'world-02-after-o.png') });

    const moved = before && after && Math.abs(after.x - before.x) > 100;
    const backToSpawn =
        after && spawn && spawn.spawn &&
        Math.abs(after.x - spawn.spawn.x) < 8 &&
        Math.abs(after.y - spawn.spawn.y) < 80;
    const skillListed = Boolean(after && after.skills.includes('teleport'));
    const hudHasKey = Boolean(after && after.hud.includes('O 瞬移回起点'));

    console.log('位移生效:', moved ? 'PASS' : 'FAIL');
    console.log('回到起点:', backToSpawn ? 'PASS' : 'FAIL');
    console.log('技能已挂载:', skillListed ? 'PASS' : 'FAIL');
    console.log('HUD 提示:', hudHasKey ? 'PASS' : 'FAIL');

    // 冷却期内再按一次 O，不应该再次瞬移
    await page.keyboard.press('o');
    await page.waitForTimeout(600);
    const cooling = await readScene(page);
    const coolingWorks = Boolean(cooling && cooling.cooldown > 0);
    console.log('冷却生效:', coolingWorks ? 'PASS' : 'FAIL', 'cooldown=', cooling && cooling.cooldown);

    console.log('--- 页面错误 ---');
    console.log(errors.slice(0, 20).join('\n') || '(无)');

    await browser.close();
    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (!moved || !backToSpawn || !skillListed || !hudHasKey || !coolingWorks) {
        process.exitCode = 1;
    }
})();
