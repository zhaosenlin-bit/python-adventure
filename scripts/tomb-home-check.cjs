/** 首页「古墓剧本杀」入口的桌面端 / 移动端视觉检查 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const { removeUserByUsername } = require('./qaUserCleanup.cjs');
const { readBackendPort } = require('./backendPort.cjs');
const OUT = path.join(__dirname, '..', 'qa-tomb');

const QA_USER = { username: 'qa_tomb_bot', email: 'qa_tomb_bot@example.com', password: 'QaTomb#2026' };
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

/** 拿一个可用登录态：先登录已有账号，没有就临时注册一个（结束后清理） */
async function resolveAuth() {
    try {
        let data = await postJson('/auth/login', {
            username: QA_USER.username,
            password: QA_USER.password,
        });
        if (!data) {
            await postJson('/auth/register', QA_USER);
            data = await postJson('/auth/login', {
                username: QA_USER.username,
                password: QA_USER.password,
            });
            if (data) return { token: data.access_token, user: data.user, created: true };
        } else {
            return { token: data.access_token, user: data.user, created: false };
        }
    } catch {
        // 后端没起来，走下面的假登录态
    }
    return {
        created: false,
        token: 'qa-local-token',
        user: {
            id: 9001,
            username: 'qa',
            email: 'qa@example.com',
            level: 1,
            experience: 0,
            coins: 0,
        },
    };
}

(async () => {
    const auth = await resolveAuth();
    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    fs.mkdirSync(OUT, { recursive: true });
    const errors = [];
    const failures = [];

    for (const [name, viewport] of [
        ['desktop', { width: 1280, height: 900 }],
        ['mobile', { width: 390, height: 844 }],
    ]) {
        const page = await browser.newPage({ viewport });
        page.on('pageerror', (e) => errors.push(`[${name}] ` + String(e).slice(0, 200)));
        // 本地没有后端，直接注入一份登录态，好让首页渲染出「开放世界 / 古墓剧本杀」两个入口
        await page.addInitScript((AUTH_STATE) => {
            localStorage.setItem(
                'auth-storage',
                JSON.stringify({ state: AUTH_STATE, version: 0 }),
            );
        }, { token: auth.token, isAuthenticated: true, user: auth.user });
        await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForTimeout(4000);

        // 新账号会弹新用户引导，跳过它再看首页
        const skip = page.getByRole('button', { name: /跳过引导/ });
        if (await skip.count()) {
            await skip.click();
            await page.waitForTimeout(800);
        }
        await page.screenshot({ path: path.join(OUT, `50-home-${name}.png`), fullPage: false });

        const tombButton = page.getByRole('button', { name: /古墓剧本杀|Tomb Script Murder/i }).first();
        const found = await tombButton.count();
        const worldButton = page.getByRole('button', { name: /开放世界|Open World/i }).first();
        const worldBox = (await worldButton.count()) ? await worldButton.boundingBox() : null;
        const tombBox = found ? await tombButton.boundingBox() : null;

        // 桌面端（≥768px）：古墓入口应当与开放世界并排、位于其右侧
        // 移动端（<768px）：两个入口纵向堆叠，开放世界在上
        const sideBySide = Boolean(
            tombBox &&
                worldBox &&
                tombBox.x > worldBox.x + worldBox.width - 4 &&
                Math.abs(tombBox.y - worldBox.y) < 8,
        );
        const stacked = Boolean(
            tombBox && worldBox && tombBox.y > worldBox.y + worldBox.height - 4,
        );
        const expectSideBySide = viewport.width >= 768;
        const layoutOk = expectSideBySide ? sideBySide : stacked;
        if (!found) failures.push(`${name}: 找不到「古墓剧本杀」入口`);
        else if (!layoutOk) {
            failures.push(
                `${name}: 「古墓剧本杀」布局不对（${expectSideBySide ? '应与开放世界并排' : '应排在开放世界下方'}）`,
            );
        }

        console.log(
            `${name}: 古墓按钮=${found ? '有' : '无'}` +
                (tombBox && worldBox
                    ? ` 开放世界 x=${Math.round(worldBox.x)} y=${Math.round(worldBox.y)} w=${Math.round(worldBox.width)} h=${Math.round(worldBox.height)}` +
                      ` / 古墓 x=${Math.round(tombBox.x)} y=${Math.round(tombBox.y)} w=${Math.round(tombBox.width)} h=${Math.round(tombBox.height)}` +
                      ` 并排=${sideBySide} 堆叠=${stacked} 期望=${expectSideBySide ? '并排' : '堆叠'} 布局正确=${layoutOk}`
                    : ''),
        );

        await page.close();
    }

    console.log('--- page errors ---');
    console.log(errors.join('\n') || '(none)');
    await browser.close();

    if (auth.created) {
        const removed = removeUserByUsername(QA_USER.username);
        console.log(removed ? '临时 QA 账号已清理' : '临时 QA 账号清理失败（可手动删除 qa_tomb_bot）');
    }

    if (failures.length) {
        console.log('FAIL  ' + failures.join(' | '));
        process.exit(1);
    }
    console.log('ALL HOME CHECKS OK');
})();
