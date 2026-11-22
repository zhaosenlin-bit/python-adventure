/**
 * 顶部入口自适应检查：入口多到放不下时，多出来的必须收进「更多」下拉，且整行不能溢出屏幕。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const OUT = path.join(__dirname, '..', 'qa-tomb');

const { readBackendPort } = require('./backendPort.cjs');
const API = `http://localhost:${readBackendPort()}/api/v1`;
const QA_USER = {
    username: 'qa_nav_bot',
    email: 'qa_nav_bot@example.com',
    password: 'QaNav#2026',
};

async function postJson(pathname, body) {
    const response = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
}

/** 首页只在登录态下渲染顶栏，这里先拿一个真 token */
async function resolveAuth() {
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
    }
    if (!data) throw new Error(`后端登录失败，无法进入首页顶栏：${API}`);
    return { token: data.access_token, user: data.user };
}

const QUICK_LINK_TEST_IDS = [
    'tomb-entry-button',
    'typing-entry-button',
    'ai-research-button',
    'code-research-button',
    'english-game-button',
    'microstudio-game-button',
];

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

(async () => {
    const auth = await resolveAuth();
    const browser = await chromium.launch({
        executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    fs.mkdirSync(OUT, { recursive: true });
    const errors = [];

    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 900 },
        { width: 1024, height: 900 },
        { width: 768, height: 900 },
        { width: 390, height: 844 },
    ]) {
        const tag = `${viewport.width}x${viewport.height}`;
        const page = await browser.newPage({ viewport });
        page.on('pageerror', (e) => errors.push(`[${tag}] ` + String(e).slice(0, 200)));
        await page.addInitScript((AUTH_STATE) => {
            localStorage.setItem(
                'auth-storage',
                JSON.stringify({ state: AUTH_STATE, version: 0 }),
            );
        }, { token: auth.token, isAuthenticated: true, user: auth.user });
        await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(2500);
        const skip = page.getByRole('button', { name: /跳过引导/ });
        if (await skip.count()) {
            await page.evaluate(() => {
                const button = Array.from(document.querySelectorAll('button')).find((node) =>
                    /跳过引导/.test(node.textContent ?? ''),
                );
                button?.click();
            });
            await page.waitForTimeout(900);
        }

        const state = await page.evaluate((ids) => {
            const isVisible = (node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const visibleInline = ids.filter((id) => {
                const node = document.querySelector(`[data-testid="${id}"]`);
                return node ? isVisible(node) : false;
            }).length;
            const toggle = document.querySelector('[data-testid="quick-links-toggle"]');
            const menuItems = Array.from(
                document.querySelectorAll('[data-testid$="-menu"]'),
            ).filter((node) => isVisible(node)).length;
            const rowTop = ids
                .map((id) => document.querySelector(`[data-testid="${id}"]`))
                .filter(Boolean)
                .map((node) => node.getBoundingClientRect().top);
            return {
                visibleInline,
                menuCount: menuItems,
                toggleVisible: toggle ? isVisible(toggle) : false,
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
                inlineTop: rowTop.length ? Math.min(...rowTop) : null,
            };
        }, QUICK_LINK_TEST_IDS);

        check(`${tag} 整行不溢出`, state.overflowX <= 0, `scrollWidth - innerWidth = ${state.overflowX}`);
        const expectedInMenu = QUICK_LINK_TEST_IDS.length - state.visibleInline;
        if (expectedInMenu > 0) {
            check(`${tag} 放不下的入口都能收进「更多」`, state.toggleVisible, `第一栏 ${state.visibleInline} 个`);
            // 展开下拉，确认收进去的入口数量对得上
            await page.evaluate(() => {
                document.querySelector('[data-testid="quick-links-toggle"]')?.click();
            });
            await page.waitForTimeout(400);
            const opened = await page.evaluate(() => {
                const menu = Array.from(document.querySelectorAll('[data-testid$="-menu"]')).filter(
                    (node) => node.getBoundingClientRect().height > 0,
                );
                const panelOverflow = document.documentElement.scrollWidth - window.innerWidth;
                return { count: menu.length, overflowX: panelOverflow };
            });
            check(
                `${tag} 下拉条目与剩余入口一致`,
                opened.count === expectedInMenu && opened.overflowX <= 0,
                `items=${opened.count} 期望=${expectedInMenu}`,
            );
            if (tag === '1440x900' || tag === '1280x900' || tag === '390x844') {
                await page.screenshot({ path: path.join(OUT, `91-nav-${tag}.png`) });
            }
        } else {
            check(`${tag} 全部放得下时不显示「更多」`, state.toggleVisible === false);
        }

        await page.close();
    }

    console.log('--- page errors ---');
    console.log(errors.slice(0, 8).join('\n') || '(none)');
    await browser.close();
    console.log(failures === 0 ? 'ALL NAV CHECKS OK' : `${failures} NAV CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})();
