/**
 * 石门表决 + 线索机关回赠/撬开验证。
 *
 * 1. 蛮力撬开：扣时间、线索入库、不能当证据
 * 2. 集齐线索走到石门按 E → 弹出表决面板（而不是直接结局）
 * 3. 选人 + 呈堂线索 → 揭票 → 票型 → 推开石门 → 结局面板带出票型
 */
const { chromium } = require('playwright');
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

/**
 * 软件渲染下 3D 画面会拖慢主线程，playwright 的指针点击常在
 * 「performing click action / scrolling into view」处超时。
 * 这里直接派发 DOM click，绕开 actionability 等待。
 */
async function clickByName(page, pattern) {
    const hit = await page.evaluate((src) => {
        const re = new RegExp(src);
        const button = Array.from(document.querySelectorAll('button')).find((item) =>
            re.test(item.textContent ?? ''),
        );
        if (!button) return false;
        button.click();
        return true;
    }, pattern);
    if (!hit) throw new Error(`没找到按钮：${pattern}`);
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 200));
    });
    fs.mkdirSync(OUT, { recursive: true });

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => document.body.innerText.includes('进入古墓'), null, {
        timeout: 180000,
    });
    await clickByName(page, '进入古墓');
    await page.waitForFunction(() => Boolean(window.__tomb), null, { timeout: 180000 });
    await page.waitForTimeout(15000);

    const snapshot = () => page.evaluate(() => window.__tomb.debugSnapshot());
    const collected = async () =>
        (await snapshot()).clues.filter((clue) => clue.collected).length;

    // ---------------------------------------------------------- 1. 蛮力撬开
    const before = await snapshot();
    await page.evaluate(() => window.__tomb.debugTeleport(-8.2, -0.4));
    await page.waitForTimeout(1200);
    await page.keyboard.press('e');
    await page.waitForFunction(() => document.body.innerText.includes('数字机关'), null, {
        timeout: 30000,
    });
    await page.screenshot({ path: path.join(OUT, '84-code-challenge.png') });
    check('线索机关弹出（含档位与回赠说明）', true);

    await clickByName(page, '蛮力撬开');
    await clickByName(page, '再点一次确认');
    await page.waitForFunction(() => !document.querySelector('textarea'), null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const after = await snapshot();
    check('蛮力撬开后线索入库', (await collected()) === 1);
    check(
        '蛮力撬开扣掉约 25 秒',
        before.timeLeft - after.timeLeft >= 22,
        `${before.timeLeft.toFixed(1)} -> ${after.timeLeft.toFixed(1)}`,
    );

    // ---------------------------------------------------------- 2. 石门表决
    await page.evaluate(() =>
        window.__tomb.debugForce({
            playerIsImpostor: false,
            impostorIds: ['xiaolin'],
            clueIds: ['mural', 'rubble', 'gategap'],
            playerKills: [],
            deadNpcs: [],
            attackedByImpostor: false,
            reachedGate: false,
            timeLeft: 170,
        }),
    );
    await page.evaluate(() => window.__tomb.debugTeleport(0, 8.2));
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');

    await page.waitForFunction(() => document.body.innerText.includes('石门表决'), null, {
        timeout: 30000,
    });
    check('走到石门按 E 弹的是表决面板', true);
    check('此时还没有触发结局', !(await page.evaluate(() => document.body.innerText.includes('结局达成'))));

    const panelText = await page.evaluate(() => document.body.innerText);
    check('面板显示风向', panelText.includes('投票前的风向'));
    check('面板显示票重', /票重 ×\d\.\d/.test(panelText));
    check('面板含蛮力撬开的线索标注', panelText.includes('蛮力撬开'));
    await page.screenshot({ path: path.join(OUT, '80-vote-panel.png') });

    // 指认小林，呈堂一条线索（Mural 已判定为真/待验，取决于证词）
    await clickByName(page, '^小林$');
    await clickByName(page, '碎片 1');
    await page.screenshot({ path: path.join(OUT, '81-vote-ballot.png') });
    const weightText = await page.evaluate(
        () => document.body.innerText.match(/当前票重 ×\d\.\d/)?.[0] ?? '',
    );
    check('选人 + 呈堂后票重有显示', weightText.length > 0, weightText);

    await clickByName(page, '提交表决');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, '82-vote-counting.png') });
    check('揭票过程有逐条台词', (await page.evaluate(() => document.body.innerText)).includes('→'));

    await clickByName(page, '推开石门');
    await page.waitForFunction(() => document.body.innerText.includes('结局达成'), null, {
        timeout: 30000,
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, '83-vote-ending.png') });

    const endingText = await page.evaluate(() => document.body.innerText);
    check('表决后进入结局面板', true);
    check('结算带出票型明细', endingText.includes('石门表决 ·'));
    check('票型里有点票与人名', /票 · \d\.\d 分/.test(endingText));

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL VOTE CHECKS OK' : `${failed} VOTE CHECK(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
