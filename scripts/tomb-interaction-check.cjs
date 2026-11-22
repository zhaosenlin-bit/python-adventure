/**
 * 交互链路验证：对话提问、线索拾取、推理板、袭击确认、伪人偷袭。
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
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForTimeout(16000);

    // ---------------------------------------------------------- 1. 对话
    await page.evaluate(() => {
        const gao = window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'gao');
        window.__tomb.debugTeleport(gao.x, gao.z + 1.6);
        window.__tomb.debugFace(gao.x, gao.z);
    });
    await page.waitForTimeout(1200);
    await page.keyboard.press('e');
    await page.waitForTimeout(1500);

    const dialogueOpen = await page.getByRole('button', { name: /结束对话/ }).count();
    check('按 E 打开对话面板', dialogueOpen > 0);
    await page.screenshot({ path: path.join(OUT, '60-dialogue.png') });

    // 提一个任务关键词问题
    await page.getByRole('button', { name: '你是伪人吗？' }).click();
    await page.waitForTimeout(1500);
    const answered = await page.evaluate(() => {
        const text = document.body.innerText;
        const GAO_TASK = [
            '我的记忆碎片很乱，很多真相我拼凑不完整。',
            '队伍里有异常存在，但我不敢随意指认。',
            '古墓的线索被动过手脚，真假混杂。',
            '这里处处是危险，落单绝对不能存活。',
            '石门能离开，但离开不一定安全。',
            '我无法自证身份，记忆缺失就是我的软肋。',
        ];
        return {
            hasAnswer: GAO_TASK.some((line) => text.includes(line)),
            hasQuestion: text.includes('你是伪人吗'),
        };
    });
    check('关键词提问得到高教授的真话回答', answered.hasAnswer, JSON.stringify(answered));

    // 闲聊关键词
    await page.getByRole('button', { name: '你多大了？' }).click();
    await page.waitForTimeout(1200);
    const casualAnswer = await page.evaluate(() => {
        const text = document.body.innerText;
        return [
            '我早已记不清自己的过往。',
            '现在纠结这些毫无意义。',
            '记忆断层太久，私事全部模糊。',
            '活着出去才是唯一重要的事。',
            '我没有精力回忆无关的琐事。',
        ].some((line) => text.includes(line));
    });
    check('闲聊关键词命中闲聊池', casualAnswer);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const dialogueClosed = (await page.getByRole('button', { name: /结束对话/ }).count()) === 0;
    check('Esc 关闭对话面板', dialogueClosed);

    // ---------------------------------------------------------- 2. 线索拾取
    await page.evaluate(() => window.__tomb.debugTeleport(-8.2, -0.4));
    await page.waitForTimeout(1200);
    await page.keyboard.press('e');
    await page.waitForTimeout(1800);
    const clueCount = await page.evaluate(() => window.__tomb.debugSnapshot().clues.filter((c) => c.collected).length);
    check('触碰拾取壁画通道线索', clueCount === 1, `已拾取 ${clueCount} 条`);

    // ---------------------------------------------------------- 3. 推理板
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const notesOpen = await page.evaluate(() => document.body.innerText.includes('推理板'));
    const notesHasClue = await page.evaluate(() => document.body.innerText.includes('壁画通道'));
    // 询问记录在第二个页签里
    await page.getByRole('button', { name: /询问记录/ }).click();
    await page.waitForTimeout(800);
    const notesHasLog = await page.evaluate(() => document.body.innerText.includes('高教授'));
    check('推理板打开并显示线索与问答记录', notesOpen && notesHasClue && notesHasLog,
        `panel=${notesOpen} clue=${notesHasClue} log=${notesHasLog}`);
    await page.screenshot({ path: path.join(OUT, '61-notes.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // ------------------------------------------- 3.5 关键词证词 × 线索交叉验证
    // 小远「固定全部真话」，按顺序轮转：问满一轮就能拿全她的证词
    await page.evaluate(() => {
        const npc = window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'xiaoyuan');
        window.__tomb.debugTeleport(npc.x, npc.z + 1.6);
        window.__tomb.debugFace(npc.x, npc.z);
    });
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');
    await page.waitForTimeout(1500);
    for (let i = 0; i < 6; i += 1) {
        await page.getByRole('button', { name: '你是伪人吗？' }).click();
        await page.waitForTimeout(700);
    }
    const heardQuotes = await page.evaluate(() => {
        const text = document.body.innerText;
        return [
            '高教授和我，是确定的好人。',
            '古墓遗留线索一共五条，三真两假。',
            '队伍里面藏着伪人，数量不固定。',
        ].filter((line) => text.includes(line)).length;
    });
    check('小远轮转出关键可信证词', heardQuotes === 3, `命中 ${heardQuotes}/3`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);

    // 拾取假线索碎片2（它称高教授是伪人），交叉验证应该判它为伪造
    await page.evaluate(() => window.__tomb.debugTeleport(-6, 4.4));
    await page.waitForTimeout(1200);
    await page.keyboard.press('e');
    await page.waitForTimeout(1800);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const verdict = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            forged: text.includes('判定为伪造'),
            unverified: text.includes('真伪待验证'),
        };
    });
    check('交叉验证判定碎片2为伪造', verdict.forged, JSON.stringify(verdict));
    await page.screenshot({ path: path.join(OUT, '64-deduction.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // ---------------------------------------------------------- 4. 袭击确认
    await page.evaluate(() => {
        const npc = window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'xiaoyuan');
        window.__tomb.debugTeleport(npc.x, npc.z + 1.8);
        window.__tomb.debugFace(npc.x, npc.z);
    });
    await page.waitForTimeout(1500);
    await page.keyboard.press('f');
    await page.waitForTimeout(1500);
    const confirmOpen = await page.getByRole('button', { name: '动手' }).count();
    check('按 F 弹出袭击确认', confirmOpen > 0);
    await page.screenshot({ path: path.join(OUT, '62-attack-confirm.png') });
    if (confirmOpen) {
        await page.getByRole('button', { name: '动手' }).click();
        await page.waitForTimeout(1800);
    }
    const dead = await page.evaluate(() => window.__tomb.debugSnapshot().npcs.find((n) => n.id === 'xiaoyuan')?.alive === false);
    check('确认后 NPC 被击杀', dead);

    // ---------------------------------------------------------- 5. 伪人偷袭链路
    const deadBefore = await page.evaluate(() =>
        window.__tomb.debugSnapshot().npcs.filter((n) => !n.alive).map((n) => n.id),
    );
    const ambush = await page.evaluate(() => {
        const engine = window.__tomb;
        // 把玩家改成好人（否则伪人不会袭击玩家），再让场上伪人动手
        engine.debugForce({ playerIsImpostor: false });
        const triggered = engine.debugTriggerAmbush();
        return {
            triggered,
            ended: engine.debugSnapshot().ended,
            dead: engine.debugSnapshot().npcs.filter((n) => !n.alive).map((n) => n.id),
        };
    });
    await page.waitForTimeout(2000);
    const preyTitle = await page.evaluate(() => document.querySelector('h2')?.textContent?.trim() ?? null);
    check('伪人偷袭玩家触发「被伪人清除」', ambush.triggered && preyTitle === '被伪人清除',
        `triggered=${ambush.triggered} title=${preyTitle}`);
    check('伪人袭击不会误杀其他 NPC',
        ambush.dead.length === deadBefore.length,
        `袭击前 ${JSON.stringify(deadBefore)} / 袭击后 ${JSON.stringify(ambush.dead)}`);
    await page.screenshot({ path: path.join(OUT, '63-prey.png') });

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? 'ALL INTERACTIONS OK' : `${failed} INTERACTION(S) FAILED`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})();
