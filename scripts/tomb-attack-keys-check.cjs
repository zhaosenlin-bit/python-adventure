/**
 * 袭击确认的键盘链路验证：
 *   1. 对话中按 F 就能袭击当前对话对象（不需要转身瞄准）
 *   2. 按 F 弹出「确认袭击」
 *   3. Esc 取消，NPC 不死
 *   4. 再按 F，然后按 F 确认 → NPC 被击杀（键盘直接动手）
 *   5. 第三次按 F，然后按 Enter 确认 → NPC 被击杀
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

/** swiftshader 低帧率下截图容易超时，截不到也不能让整轮验证崩掉 */
async function shoot(page, file) {
    try {
        await page.screenshot({ path: file, timeout: 60000 });
    } catch {
        console.log('  (screenshot skipped: ' + path.basename(file) + ')');
    }
}

async function faceNpc(page, id, offset = 1.8) {
    await page.evaluate(
        ([npcId, dist]) => {
            const npc = window.__tomb.debugSnapshot().npcs.find((n) => n.id === npcId);
            window.__tomb.debugTeleport(npc.x, npc.z + dist);
            window.__tomb.debugFace(npc.x, npc.z);
        },
        [id, offset],
    );
}

/** 站到 NPC 旁边，但背对着他（模拟"没瞄准"） */
async function standBehindNpc(page, id, offset = 1.8) {
    await page.evaluate(
        ([npcId, dist]) => {
            const npc = window.__tomb.debugSnapshot().npcs.find((n) => n.id === npcId);
            window.__tomb.debugTeleport(npc.x, npc.z + dist);
            window.__tomb.debugFace(npc.x, npc.z + dist * 4);
        },
        [id, offset],
    );
}

async function isAlive(page, id) {
    return page.evaluate(
        (npcId) => window.__tomb.debugSnapshot().npcs.find((n) => n.id === npcId)?.alive === true,
        id,
    );
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

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForFunction(() => Boolean(window.__tomb), null, { timeout: 120000 });

    // 玩家设为伪人（伪人不会袭击玩家）+ 场上没有伪人（没人来偷袭），
    // 避免测试期间被意外触发结局打断
    await page.evaluate(() => window.__tomb.debugForce({ playerIsImpostor: true, impostorIds: [] }));

    // ---------------------------------------------------------- 1. 对话中直接袭击
    await standBehindNpc(page, 'aze');
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');
    await page.waitForFunction(
        () => document.body.innerText.includes('结束对话'),
        null,
        { timeout: 20000 },
    );
    check('按 E 打开与阿泽的对话', true);
    const attackBtnVisible = await page.getByRole('button', { name: '袭击' }).count();
    check('对话面板里出现「袭击」按钮（未瞄准也能打）', attackBtnVisible > 0);
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => document.body.innerText.includes('确认袭击'),
        null,
        { timeout: 20000 },
    );
    check('对话中按 F 弹出「确认袭击」', true);
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'aze')?.alive === false,
        null,
        { timeout: 20000 },
    );
    check('对话中按 F 确认 → 阿泽被击杀', true);
    await shoot(page, path.join(OUT, '70-attack-from-dialogue.png'));

    // ---------------------------------------------------------- 2. F 打开确认弹窗
    await faceNpc(page, 'gao');
    await page.waitForTimeout(1500);
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => document.body.innerText.includes('确认袭击'),
        null,
        { timeout: 20000 },
    );
    check('按 F 弹出「确认袭击」', true);
    const hintShown = await page.evaluate(() =>
        document.body.innerText.includes('动手') && document.body.innerText.includes('Esc'),
    );
    check('弹窗提示 F/Enter 动手、Esc 取消', hintShown);
    await shoot(page, path.join(OUT, '70-attack-keys-confirm.png'));

    // ---------------------------------------------------------- 3. Esc 取消
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () => !document.body.innerText.includes('确认袭击'),
        null,
        { timeout: 20000 },
    );
    check('Esc 关闭确认弹窗', true);
    check('Esc 取消后 NPC 仍然存活', await isAlive(page, 'gao'));

    // ---------------------------------------------------------- 4. 按 F 确认动手
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => document.body.innerText.includes('确认袭击'),
        null,
        { timeout: 20000 },
    );
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'gao')?.alive === false,
        null,
        { timeout: 20000 },
    );
    check('确认弹窗里再按 F → 动手成功', true);

    // ---------------------------------------------------------- 5. Enter 确认动手
    await faceNpc(page, 'xiaolin');
    await page.waitForTimeout(1500);
    await page.keyboard.press('f');
    await page.waitForFunction(
        () => document.body.innerText.includes('确认袭击'),
        null,
        { timeout: 20000 },
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'xiaolin')?.alive === false,
        null,
        { timeout: 20000 },
    );
    check('确认弹窗里按 Enter → 动手成功', true);
    await shoot(page, path.join(OUT, '71-attack-keys-done.png'));

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL ATTACK KEY CHECKS OK' : `${failed} ATTACK KEY CHECK(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
