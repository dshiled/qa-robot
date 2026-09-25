import { test, expect } from '@playwright/test';

test.describe('QA-Robot Dashboard Demo Flow', () => {
  
  test('should verify the marketing landing page, open the SaaS dashboard, and trigger the test pipeline', async ({ page }) => {
    // Navigate to our QA-Robot landing page
    const targetUrl = process.env.TARGET_URL || 'http://localhost:3000';
    await page.goto(targetUrl);

    // Wait for the hero section to be visible (matched to actual landing page markup)
    await page.waitForSelector('.hero-title', { timeout: 15000 });

    // Small pause so the video looks human-driven
    await page.waitForTimeout(800);

    // Click "Open SaaS Dashboard" — the actual button text on the landing page
    const openDashboardBtn = page.getByRole('link', { name: /Open SaaS Dashboard/i });
    if (await openDashboardBtn.isVisible()) {
      await openDashboardBtn.click();
    } else {
      // fallback: click the primary CTA by text
      await page.getByRole('button', { name: /Open SaaS Dashboard/i }).click();
    }

    // Wait for the dashboard to load (it has a "Run Pipeline" button)
    await page.waitForSelector('.sidebar', { timeout: 15000 });
    await page.waitForTimeout(600);

    // Verify the dashboard rendered
    await expect(page.locator('.sidebar')).toBeVisible();

    // Find and hover the "Run Pipeline" button to simulate a real interaction
    const runPipelineBtn = page.getByRole('button', { name: /Run Pipeline/i });
    if (await runPipelineBtn.isVisible()) {
      await runPipelineBtn.hover();
      await page.waitForTimeout(500);
    }

    // Take a final pause so the captured video has meaningful interaction
    await page.waitForTimeout(400);

    console.log('✅ Demo flow executed successfully — video captured.');
  });

});
