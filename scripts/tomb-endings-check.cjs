/**
 * 六种结局的端到端验证。
 *
 * 每个场景都用引擎的调试钩子直接改写局面，然后检查结局面板是否弹出、
 * 标题与成就是否与规则层定义一致。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const OUT = path.join(__dirname, '..', 'qa-tomb');

const CLUE_SET = ['mural', 'rubble', 'gategap'];

const SCENARIOS = [
    {
        id: 'purge',
        title: '肃清伪人',
        achievement: '真相猎手',
        state: {
            playerIsImpostor: false,
            impostorIds: ['xiaolin', 'aze'],
            clueIds: CLUE_SET,
            playerKills: ['xiaolin', 'aze'],
            deadNpcs: ['xiaolin', 'aze'],
        },
    },
    {
        id: 'accomplice',
        title: '同谋屠戮',
        achievement: '共犯',
        state: {
            playerIsImpostor: true,
            impostorIds: ['xiaolin'],
            deadNpcs: ['gao', 'xiaoyuan'],
        },
    },
    {
        id: 'collapse',
        title: '自我崩坏',
        achievement: '失智',
        state: {
            playerIsImpostor: true,
            impostorIds: ['xiaolin'],
            clueIds: CLUE_SET,
        },
        timeLeft: 0,
    },
    {
        id: 'prey',
        title: '被伪人清除',
        achievement: '猎物',
        state: {
            playerIsImpostor: false,
            impostorIds: ['xiaolin'],
            attackedByImpostor: true,
        },
    },
    {
        id: 'escape',
        title: '线索逃生',
        achievement: '逃出生天',
        state: {
            playerIsImpostor: false,
            impostorIds: ['xiaolin'],
            deadNpcs: ['xiaolin'],
            clueIds: CLUE_SET,
            reachedGate: true,
        },
    },
    {
        id: 'trapped',
        title: '困死古墓',
        achievement: '迷失者',
        state: {
            playerIsImpostor: false,
            impostorIds: ['xiaolin'],
        },
        timeLeft: 0,
    },
];

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
    fs.mkdirSync(OUT, { recursive: true });

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForTimeout(16000);

    let failures = 0;
    for (const scenario of SCENARIOS) {
        await page.evaluate(
            ([state, timeLeft]) => {
                window.__tomb.debugForce({ ...state, timeLeft });
            },
            [scenario.state, scenario.timeLeft ?? 240],
        );
        await page.waitForTimeout(1200);

        const overlay = await page.evaluate(() => {
            const heading = document.querySelector('h2');
            const badge = document.querySelector('h2 + div');
            return {
                title: heading?.textContent?.trim() ?? null,
                achievement: badge?.textContent?.trim() ?? null,
                ended: window.__tomb.debugSnapshot().ended,
            };
        });

        const titleOk = overlay.title === scenario.title;
        const achievementOk = overlay.achievement === `成就 · ${scenario.achievement}`;
        const endedOk = overlay.ended === true;
        const pass = titleOk && achievementOk && endedOk;
        if (!pass) failures += 1;
        console.log(
            `${pass ? 'PASS' : 'FAIL'}  ${scenario.id}  title=${overlay.title}  badge=${overlay.achievement}  ended=${overlay.ended}`,
        );
        if (!pass) {
            await page.screenshot({ path: path.join(OUT, `40-ending-${scenario.id}.png`) });
        }

        // 重开一局，准备下一个场景
        // 软件渲染下 3D 重开会让主线程卡顿，指针点击容易超时，这里直接派发 DOM click
        const restart = page.getByRole('button', { name: '再来一局' });
        if (await restart.count()) {
            await page.evaluate(() => {
                const button = Array.from(document.querySelectorAll('button')).find((item) =>
                    /再来一局/.test(item.textContent ?? ''),
                );
                button?.click();
            });
            await page.waitForTimeout(14000);
        }
    }

    console.log('--- page errors ---');
    console.log(errors.slice(0, 10).join('\n') || '(none)');
    console.log(failures === 0 ? 'ALL ENDINGS OK' : `${failures} ENDING(S) FAILED`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
})();
