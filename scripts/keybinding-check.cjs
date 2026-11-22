/**
 * 按键巡检：逐个验证 HUD 上宣传的按键真的生效。
 *
 * 开放世界（MainScene）：
 *  - ↓ / S   空中按下 → 应触发快速下落
 *  - E / F   靠近「密码门」站点按下 → 应触发 stationInteraction
 *
 * 竞技场（ArenaScene）：
 *  - E / F   站在挑战台座上按下 → 应开始挑战（currentChallenge 被赋值）
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
    username: 'qa_key_bot',
    email: 'qa_key_bot@example.com',
    password: 'QaKey#2026',
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

const dumpState = (page, label) =>
    page.evaluate((tag) => {
        const game = window.__worldPhaserGame;
        const scene = game && game.scene && game.scene.getScene('MainScene');
        const active = document.activeElement;
        return {
            tag,
            activeElement: active ? active.tagName + '#' + (active.id || '') : null,
            loopRunning: game ? game.loop.running !== false : null,
            physicsPaused: scene ? scene.physics.world.isPaused : null,
            playerY: scene ? Math.round(scene.player.y) : null,
            velocityY: scene ? Math.round(scene.player.body.velocity.y) : null,
        };
    }, label);

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
        window.__stationInteractions = [];
        window.addEventListener('stationInteraction', (e) => {
            window.__stationInteractions.push(e.detail && e.detail.stationId);
        });
    }, { token: auth.access_token, user: auth.user, isAuthenticated: true });

    const openWorld = async () => {
        await page.goto('http://localhost:3000/world', {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
        });
        await page.waitForFunction(() => {
            const game = window.__worldPhaserGame;
            const scene = game && game.scene && game.scene.getScene('MainScene');
            return Boolean(scene && scene.player && scene.sys && scene.sys.settings.status === 5);
        }, { timeout: 90000 });
        await page.waitForTimeout(1200);
    };

    const results = [];

    // ================= 开放世界 =================
    await openWorld();

    // 1) 下 / S 快速下落（先测，避免被弹窗干扰）
    // 临时关掉重力做确定性验证：按住下键时速度会被快速下坠逻辑推高，不按则保持不变。
    await page.evaluate(() => {
        const scene = window.__worldPhaserGame.scene.getScene('MainScene');
        scene.physics.world.gravity.y = 0;
        scene.player.setPosition(scene.spawnPoint.x, 180);
        scene.player.body.reset(scene.spawnPoint.x, 180);
        scene.player.setVelocity(0, 0);
        scene.player.setVelocityY(50);
    });
    await page.waitForTimeout(300);
    const beforeFall = await dumpState(page, 'before-fall');
    await page.keyboard.down('ArrowDown');
    // headless 软渲染帧率很低，固定等待可能只跑一两帧，这里轮询等速度越过阈值。
    const fellFast = await page
        .waitForFunction(
            () => {
                const scene = window.__worldPhaserGame.scene.getScene('MainScene');
                return scene.player.body.velocity.y > 400;
            },
            { timeout: 20000 },
        )
        .then(() => true)
        .catch(() => false);
    const duringFall = await dumpState(page, 'during-fall');
    await page.keyboard.up('ArrowDown');
    await page.evaluate(() => {
        const scene = window.__worldPhaserGame.scene.getScene('MainScene');
        scene.physics.world.gravity.y = 500;
    });
    results.push([
        '开放世界 下 快速下落',
        fellFast && duringFall.velocityY > 400,
        `before=${beforeFall.velocityY} during=${duringFall.velocityY} y=${duringFall.playerY}`,
    ]);

    const standAtDoor = async () => {
        await page.evaluate(() => {
            const scene = window.__worldPhaserGame.scene.getScene('MainScene');
            const station = scene.stations.find((s) => s.id === 'secret');
            scene.player.setPosition(station.x, station.y - 40);
            scene.player.body.reset(station.x, station.y - 40);
            window.__stationInteractions.length = 0;
        });
        await page.waitForTimeout(450);
    };

    const closeModals = async () => {
        await page.evaluate(() => {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
        });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
    };

    // 2) E 互动密码门
    await standAtDoor();
    await page.keyboard.down('e');
    await page.waitForTimeout(200);
    await page.keyboard.up('e');
    await page.waitForTimeout(400);
    const afterE = await page.evaluate(() => window.__stationInteractions.slice());
    results.push(['开放世界 E 互动', afterE.includes('secret'), JSON.stringify(afterE)]);

    await closeModals();

    // 3) F 互动密码门
    await standAtDoor();
    await page.keyboard.down('f');
    await page.waitForTimeout(200);
    await page.keyboard.up('f');
    await page.waitForTimeout(400);
    const afterF = await page.evaluate(() => window.__stationInteractions.slice());
    results.push(['开放世界 F 互动', afterF.includes('secret'), JSON.stringify(afterF)]);

    await closeModals();

    // ================= 竞技场 =================
    // 每个键都用全新页面：挑战弹窗打开后会抢占焦点，干扰后续按键。
    const runArenaKeyTest = async (key, label) => {
        await openWorld();
        await page.evaluate(() => {
            window.__worldPhaserGame.scene.start('ArenaScene');
        });
        await page.waitForFunction(() => {
            const game = window.__worldPhaserGame;
            const scene = game && game.scene && game.scene.getScene('ArenaScene');
            return Boolean(scene && scene.player && scene.sys && scene.sys.settings.status === 5);
        }, { timeout: 60000 });
        await page.waitForTimeout(1200);

        await page.evaluate(() => {
            const scene = window.__worldPhaserGame.scene.getScene('ArenaScene');
            const zone = scene.challengeZones[1];
            scene.player.setPosition(zone.x, zone.y + 20);
            scene.player.body.reset(zone.x, zone.y + 20);
        });
        await page.waitForTimeout(450);

        await page.keyboard.down(key);
        await page.waitForTimeout(250);
        const state = await page.evaluate(() => {
            const scene = window.__worldPhaserGame.scene.getScene('ArenaScene');
            return {
                title: scene.currentChallenge ? scene.currentChallenge.title : null,
                near: Boolean(scene.isNearChallenge),
                keyDown: Boolean(
                    (scene.eKey && scene.eKey.isDown) ||
                    (scene.interactKey && scene.interactKey.isDown),
                ),
            };
        });
        await page.keyboard.up(key);
        results.push([label, Boolean(state.title), JSON.stringify(state)]);
    };

    await runArenaKeyTest('e', '竞技场 E 开始挑战');
    await runArenaKeyTest('f', '竞技场 F 开始挑战');

    await page.screenshot({ path: path.join(OUT, 'keybinding-arena.png') });

    console.log('--- 按键巡检 ---');
    let allPass = true;
    for (const [name, ok, detail] of results) {
        if (!ok) allPass = false;
        console.log(name + ':', ok ? 'PASS' : 'FAIL', detail);
    }

    console.log('--- 页面错误 ---');
    console.log(errors.slice(0, 20).join('\n') || '(无)');

    await browser.close();
    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (!allPass) {
        process.exitCode = 1;
    }
})();
