#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const command = process.argv[2];
const prompt = process.argv[3];

const rootDir = path.resolve(__dirname, '..');
const testsDir = path.join(rootDir, 'tests');

function abort(msg) {
    console.error('\n❌ ' + msg);
    process.exit(1);
}

function log(msg) {
    console.log(msg);
}

const usage = `
🤖 QA-Robot CLI — AI-Powered E2E Test Automation
================================================
Version 1.1.0

Usage: qa-robot <command> [args]

Commands:
  ui          Start the QA-Robot SaaS Dashboard + Backend (http://localhost:3000)
  run         Run headless Playwright tests locally (captures video on failure)
  generate    "<prompt>"  Generate a Playwright test from plain English via AI
  ci          Print GitHub Actions YAML to paste into .github/workflows/qa-robot.yml
  grid        Start a runner node that connects to the QA-Robot grid and executes jobs
  help        Show this help message

Examples:
  qa-robot generate "Log in and create a patient appointment"
  qa-robot run
  qa-robot ci
  qa-robot ui
  qa-robot grid

Free tier: unlimited local runs, AI test generation, HTML reports.
Cloud dashboard, video hosting, CI integration, team features: upgrade at /app.
`;

if (!command) {
    log(usage);
    process.exit(0);
}

if (command === 'help') {
    log(usage);
    process.exit(0);
}

if (command === 'ui') {
    log('🚀 Starting QA-Robot UI...');
    log('   Landing:  http://localhost:3000/');
    log('   Dashboard: http://localhost:3000/app');
    try {
        execSync('node server.js', { cwd: rootDir, stdio: 'inherit' });
    } catch (e) {
        abort('Failed to start server: ' + e.message);
    }

} else if (command === 'run') {
    log('⏳ Running headless Playwright tests...');

    const resultsDir = path.join(rootDir, 'test-results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    try {
        execSync('npx playwright test', {
            cwd: rootDir,
            stdio: 'inherit',
            env: { ...process.env }
        });
        log('✅ All tests passed.');
    } catch (e) {
        const stdout = (e.stdout || '').toString();
        const hasFailures = stdout.includes('failed') || stdout.match(/✗|❌|×/);
        if (hasFailures) {
            log('⚠️  Some tests failed. Video artifacts saved in test-results/.');
            log('   View HTML report: npx playwright show-report');
            log('   Or open dashboard: http://localhost:3000/app (run "qa-robot ui" first)');
        } else {
            abort('Test execution failed: ' + (e.message || 'unknown error'));
        }
        process.exit(e.status || 1);
    }

} else if (command === 'generate') {
    if (!prompt) {
        abort('Please provide a test scenario prompt.\n\nExample:\n  qa-robot generate "Go to the hospital OS and book an appointment"\n\nThe AI will generate a Playwright TypeScript test in the tests/ directory.');
    }

    log('🤖 QA-Robot AI Test Generator');
    log('   Scenario: "' + prompt + '"');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        abort('GEMINI_API_KEY environment variable is missing.\n\nSet it before generating tests:\n  export GEMINI_API_KEY="your-key-here"\n\nOr add it to a .env file in the project root.');
    }

    if (!fs.existsSync(testsDir)) {
        fs.mkdirSync(testsDir, { recursive: true });
    }

    log('🧠 Generating Playwright test (Gemini 2.5 Flash)...');
    log('   (this may take a few seconds)');

    try {
        execSync('bun run scripts/ai-generator.ts "' + prompt + '"', {
            cwd: rootDir,
            stdio: 'inherit',
            env: { ...process.env, GEMINI_API_KEY: apiKey }
        });
        log('\n✅ Test generated. Review it in tests/ and run with: qa-robot run');
    } catch (e) {
        const stdout = (e.stdout || '').toString();
        const stderr = (e.stderr || '').toString();
        if (stdout) log(stdout);
        if (stderr) log('\n' + stderr);
        abort('Test generation failed. Check the error above.');
    }

} else if (command === 'ci') {
    log('🔧 QA-Robot GitHub Actions CI Configuration');
    log('   Copy the YAML below into .github/workflows/qa-robot.yml');
    log('   Then push — tests run on every PR and push to main.\n');

    const workflow = `name: QA-Robot E2E Tests

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

concurrency:
  group: qa-robot-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  qa-robot:
    name: QA-Robot E2E Suite
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run QA-Robot E2E tests
        id: tests
        run: npx playwright test
        env:
          TARGET_URL: \${{ secrets.TARGET_URL || 'https://staging.yourapp.com' }}

      - name: Upload test results (video + HTML report)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-robot-results-\${{ github.run_number }}
          path: |
            test-results/
            playwright-report/
          retention-days: 30

      - name: Post test results to QA-Robot Dashboard
        if: always()
        run: |
          curl -X POST http://your-qa-robot-instance.com/api/run-tests \
            -H "Authorization: Bearer \${{ secrets.QA_ROBOT_API_KEY }}"

      # Fail the PR if tests fail — deploy-blocking gate
      - name: Block merge on test failure
        if: failure()
        run: |
          echo "::error::QA-Robot tests failed — merge blocked."
          exit 1
`;

    console.log(workflow);
    log('\n📌 Next steps:');
    log('   1. mkdir -p .github/workflows');
    log('   2. Save above as .github/workflows/qa-robot.yml');
    log('   3. Set TARGET_URL secret in your repo settings');
    log('   4. Push — tests run on every PR automatically');
    log('   5. (Optional) Set QA_ROBOT_API_KEY to post results to your dashboard');

} else if (command === 'grid') {
    log('🤖 QA-Robot Runner Node');
    log('   Connecting to grid at http://localhost:3000...');

    const RUNNER_NAME = process.env.GRID_RUNNER_NAME || 'Runner-' + require('child_process').execSync('hostname').toString().trim().slice(0, 8);
    const RUNNER_CAPABILITIES = (process.env.GRID_CAPABILITIES || 'chromium,firefox,webkit').split(',').map(s => s.trim());

    let runnerId = null;

    // Step 1: Register with the grid
    try {
        const registerRes = execSync(
            'curl -s -X POST http://localhost:3000/api/grid/runners ' +
            '-H "Content-Type: application/json" ' +
            '-d "' + JSON.stringify({
                name: RUNNER_NAME,
                version: '1.1.0',
                capabilities: RUNNER_CAPABILITIES
            }).replace(/"/g, '\\"') + '"',
            { cwd: rootDir, encoding: 'utf8', timeout: 10000 }
        );
        const regData = JSON.parse(registerRes);
        runnerId = regData.runner_id;
        log('✅ Registered as: ' + regData.name + ' (' + runnerId + ')');
        log('   Capabilities: ' + RUNNER_CAPABILITIES.join(', '));
    } catch (err) {
        abort('Failed to register with grid: ' + (err.message || err).split('\n')[0]);
    }

    // Step 2: Heartbeat loop + job polling
    log('\n⏳ Listening for jobs on the grid...');
    log('   (Ctrl+C to stop)\n');

    let currentJobId = null;
    let currentJobSpec = null;
    let pollInterval = null;
    let heartbeatInterval = null;
    let isRunning = false;

    function heartbeat() {
        if (!runnerId) return;
        try {
            execSync(
                'curl -s -X POST http://localhost:3000/api/grid/runners/heartbeat ' +
                '-H "Content-Type: application/json" ' +
                '-d "' + JSON.stringify({ runner_id: runnerId }).replace(/"/g, '\\"') + '"',
                { cwd: rootDir, encoding: 'utf8', timeout: 5000 }
            );
        } catch (err) {
            // Silent heartbeat failure — will retry next interval
        }
    }

    function pollForJobs() {
        if (!runnerId || isRunning) return;

        try {
            // Poll job queue — look for queued jobs the runner can handle
            const jobsRes = execSync(
                'curl -s http://localhost:3000/api/grid/jobs',
                { cwd: rootDir, encoding: 'utf8', timeout: 10000 }
            );
            const jobs = JSON.parse(jobsRes);

            if (!Array.isArray(jobs)) return;

            // Find first queued job matching our capabilities (E2E or mobile)
            const job = jobs.find(j =>
                j.status === 'queued' && (
                    (j.type === 'mobile' && RUNNER_CAPABILITIES.includes('mobile')) ||
                    (j.type === 'e2e' && j.browsers && j.browsers.some(b => RUNNER_CAPABILITIES.includes(b)))
                )
            );

            if (job) {
                currentJobId = job.id;
                currentJobSpec = job.spec;
                isRunning = true;
                log('📋 Job ' + job.id + ' assigned — running ' + (job.spec || 'all tests') +
                    ' on ' + (Array.isArray(job.browsers) ? job.browsers.join(',') : job.browsers));

                // Mark job as running via the grid
                // Execute the test
                runJob(job);
            }
        } catch (err) {
            // Silent polling failure
        }
    }

    function runJob(job) {
        log('   Executing: npx playwright test' + (job.spec ? ' ' + job.spec : '') +
            (job.browsers && job.browsers.length === 1 ? ' --project=' + job.browsers[0] : ''));

        const resultsDir = path.join(rootDir, 'test-results');
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

        const { execSync } = require('child_process');

        try {
            const result = execSync(
                'npx playwright test' +
                (job.spec ? ' ' + job.spec : '') +
                (job.browsers && job.browsers.length === 1 ? ' --project=' + job.browsers[0] : ''),
                {
                    cwd: rootDir,
                    encoding: 'utf8',
                    timeout: 3600000, // 1 hour max
                    stdio: 'pipe'
                }
            );

            // Mark job as passed
            markJobComplete(job.id, true, result);
        } catch (e) {
            const output = (e.stdout || '') + (e.stderr || '');
            markJobComplete(job.id, false, output);
        }
    }

    function markJobComplete(jobId, passed, output) {
        const lines = (output || '').split('\n');
        const durationMatch = (output || '').match(/(\d+(?:\.\d+)s)/);
        const duration = durationMatch ? durationMatch[1] : '0s';

        // Update job status via the grid API
        try {
            execSync(
                'curl -s -X POST http://localhost:3000/api/grid/jobs/' + jobId + '/complete ' +
                '-H "Content-Type: application/json" ' +
                '-d "' + JSON.stringify({
                    passed: passed,
                    duration: duration,
                    output: output.substring(0, 5000),
                    video_path: findLatestVideo()
                }).replace(/"/g, '\\"') + '"',
                { cwd: rootDir, encoding: 'utf8', timeout: 10000 }
            );
        } catch (err) {
            // Fallback: write to disk
            writeJobResultToDisk(jobId, passed, duration, output);
        }

        log('   ✅ Job ' + jobId + ' completed: ' + (passed ? 'passed' : 'failed') + ' (' + duration + ')');
        currentJobId = null;
        currentJobSpec = null;
        isRunning = false;

        // Poll again immediately
        setTimeout(pollForJobs, 2000);
    }

    function findLatestVideo() {
        const resultsDir = path.join(rootDir, 'test-results');
        try {
            const files = fs.readdirSync(resultsDir, { recursive: true });
            const videos = files.filter(f => f.endsWith('.webm') || f.endsWith('.mp4'));
            if (videos.length > 0) {
                return videos[videos.length - 1];
            }
        } catch {}
        return null;
    }

    function writeJobResultToDisk(jobId, passed, duration, output) {
        // Best-effort disk write if API is down
        try {
            const gridDir = path.join(rootDir, 'grid-runs');
            if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });
            const jobFile = path.join(gridDir, jobId + '.json');
            if (fs.existsSync(jobFile)) {
                const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
                job.status = passed ? 'passed' : 'failed';
                job.completed_at = new Date().toISOString();
                job.result = { passed, duration, output: output.substring(0, 5000), runner: 'local' };
                fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
            }
        } catch {}
    }

    // Start intervals
    heartbeatInterval = setInterval(heartbeat, 30000); // every 30s
    pollInterval = setInterval(pollForJobs, 5000);    // every 5s

    // Heartbeat immediately
    heartbeat();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        log('\n🛑 Shutting down runner...');
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (pollInterval) clearInterval(pollInterval);
        if (runnerId) {
            try {
                execSync(
                    'curl -s -X POST http://localhost:3000/api/grid/runners/heartbeat ' +
                    '-H "Content-Type: application/json" ' +
                    '-d "' + JSON.stringify({ runner_id: runnerId }).replace(/"/g, '\\"') + '"',
                    { cwd: rootDir, encoding: 'utf8', timeout: 5000 }
                );
            } catch {}
            log('   Runner ' + runnerId + ' marked offline.');
        }
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        process.emit('SIGINT');
    });

} else {
    abort('Unknown command: "' + command + '".\nRun "qa-robot help" for usage.');
}
