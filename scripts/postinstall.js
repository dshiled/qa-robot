#!/usr/bin/env node
// postinstall — download the Playwright browsers QA-Robot needs.
//
// playwright.config.ts defines chromium, firefox and webkit. A fresh clone has
// none of them, so the first test run would fail with an opaque
// "Executable doesn't exist" error. Installing them here means a user only
// ever runs `npm install` and `npm run ui`.
//
// This never fails the install: a browser download problem should not stop
// someone from cloning the repo, and the test runner prints a clear message
// if a browser is genuinely missing. Re-run manually with:
//     npm run setup:browsers

const { spawn } = require('child_process');

const BROWSERS = ['chromium', 'firefox', 'webkit'];

function run() {
    const isWindows = process.platform === 'win32';
    const npx = isWindows ? 'npx.cmd' : 'npx';

    const args = ['playwright', 'install', ...BROWSERS];
    const child = spawn(npx, args, {
        stdio: 'inherit',
        shell: isWindows,          // needed only to resolve npx.cmd
        windowsHide: true
    });

    child.on('error', () => {
        console.warn('[postinstall] Could not run Playwright browser install.');
        console.warn('[postinstall] Run "npm run setup:browsers" when you need them.');
        process.exit(0);           // never break npm install
    });

    child.on('close', (code) => {
        if (code === 0) {
            console.log('[postinstall] Playwright browsers ready.');
        } else {
            console.warn(`[postinstall] Browser install exited ${code}.`);
            console.warn('[postinstall] Run "npm run setup:browsers" to retry.');
        }
        process.exit(0);           // never break npm install
    });
}

run();
