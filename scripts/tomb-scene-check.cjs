/**
 * 古墓场景自动巡检：
 *  - 抓取第三人称 / 俯视 / 入口三张截图
 *  - 输出场景统计（网格数、光源数、draw call、三角面数）
 *  - 收集控制台错误
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(
    process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
);
const OUT = path.join(__dirname, '..', 'qa-tomb');

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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 400)));
    fs.mkdirSync(OUT, { recursive: true });

    await page.goto('http://localhost:3000/tomb', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '进入古墓' }).click();
    await page.waitForTimeout(16000);

    const ready = await page.evaluate(() => !!window.__tomb);
    console.log('engine ready:', ready);
    if (!ready) {
        console.log(errors.join('\n'));
        await browser.close();
        return;
    }

    const stats = await page.evaluate(() => {
        const engine = window.__tomb;
        const renderer = engine.renderer;
        const info = renderer.info;
        let meshes = 0;
        let lights = 0;
        let triangles = 0;
        engine.scene.traverse((o) => {
            if (o.isMesh) {
                meshes++;
                const g = o.geometry;
                if (g) {
                    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
                }
            }
            if (o.isLight) lights++;
        });
        return {
            meshes,
            lights,
            triangles: Math.round(triangles),
            drawCalls: info.render.calls,
            renderTriangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            programs: renderer.info.programs?.length ?? 0,
        };
    });
    console.log('scene stats:', JSON.stringify(stats));

    await page.screenshot({ path: path.join(OUT, '30-spawn.png') });

    await page.evaluate(() => window.__tomb.debugOverview());
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, '31-overview.png') });

    await page.evaluate(() => {
        window.__tomb.debugThirdPerson();
        window.__tomb.debugTeleport(-4.5, 2.5);
        window.__tomb.debugFace(4, -6);
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, '32-thirdperson.png') });

    await page.evaluate(() => {
        window.__tomb.debugTeleport(0, 7.6);
        window.__tomb.debugFace(0, 10);
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, '33-gate.png') });

    console.log('--- errors ---');
    console.log(errors.slice(0, 20).join('\n') || '(none)');
    await browser.close();
})();
