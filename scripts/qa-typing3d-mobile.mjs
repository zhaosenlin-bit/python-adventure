/**
 * 3D 打字闯关（网页版）移动端专项验收：真手机尺寸 + 真触摸事件。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-typing3d-mobile.mjs
 *
 * 桌面版那套 QA 用的是鼠标和键盘，手机上完全不一样：
 *   - 出生点靠底部列表选，不是点地面光环
 *   - 走路靠左下角虚拟摇杆，不是 WASD
 *   - 打字靠软键盘（IME），软键盘没有回车键，只能点「提交」
 *   - 软键盘弹起来会挡住屏幕下半部分，输入框和提交按钮必须还在看得见的地方
 *
 * 所以这里用 CDP 派发真实的 touchStart / touchMove / touchEnd，
 * 让浏览器的 pointer 事件链真的跑起来，而不是模拟一个 click。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-typing3d");
const URL = process.env.QA_TYPING3D_URL || "http://localhost:3000/typing-3d";

const failures = [];

/** iPhone 13 的逻辑尺寸。 */
const PHONE = { width: 390, height: 844 };

function check(name, ok, detail = "") {
    console.log(`${ok ? "  OK  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
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

/**
 * Next 开发模式的报错浮层（<nextjs-portal>）会盖在页面上拦截点击，
 * 别的会话改代码时的一次性编译错误就能把验收顶死，藏掉它。
 */
async function disableDevOverlay(page) {
    await page
        .addStyleTag({ content: "nextjs-portal { display: none !important; }" })
        .catch(() => undefined);
}

/** 真触摸：CDP 的坐标是 CSS 像素，和 boundingBox 对得上。 */
async function touchTap(cdp, x, y) {
    await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** 真拖动：按住 -> 移动 -> 停一会儿（让角色真的走起来）-> 松手。 */
async function touchDrag(cdp, from, to, holdMs = 700) {
    await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
                {
                    x: from.x + ((to.x - from.x) * step) / steps,
                    y: from.y + ((to.y - from.y) * step) / steps,
                    id: 1,
                },
            ],
        });
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** 点某个元素（用真实触摸，不用 click）。 */
/**
 * 模拟软键盘：真机上键盘只遮 visual viewport，布局视口不变，
 * 浏览器会派发 visualViewport 的 resize 事件。
 * headless 里没有软键盘，这里把 visualViewport.height 调小并派发同一个事件，
 * 还原浏览器在键盘弹起时的通知。
 */
async function fakeKeyboard(page, visualHeight) {
    await page.evaluate((height) => {
        const viewport = window.visualViewport;
        if (!viewport) return;
        if (!window.__qaKeyboardPatched) {
            window.__qaKeyboardHeight = viewport.height;
            Object.defineProperty(viewport, "height", {
                configurable: true,
                get: () => window.__qaKeyboardHeight,
            });
            window.__qaKeyboardPatched = true;
        }
        window.__qaKeyboardHeight = height;
        viewport.dispatchEvent(new Event("resize"));
    }, visualHeight);
}

async function tapElement(cdp, locator) {
    const box = await locator.boundingBox();
    if (!box) return false;
    await touchTap(cdp, box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

async function main() {
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: resolveChromium(),
        args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ],
    });

    // 手机上下文：粗指针 + 触摸事件，isTouch 分支才会走摇杆那一套
    const context = await browser.newContext({
        viewport: PHONE,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 160)));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await disableDevOverlay(page);
    await page.waitForSelector('[data-testid="typing-3d-start"]:not([disabled])', { timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, "m01-intro.png") });
    check("手机尺寸下开场界面出现", true, `${PHONE.width}x${PHONE.height}`);

    // ---- 开局：点开始 -> 选出生点 -> 确认出发（全程用触摸）
    await tapElement(cdp, page.locator('[data-testid="typing-3d-start"]'));
    await page.waitForSelector('[data-testid="typing-3d-spawn-option-0"]', { timeout: 15_000 });
    await page.screenshot({ path: path.join(OUT, "m02-spawn.png") });

    await tapElement(cdp, page.locator('[data-testid="typing-3d-spawn-option-0"]'));
    await tapElement(cdp, page.locator('[data-testid="typing-3d-spawn-confirm"]'));
    await page.waitForSelector('[data-testid="typing-3d-level"]', { timeout: 15_000 });
    await page.waitForTimeout(2000);
    check("触摸选出生点并出发", (await page.locator('[data-testid="typing-3d-level"]').count()) > 0,
        (await page.locator('[data-testid="typing-3d-level"]').textContent()) ?? "");

    // ---- 虚拟摇杆：触摸设备才显示
    const joystick = page.locator("div.pointer-events-auto.absolute.bottom-6.left-6");
    const hasJoystick = (await joystick.count()) > 0;
    check("触摸设备显示虚拟摇杆", hasJoystick);
    await page.screenshot({ path: path.join(OUT, "m03-joystick.png") });

    // ---- 摇杆真能走路
    let moved = null;
    if (hasJoystick) {
        const before = await page.evaluate(() => window.__typing3d?.player?.() ?? null);
        const box = await joystick.boundingBox();
        if (box) {
            const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            await touchDrag(cdp, center, { x: center.x, y: center.y - box.height / 2 + 6 });
            await page.waitForTimeout(300);
        }
        const after = await page.evaluate(() => window.__typing3d?.player?.() ?? null);
        if (before && after) {
            moved = Math.hypot(after.x - before.x, after.z - before.z);
        }
        check("摇杆拖动后角色真的移动了", moved !== null && moved > 0.3,
            moved === null ? "读不到位置" : `位移 ${moved.toFixed(2)}`);
    }

    // ---- 走到答题面板
    const panel = await page.evaluate(() => window.__typing3d?.panel?.() ?? null);
    check("拿到答题面板坐标", Boolean(panel), panel ? `x=${panel.x.toFixed(1)} z=${panel.z.toFixed(1)}` : "");
    if (panel) {
        await page.evaluate(
            ([x, z]) => window.__typing3d?.teleport?.(x, z - 2.2),
            [panel.x, panel.z],
        );
        await page.waitForTimeout(800);
    }
    const panelButton = page.locator('[data-testid="typing-3d-panel-button"]');
    check("靠近面板后出现「打开打字面板」", (await panelButton.count()) > 0);

    // ---- 触摸打开打字面板
    if ((await panelButton.count()) > 0) {
        await tapElement(cdp, panelButton);
        await page.waitForSelector('[data-testid="typing-3d-question"]', { timeout: 15_000 });
        await page.waitForTimeout(400);
        check("触摸打开打字面板", true);
    } else {
        check("触摸打开打字面板", false, "没有出现打开按钮");
    }
    await page.screenshot({ path: path.join(OUT, "m04-typing.png") });

    // ---- 触摸输入框后，焦点必须还在输入框上
    // 这是桌面版修过的老问题（焦点掉到 body，按键全丢）在触摸端的翻版：
    // 手指点输入框 -> 焦点跑掉 -> 软键盘弹出来却打不进字。
    const input = page.locator('[data-testid="typing-3d-input"]');
    await tapElement(cdp, input);
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return {
            tag: active?.tagName ?? "",
            testid: active?.getAttribute?.("data-testid") ?? "",
        };
    });
    check("触摸输入框后焦点仍在输入框", focused.testid === "typing-3d-input",
        `activeElement=${focused.tag}#${focused.testid}`);

    // ---- 软键盘弹起：可视区被压缩后，输入框和提交按钮还得够得着
    // 真机上软键盘只遮 visual viewport，布局视口不变，
    // 这里把可视高度调矮并派发 resize，还原浏览器在键盘弹起时的通知。
    const beforeViewport = await page.evaluate(() => ({
        inner: window.innerHeight,
        visual: Math.round(window.visualViewport?.height ?? window.innerHeight),
    }));
    await fakeKeyboard(page, Math.round(PHONE.height * 0.55));
    await page.waitForTimeout(700);
    const afterViewport = await page.evaluate(() => ({
        inner: window.innerHeight,
        visual: Math.round(window.visualViewport?.height ?? window.innerHeight),
    }));
    check("模拟出软键盘弹起（可视高度变矮）",
        afterViewport.visual < beforeViewport.visual - 50,
        `inner ${beforeViewport.inner}->${afterViewport.inner} / visual ${beforeViewport.visual}->${afterViewport.visual}`);

    const submitButton = page.getByRole("button", { name: /提交/ });
    const submitCount = await submitButton.count();
    check("弹层里有「提交」按钮（软键盘没有回车键）", submitCount > 0);

    const layout = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="typing-3d-input"]');
        const buttons = Array.from(document.querySelectorAll("button"));
        const submit = buttons.find((node) => /提交/.test(node.textContent ?? ""));
        const box = (node) => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
        };
        return {
            innerHeight: window.innerHeight,
            visualHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
            input: box(input),
            submit: box(submit),
        };
    });
    // 软键盘弹起后大致会占掉下半屏：可视高度按 55% 算
    // 键盘遮住的部分点不到，所以要整个按钮都在可视高度以内才算够得着
    const visibleHeight = layout.visualHeight;
    const inputVisible = Boolean(layout.input) && layout.input.top >= 0 && layout.input.bottom <= visibleHeight;
    const submitVisible = Boolean(layout.submit) && layout.submit.top >= 0 && layout.submit.bottom <= visibleHeight;
    check("软键盘弹起后输入框仍够得着", inputVisible,
        `input=${JSON.stringify(layout.input)} 可视高度=${visibleHeight}`);
    check("软键盘弹起后「提交」按钮仍够得着", submitVisible,
        `submit=${JSON.stringify(layout.submit)} 可视高度=${visibleHeight}`);
    await page.screenshot({ path: path.join(OUT, "m05-keyboard.png") });

    // ---- 用软键盘的方式输入：CDP 的 insertText 走的是 IME 文本输入路径
    // 先把键盘收回去，恢复整屏高度
    await fakeKeyboard(page, PHONE.height);
    await page.waitForTimeout(400);
    const pinyin = await page.locator('[data-testid="typing-3d-pinyin"]').textContent().catch(() => null);
    const question = await page.locator('[data-testid="typing-3d-question"]').textContent();
    const raw = (pinyin && pinyin.trim()) || (question || "").trim();
    const answer = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    await cdp.send("Input.insertText", { text: answer });
    await page.waitForTimeout(400);
    const typed = await page.locator('[data-testid="typing-3d-input"]').inputValue();
    check("软键盘输入的文字进了输入框", typed.trim().length > 0, `输入了 ${typed.trim().length} 个字符`);

    // ---- 点「提交」
    if (submitCount > 0) {
        await tapElement(cdp, submitButton.first());
        await page.waitForTimeout(900);
    }
    const doorOpen = await page.evaluate(() => window.__typing3d?.doorOpen?.() ?? false);
    check("点「提交」后答对、门打开", doorOpen, `题目「${raw.slice(0, 14)}」`);
    await page.screenshot({ path: path.join(OUT, "m06-solved.png") });

    check("全程没有页面报错", errors.length === 0, errors.slice(0, 2).join(" | "));

    await browser.close();

    console.log(`\n截图目录：${OUT}`);
    if (failures.length) {
        console.log(`\n${failures.length} 项未通过：`);
        failures.forEach((line) => console.log(line));
        process.exit(1);
    }
    console.log("\n全部通过 ✅");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
