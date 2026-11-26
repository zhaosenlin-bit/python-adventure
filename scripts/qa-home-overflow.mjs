/**
 * 首页顶部入口栏的自动化验收。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-home-overflow.mjs
 *
 * 入口越来越多，横条会被撑出屏幕。这份脚本盯三件事：
 *   1. 任何宽度下顶栏都不能超出屏幕（不能出横向滚动条）；
 *   2. 放不下的入口要自动进「展开」菜单，展开后一个都不能少；
 *   3. 手机上还是走原来的「学习入口」菜单。
 * 截图落在 `.qa-home/`。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-home");
const URL = process.env.QA_HOME_URL || "http://localhost:3000/";

/** 首页上所有顶部入口（数量从页面里动态数，不写死）。 */

const failures = [];

function check(name, ok, detail = "") {
    const line = `${ok ? "  OK " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    if (!ok) failures.push(line);
}

/** Playwright 自带的浏览器版本可能没装，这里退回到本机已装的 Chromium。 */
function resolveChromium() {
    if (process.env.QA_CHROMIUM_PATH) return process.env.QA_CHROMIUM_PATH;
    const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    if (!existsSync(root)) return undefined;
    const revisions = readdirSync(root)
        .filter((name) => name.startsWith("chromium-"))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const revision of revisions) {
        for (const folder of ["chrome-win64", "chrome-win"]) {
            const exe = path.join(root, revision, folder, "chrome.exe");
            if (existsSync(exe)) return exe;
        }
    }
    return undefined;
}

const API = process.env.QA_API_URL || "http://localhost:8000/api/v1";
const VIEWPORTS = [
    { name: "宽屏 1920", width: 1920, height: 900 },
    { name: "常见 1440", width: 1440, height: 900 },
    { name: "笔记本 1280", width: 1280, height: 800 },
    { name: "小笔记本 1152", width: 1152, height: 800 },
    { name: "临界 1024", width: 1024, height: 768 },
    { name: "平板 900", width: 900, height: 800 },
    { name: "手机 390", width: 390, height: 844 },
];

/**
 * 首页要登录才看得到顶栏，这里先跟后端要一个临时账号。
 */
async function loginAsQaUser() {
    const username = `qa_home_${Date.now().toString().slice(-8)}`;
    const password = "qa-home-123456";
    const payload = { username, email: `${username}@example.com`, password };
    const registered = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
async function main() {
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: resolveChromium(),
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

    // 首页要登录才有顶栏：先把临时账号塞进 localStorage
    const session = await loginAsQaUser();
    await page.addInitScript((payload) => {
        window.localStorage.setItem(
            "auth-storage",
            JSON.stringify({ state: payload, version: 0 }),
        );
        // 新账号会弹新手引导，挡住了就没法点顶栏
        if (payload.user?.id) {
            window.localStorage.setItem(`newUserGuideCompleted:${payload.user.id}`, "true");
        }
    }, session);

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("main > div.relative.z-30", { timeout: 60_000 });
    await page.waitForTimeout(1500);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(700);

        // 入口怎么分配是「测量 + ResizeObserver」异步算出来的，刚挂载那一刻读到的
        // 还是旧值（横条 3 个 / 展开 5 个），布局稳下来之后才是真值（横条 6 个 / 展开 2 个）。
        // 连采几次，等数字稳定下来再判。
        let info = null;
        let last = null;
        let stableRuns = 0;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            info = await page.evaluate(() => {
            const bar = document.querySelector("main > div.relative.z-30");
            if (!bar) return null;
            const overflowing = Array.from(bar.querySelectorAll("*"))
                .filter((el) => {
                    // 隐藏的测量行只是拿来量宽度，不算页面溢出
                    if (el.closest("[data-qa-measure]")) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.right > window.innerWidth + 1;
                })
                .map((el) => el.getAttribute("data-testid") || el.tagName.toLowerCase());

            const toggle = document.querySelector('[data-testid="top-quick-links-overflow-toggle"]');
            // 隐藏测量行里放着全部入口，拿它当总数基准
            const totalEntries = document.querySelectorAll("[data-qa-measure] [data-link-id]").length;
            const visibleToggle = toggle
                ? toggle.getBoundingClientRect().width > 0
                : false;
            const badge = toggle
                ? Number((toggle.textContent || "").match(/(\d+)\s*$/)?.[1] ?? 0)
                : 0;

            // 横条上还剩几个入口
            const row = bar.querySelector("[data-top-links-row]");
            // 只数入口按钮，「展开」本身不算一个入口
            const rowButtons = row
                ? Array.from(row.querySelectorAll("[data-link-id]")).filter(
                      (el) => el.getBoundingClientRect().width > 0,
                  ).length
                : 0;

            return {
                rowRight: row ? row.getBoundingClientRect().right : 0,
                totalEntries,
                overflowing,
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth: window.innerWidth,
                visibleToggle,
                badge,
                rowButtons,
                overflowMenuItems: document.querySelectorAll(
                    '[data-testid$="-overflow"]',
                ).length,
                mobileMenuItems: document.querySelectorAll('[data-testid$="-menu"]').length,
            };
            });
            // 要求连续三次读到同一个值才算稳定：只看两次的话，
            // 会在「字体/余额还没加载完」的中间态上就收工。
            if (last && info.rowButtons === last.rowButtons && info.badge === last.badge) {
                stableRuns += 1;
            } else {
                stableRuns = 0;
            }
            if (stableRuns >= 3) {
                break;
            }
            last = info;
            await page.waitForTimeout(200);
        }

        if (!info) {
            check(`${viewport.name} 顶栏能测量`, false, "找不到顶栏");
            continue;
        }

        const rowFits = info.rowRight <= info.innerWidth + 1;
        const noOverflow =
            info.overflowing.length === 0 && info.scrollWidth <= info.innerWidth + 1 && rowFits;
        check(`${viewport.name} 顶栏不超出屏幕`, noOverflow, noOverflow ? "" : `溢出：${info.overflowing.join(", ")}`);

        if (viewport.width >= 1024) {
            // 桌面：横条 + 展开菜单 = 全部入口，一个都不能少
            const inMenu = info.visibleToggle ? info.badge : 0;
            check(
                `${viewport.name} 入口一个不少`,
                info.rowButtons + inMenu === info.totalEntries,
                `横条 ${info.rowButtons} + 展开 ${inMenu} = ${info.rowButtons + inMenu}（应为 ${info.totalEntries}）`,
            );
        } else {
            // 手机：还是老的「学习入口」菜单
            await page.click('[data-testid="quick-links-toggle"]');
            await page.waitForTimeout(400);
            const mobileItems = await page.locator('[data-testid$="-menu"]').count();
            await page.click('[data-testid="quick-links-toggle"]');
            await page.waitForTimeout(300);
            check(
                `${viewport.name} 手机走「学习入口」菜单`,
                mobileItems === info.totalEntries,
                `菜单里 ${mobileItems} 个（应为 ${info.totalEntries}）`,
            );
        }

        await page.screenshot({ path: path.join(OUT, `home-${viewport.width}.png`), fullPage: false });
    }

    // ---- 展开菜单：能打开，里面的入口都在，点完能跳走
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(800);
    const toggle = page.locator('[data-testid="top-quick-links-overflow-toggle"]');
    if (await toggle.count()) {
        await toggle.click();
        await page.waitForTimeout(500);
        const items = page.locator('[data-testid$="-overflow"]');
        const itemCount = await items.count();
        check("展开菜单能打开", itemCount > 0, `${itemCount} 个入口`);
        const badge = await toggle.textContent();
        check("展开按钮上的数字和菜单里的一致", (badge || "").includes(String(itemCount)), badge?.trim() || "");
        await page.screenshot({ path: path.join(OUT, "home-overflow-open.png") });

        // 点菜单里的入口应该能跳转。
        // 这里不盲点第一项：外链入口是 window.open 另开标签页，当前地址不会变，
        // 弹窗类入口（恐龙大世界）压根不改地址。优先挑一个站内路由的入口，
        // 这样以后往顶栏加新入口也不会把这条验收搞挂。
        // 先挑轻一点的站内路由：Code Research 首屏编译很快，
        // 3D 打字闯关那套 three.js 页面在 dev 模式下要现编译，容易等超时。
        const inAppEntryIds = [
            "code-research-button-overflow",
            "3d-typing-button-overflow",
        ];
        let target = null;
        for (const id of inAppEntryIds) {
            const candidate = page.locator(`[data-testid="${id}"]`);
            if (await candidate.count()) {
                target = candidate;
                break;
            }
        }
        if (target) {
            await target.click();
            // dev 模式下第一次进新路由要现场编译，3D 那种重页面能等好几分钟，
            // 20 秒不够用，给足时间再判定。
            await page
                .waitForURL((url) => url.pathname !== "/", { timeout: 120_000 })
                .catch(() => {});
            check("点展开菜单里的入口能跳转", page.url() !== "http://localhost:3000/", page.url());
        } else {
            console.log("  --  展开菜单里没有站内路由入口，跳过跳转检查");
        }
    } else {
        check("展开菜单能打开", false, "没有出现「展开」按钮");
    }

    check("控制台没有报错", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    await browser.close();

    console.log(`\n截图目录：${OUT}`);
    if (failures.length) {
        console.log(`\n${failures.length} 项未通过 ❌`);
        process.exit(1);
    }
    console.log("\n全部通过 ✅");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
