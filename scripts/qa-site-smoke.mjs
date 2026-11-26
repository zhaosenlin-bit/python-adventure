import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve(".qa-site");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const API = process.env.QA_API_URL || "http://localhost:8000/api/v1";

/**
 * 首页要登录才有顶栏，这里先跟后端要一个临时账号。
 */
async function loginAsQaUser() {
    const username = `qa_site_${Date.now().toString().slice(-8)}`;
    const password = "qa-site-123456";
    const registered = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email: `${username}@example.com`, password }),
    }).catch(() => null);
    if (!registered || !registered.ok) {
        throw new Error("注册临时账号失败，后端没起来？");
    }
    const login = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    if (!login.ok) throw new Error("临时账号登录失败");
    const data = await login.json();
    return { token: data.access_token, user: data.user, isAuthenticated: true };
}

function resolveChromium() {
    if (process.env.QA_CHROMIUM_PATH) return process.env.QA_CHROMIUM_PATH;
    const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    if (!existsSync(root)) return undefined;
    const revisions = readdirSync(root)
        .filter((n) => n.startsWith("chromium-"))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const rev of revisions) {
        for (const folder of ["chrome-win64", "chrome-win"]) {
            const exe = path.join(root, rev, folder, "chrome.exe");
            if (existsSync(exe)) return exe;
        }
    }
    return undefined;
}

const base = process.env.QA_BASE || "http://localhost:3000";
const results = [];

function record(name, ok, detail) {
    const line = `${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
    results.push(line);
    console.log(line);
}

async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
}

async function visit(page, url, waitMs, waitForSelector) {
    await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 60000 }).catch(() => {});
    }
    await page.waitForTimeout(waitMs);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    return text;
}

async function main() {
    const exe = resolveChromium();
    const browser = await chromium.launch({
        executablePath: exe,
        args: ["--no-sandbox", "--disable-gpu"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 首页的顶栏要登录才渲染，先把临时账号塞进 localStorage
    const session = await loginAsQaUser();
    await page.addInitScript((payload) => {
        window.localStorage.setItem(
            "auth-storage",
            JSON.stringify({ state: payload, version: 0 }),
        );
        // 新账号会弹新手引导，挡住了就没法看顶栏
        if (payload.user?.id) {
            window.localStorage.setItem(`newUserGuideCompleted:${payload.user.id}`, "true");
        }
    }, session);

    const errors = [];
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    const homeText = await visit(page, "/", 4000, "main > div.relative.z-30");
    await shot(page, "01-home");
    record("home renders", homeText.length > 10, homeText.slice(0, 150));
    // 入口在顶栏上，但宽度不够时会被收进「展开」菜单，
    // 而菜单没打开时那些按钮压根不在 DOM 里，所以先把「展开」点开。
    const overflowToggle = page.locator('[data-testid="top-quick-links-overflow-toggle"]');
    if (await overflowToggle.count()) {
        await overflowToggle.click();
        await page.waitForTimeout(500);
    }
    const aquaparkEntry = await page.evaluate(
        () =>
            document.querySelectorAll(
                '[data-testid="aquapark-button"], [data-testid="aquapark-button-overflow"]',
            ).length,
    );
    record("home has aquapark entry", aquaparkEntry > 0, `顶栏里找到 ${aquaparkEntry} 个`);

    const apText = await visit(page, "/aquapark", 2500);
    await shot(page, "02-aquapark");
    record("aquapark page renders", apText.length > 10, apText.slice(0, 200));

    const t3Text = await visit(page, "/typing-3d", 3000);
    await shot(page, "03-typing3d");
    record("typing-3d page renders", t3Text.length > 10, t3Text.slice(0, 150));

    const realErrors = errors.filter((e) => !/favicon|React DevTools/i.test(e));
    record("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

    await browser.close();
    console.log("--- summary ---");
    results.forEach((r) => console.log(r));
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error("QA FAILED:", err);
        process.exit(1);
    },
);
