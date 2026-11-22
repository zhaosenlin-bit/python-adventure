/**
 * 线索编程机关验证：
 *   1. 按 E 不直接给线索，而是弹出 Python 关卡
 *   2. 答错拿不到线索
 *   3. 答对线索才入库
 *   4. 在代码框里打字不会误触发袭击/交互
 *   5. 第二道题（假线索）同样能过
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

const MURAL_WRONG = `low, high = 2, 4
count = 0
for n in range(low, high + 1):
    count += 2
print(count)`;

const MURAL_RIGHT = `low, high = 2, 4
count = 0
for n in range(low, high + 1):
    count += 1
print(count)`;

const ARTIFACT_RIGHT = `impostor_count = 2
gao_is_impostor = False
claim_holds = (impostor_count == 2) and gao_is_impostor
print(claim_holds)`;

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

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForFunction(() => Boolean(window.__tomb), null, { timeout: 120000 });

    // Python 运行时预热（进入古墓即开始加载，这里等它就绪）
    await page.waitForFunction(() => Boolean(window.__pyodideInstance), null, { timeout: 180000 });
    check('Python 运行时已就绪', true);

    const collectedCount = () =>
        page.evaluate(() => window.__tomb.debugSnapshot().clues.filter((c) => c.collected).length);

    // ---------------------------------------------------------- 1. 按 E 弹编程关卡
    await page.evaluate(() => window.__tomb.debugTeleport(-8.2, -0.4));
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');
    await page.waitForFunction(
        () => document.body.innerText.includes('数字机关'),
        null,
        { timeout: 30000 },
    );
    check('按 E 打开线索的 Python 关卡（不是直接拾取）', true);
    check('此时线索还没入库', (await collectedCount()) === 0);

    // 等「运行代码」按钮可点（Python 运行时就绪）
    await page.waitForFunction(
        () => {
            const btn = Array.from(document.querySelectorAll('button'));
            return btn.some((b) => (b.textContent || '').includes('运行代码'));
        },
        null,
        { timeout: 120000 },
    );

    // ---------------------------------------------------------- 2. 打字不误触发
    await page.locator('textarea').fill(MURAL_WRONG);
    await page.waitForTimeout(800);
    const misfire = await page.evaluate(() => ({
        attack: document.body.innerText.includes('确认袭击'),
        dialogue: document.body.innerText.includes('结束对话'),
        code: document.querySelector('textarea')?.value ?? '',
    }));
    check('在代码框里打字不会误触发袭击', !misfire.attack);
    check('在代码框里打字不会误触发对话', !misfire.dialogue);
    check('代码框内容完整保留', misfire.code === MURAL_WRONG);

    // ---------------------------------------------------------- 3. 答错拿不到线索
    await page.getByRole('button', { name: /运行代码/ }).click();
    await page.waitForTimeout(4000);
    check('答错时线索不入库', (await collectedCount()) === 0);

    // ---------------------------------------------------------- 4. 答对才给线索
    await page.locator('textarea').fill(MURAL_RIGHT);
    await page.getByRole('button', { name: /运行代码/ }).click();
    await page.waitForFunction(
        () => window.__tomb.debugSnapshot().clues.filter((c) => c.collected).length === 1,
        null,
        { timeout: 60000 },
    );
    check('答对后线索入库', true);
    const hudClues = await page.evaluate(() => document.body.innerText.match(/线索\s*1\/5/)?.[0] ?? '');
    check('HUD 显示 1/5', hudClues.includes('1/5'), hudClues);

    // ---------------------------------------------------------- 5. 第二道题
    await page.evaluate(() => window.__tomb.debugTeleport(-6, 4.4));
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');
    await page.waitForFunction(
        () => document.body.innerText.includes('断言机关'),
        null,
        { timeout: 30000 },
    );
    check('第二道题（假线索）也能打开', true);
    await page.locator('textarea').fill(ARTIFACT_RIGHT);
    await page.getByRole('button', { name: /运行代码/ }).click();
    await page.waitForFunction(
        () => window.__tomb.debugSnapshot().clues.filter((c) => c.collected).length === 2,
        null,
        { timeout: 60000 },
    );
    check('第二道题答对后线索入库', true);

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL CODE CHALLENGE CHECKS OK' : `${failed} CODE CHALLENGE CHECK(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
