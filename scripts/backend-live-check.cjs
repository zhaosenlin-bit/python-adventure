/**
 * 前后端联通检查：前端页面能否通过后端端口拿到真实数据。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

(async () => {
    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    const netFails = [];
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 200)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 200));
    });
    page.on('requestfailed', (r) => netFails.push(r.url().slice(0, 120)));

    // 1. 后端端口直连
    const direct = await page.evaluate(async () => {
        try {
            const res = await fetch('http://localhost:8010/api/v1/leaderboard/arena');
            return { ok: res.ok, status: res.status };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    check('浏览器可直连后端 8010', direct.ok, JSON.stringify(direct));

    // 2. 开放世界页面加载（竞技场/古墓都挂在这个页面里）
    await page.goto('http://localhost:3000/world', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(4000);
    const worldText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    check('开放世界页面渲染', worldText.length > 0, worldText.replace(/\s+/g, ' ').slice(0, 80));

    // 3. 古墓页面加载
    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(4000);
    const tombText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    check('古墓页面渲染', tombText.length > 0, tombText.replace(/\s+/g, ' ').slice(0, 80));

    const backendFails = netFails.filter((u) => u.includes(':8010'));
    check('无后端请求失败', backendFails.length === 0, backendFails.slice(0, 5).join(' | '));

    const notFound = errors.filter((e) => e.includes('404'));
    check('无 404 资源错误', notFound.length === 0, notFound.slice(0, 3).join(' | '));

    console.log('--- page errors ---');
    console.log(errors.slice(0, 8).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL BACKEND LIVE CHECKS OK' : `${failed} CHECK(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
