/**
 * 移动端触屏验证：虚拟摇杆移动、交互/袭击按钮、触屏拾取线索。
 *
 * 用 390x844 的移动视口 + hasTouch 打开 /tomb，
 * 拖动摇杆后比较玩家世界坐标是否发生位移。
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const OUT = path.join(__dirname, '..', 'qa-tomb');

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

(async () => {
    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
        ],
    });

    const context = await browser.newContext({
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 200));
    });
    fs.mkdirSync(OUT, { recursive: true });

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForTimeout(16000);

    // ------------------------------------------------------------ 1. 控件可见性
    const pad = page.getByRole('application', { name: '移动摇杆' });
    const interact = page.getByRole('button', { name: '交互' });
    const attack = page.getByRole('button', { name: '袭击' });
    const padVisible = await pad.isVisible().catch(() => false);
    const interactVisible = await interact.isVisible().catch(() => false);
    const attackVisible = await attack.isVisible().catch(() => false);
    check(
        '移动端显示摇杆与交互/袭击按钮',
        padVisible && interactVisible && attackVisible,
        `pad=${padVisible} interact=${interactVisible} attack=${attackVisible}`,
    );

    // 摇杆手柄静止时必须与底盘同心（Tailwind translate 与内联 transform 叠加会导致偏移）
    const knobAligned = await page.evaluate(() => {
        const padEl = document.querySelector('[aria-label="移动摇杆"]');
        const knobEl = padEl?.firstElementChild;
        if (!padEl || !knobEl) return { ok: false, offset: null };
        const pad = padEl.getBoundingClientRect();
        const knob = knobEl.getBoundingClientRect();
        const offset = Math.hypot(
            pad.x + pad.width / 2 - (knob.x + knob.width / 2),
            pad.y + pad.height / 2 - (knob.y + knob.height / 2),
        );
        return { ok: offset < 1, offset };
    });
    check('摇杆手柄与底盘同心', knobAligned.ok, `偏移 ${knobAligned.offset?.toFixed(2)}px`);

    await page.screenshot({ path: path.join(OUT, '70-mobile-hud.png') });

    // ------------------------------------------------------------ 2. 摇杆移动
    const before = await page.evaluate(() => window.__tomb.debugSnapshot().player);
    const box = await pad.boundingBox();
    if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        // 向前（向上）推摇杆：forward = -joystick.y
        for (let i = 1; i <= 5; i += 1) {
            await page.mouse.move(cx, cy - (i * 10));
            await page.waitForTimeout(300);
        }
        await page.waitForTimeout(2500);
        await page.mouse.up();
    }
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => window.__tomb.debugSnapshot().player);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check('拖动摇杆后玩家发生位移', moved > 0.25, `位移 ${moved.toFixed(2)}m`);

    // ------------------------------------------------------------ 3. 触屏拾取线索
    await page.evaluate(() => window.__tomb.debugTeleport(-8.2, -0.4));
    await page.waitForTimeout(1500);
    await interact.tap();
    await page.waitForTimeout(1800);
    const clueCount = await page.evaluate(
        () => window.__tomb.debugSnapshot().clues.filter((c) => c.collected).length,
    );
    check('触屏交互按钮拾取线索', clueCount === 1, `已拾取 ${clueCount} 条`);
    await page.screenshot({ path: path.join(OUT, '71-mobile-clue.png') });

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL MOBILE CHECKS OK' : `${failed} MOBILE CHECK(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
