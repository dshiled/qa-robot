import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Target defaults to a locally running QA-Robot server.
const targetUrl = process.env.TARGET_URL || 'http://localhost:3000';

// The dashboard requires an API key. Read it from the first-run file so the
// test can unlock the UI; skip rather than fail if the file is absent.
const keyFile = path.join(__dirname, '..', 'data', 'ADMIN_KEY.txt');
function readAdminKey(): string | null {
    if (!fs.existsSync(keyFile)) return null;
    const line = fs.readFileSync(keyFile, 'utf8')
        .split('\n').find(l => l.trim().startsWith('qa_live_'));
    return line ? line.trim() : null;
}

test.describe('QA-Robot public surface', () => {

    test('landing page loads and links to the dashboard', async ({ page }) => {
        await page.goto(targetUrl);
        await page.waitForSelector('.hero-title', { timeout: 15000 });

        // Hero states the actual positioning.
        await expect(page.locator('.hero-title')).toContainText(/audits them/i);

        // The CTA now reads "Run it on your infrastructure".
        const cta = page.getByRole('link', { name: /Run it on your infrastructure/i });
        await expect(cta).toBeVisible();
    });

    test('security section states SAML is disabled', async ({ page }) => {
        await page.goto(targetUrl);
        // The page must not advertise SSO, which is switched off.
        await expect(page.getByText('SSO is not enabled')).toBeVisible();
        await expect(page.getByText('MP4 Video Recordings')).toHaveCount(0);
    });

    test('dashboard is gated behind an API key and unlocks with a valid one', async ({ page }) => {
        const key = readAdminKey();
        test.skip(!key, 'No data/ADMIN_KEY.txt — run the server once to create one');

        await page.goto(targetUrl + '/app');
        await page.waitForSelector('.key-gate', { timeout: 15000 });

        // Without a key the dashboard must not be rendered.
        await expect(page.locator('#kpi-container')).toHaveCount(0);

        await page.fill('#api-key-input', key);
        await page.click('#key-submit');

        // After unlocking, the gate is gone and the shell renders.
        await expect(page.locator('.key-gate')).toHaveCount(0, { timeout: 15000 });
        await expect(page.locator('.sidebar')).toBeVisible();
    });

    test('a wrong API key is rejected', async ({ page }) => {
        await page.goto(targetUrl + '/app');
        await page.waitForSelector('.key-gate', { timeout: 15000 });

        await page.fill('#api-key-input', 'qa_live_' + '0'.repeat(64));
        await page.click('#key-submit');

        // The gate stays up and the bad key is not persisted.
        await expect(page.locator('.key-gate')).toBeVisible();
        const stored = await page.evaluate(() => sessionStorage.getItem('qaRobotApiKey'));
        expect(stored).toBeNull();
    });

    test('saml routes are not mounted', async ({ request }) => {
        for (const path of ['/saml/metadata', '/saml/login', '/saml/callback']) {
            const res = await request.get(targetUrl + path);
            expect(res.status(), `${path} must not be reachable`).toBe(404);
        }
    });

    test('api rejects unauthenticated requests', async ({ request }) => {
        const res = await request.get(targetUrl + '/api/runs');
        expect(res.status()).toBe(401);
    });
});

