import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve(".qa-site");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

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

async function visit(page, url, waitMs) {
    await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 60000 });
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

    const errors = [];
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    const homeText = await visit(page, "/", 4000);
    await shot(page, "01-home");
    record("home renders", homeText.length > 10, homeText.slice(0, 150));
    record("home has aquapark entry", /水乐园|Aquapark/i.test(homeText), homeText.slice(0, 200));

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
