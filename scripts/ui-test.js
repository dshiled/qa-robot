// Smoke test for the dashboard key gate, using the chromium already installed
// for Playwright. Verifies that the dashboard is NOT rendered without a key,
// and that the gate screen appears instead.
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const KEY_FILE = require('path').join(__dirname, '..', 'data', 'ADMIN_KEY.txt');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(label, cond) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
    cond ? pass++ : fail++;
}

(async () => {
    const browser = await chromium.launch();

    try {
        // ---- 1. No key: gate must appear, dashboard must not ----
        let ctx = await browser.newContext();
        let page = await ctx.newPage();
        await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
        await page.waitForTimeout(800);

        const gateVisible = await page.locator('.key-gate').count();
        const kpiCount = await page.locator('#kpi-container').count();
        ok('key gate renders without a key', gateVisible === 1);
        ok('dashboard content NOT rendered without a key', kpiCount === 0);
        ok('no API key in sessionStorage before unlock',
           await page.evaluate(() => sessionStorage.getItem('qaRobotApiKey')) === null);
        await ctx.close();

        // ---- 2. Wrong key: rejected, still gated ----
        ctx = await browser.newContext();
        page = await ctx.newPage();
        await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
        await page.fill('#api-key-input', 'qa_live_' + '0'.repeat(64));
        await page.click('#key-submit');
        await page.waitForTimeout(1500);
        ok('wrong key is rejected and gate stays',
           await page.locator('.key-gate').count() === 1);
        ok('wrong key not persisted',
           await page.evaluate(() => sessionStorage.getItem('qaRobotApiKey')) === null);
        await ctx.close();

        // ---- 3. Real key: dashboard unlocks ----
        if (!fs.existsSync(KEY_FILE)) {
            console.log('  SKIP  valid-key test (data/ADMIN_KEY.txt not present)');
        } else {
            const key = fs.readFileSync(KEY_FILE, 'utf8')
                .split('\n').find(l => l.trim().startsWith('qa_live_')).trim();

            ctx = await browser.newContext();
            page = await ctx.newPage();
            await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
            await page.fill('#api-key-input', key);
            await page.click('#key-submit');
            await page.waitForTimeout(2500);

            ok('key stored in sessionStorage after unlock',
               await page.evaluate(() => sessionStorage.getItem('qaRobotApiKey')) !== null);
            ok('key NOT in localStorage (does not outlive session)',
               await page.evaluate(() => localStorage.getItem('qaRobotApiKey')) === null);
            ok('gate dismissed after valid key',
               await page.locator('.key-gate').count() === 0);

            // Data must actually load, not silently fall back to fake rows.
            const rows = await page.locator('.runs-table tbody tr').count();
            ok('runs table populated from the API', rows > 0);

            // Settings view: key list must render, with no fake hardcoded key.
            await page.goto(BASE + '/app#/settings', { waitUntil: 'networkidle' });
            await page.waitForTimeout(1200);
            const keyRows = await page.locator('#key-list tbody tr').count();
            ok('API key list renders in settings', keyRows > 0);
            const html = await page.content();
            ok('no hardcoded demo key in the DOM',
               !html.includes('qa_live_98f4h2984928f9a8f294'));

            await ctx.close();
        }
    } catch (e) {
        console.log('  ERROR ' + e.message);
        fail++;
    } finally {
        await browser.close();
    }

    console.log('\n========================================');
    console.log('  PASS: ' + pass + '   FAIL: ' + fail);
    console.log('========================================\n');
    process.exit(fail > 0 ? 1 : 0);
})();
