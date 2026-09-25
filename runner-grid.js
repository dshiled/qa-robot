// QA-Robot Runner Grid — Job Queue + Runner Registry + Mobile Execution
// Wired into server.js as a module.
// Provides: job creation, runner heartbeat, job dispatch, run status tracking,
//           mobile test execution via Appium.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- Storage ----

const JOBS = new Map();        // job_id -> job object
const RUNNERS = new Map();     // runner_id -> runner object
const RUNNER_JOBS = new Map(); // runner_id -> Set of job_ids

const GRID_DIR = path.join(__dirname, 'grid-runs');
if (!fs.existsSync(GRID_DIR)) fs.mkdirSync(GRID_DIR, { recursive: true });

// ---- Helpers ----

function generateJobId() {
    return 'job-' + crypto.randomBytes(4).toString('hex');
}

function generateRunnerId() {
    return 'runner-' + crypto.randomBytes(4).toString('hex');
}

function timestamp() {
    return new Date().toISOString();
}

// ---- Job Creation ----

function createJob(options) {
    options = options || {};
    const jobId = generateJobId();
    const now = timestamp();

    const job = {
        id: jobId,
        type: options.type || 'e2e',       // e2e | api | mobile
        target_url: options.target_url || process.env.TARGET_URL || 'http://localhost:3000',
        spec: options.spec || null,
        browsers: options.browsers || ['chromium', 'firefox', 'webkit'],
        app_binary_path: options.app_binary_path || null,
        requested_by: options.requested_by || 'dashboard',
        status: 'queued',
        runner_id: null,
        progress: 0,
        started_at: null,
        completed_at: null,
        error: null,
        result: null,
        created_at: now,
        updated_at: now
    };

    JOBS.set(jobId, job);
    persistJob(job);
    console.log('[Grid] Job created: ' + jobId + ' (' + job.type + ', ' + (job.browsers ? job.browsers.join(',') : '') + ')');
    return job;
}

function persistJob(job) {
    try {
        fs.writeFileSync(
            path.join(GRID_DIR, job.id + '.json'),
            JSON.stringify(job, null, 2)
        );
    } catch (err) {
        console.error('[Grid] Failed to persist job ' + job.id + ':', err.message);
    }
}

function updateJob(jobId, updates) {
    const job = JOBS.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { updated_at: timestamp() });
    JOBS.set(jobId, job);
    persistJob(job);
    return job;
}

// ---- Runner Registry ----

function registerRunner(info) {
    info = info || {};
    const runnerId = info.runner_id || generateRunnerId();
    const now = timestamp();

    const runner = {
        id: runnerId,
        name: info.name || 'Runner-' + runnerId.slice(-4),
        version: info.version || '1.0.0',
        ip: info.ip || 'unknown',
        capabilities: info.capabilities || ['chromium', 'firefox', 'webkit'],
        status: 'online',
        current_job: null,
        last_heartbeat: now,
        jobs_completed: 0,
        jobs_failed: 0,
        registered_at: now
    };

    RUNNERS.set(runnerId, runner);
    if (!RUNNER_JOBS.has(runnerId)) RUNNER_JOBS.set(runnerId, new Set());
    console.log('[Grid] Runner registered: ' + runnerId + ' (' + runner.name + ')');
    return runner;
}

function heartbeat(runnerId) {
    const runner = RUNNERS.get(runnerId);
    if (!runner) return null;

    runner.last_heartbeat = timestamp();
    if (runner.status === 'offline') runner.status = 'online';
    RUNNERS.set(runnerId, runner);
    return runner;
}

function findAvailableRunner(browsers) {
    browsers = browsers || [];
    for (const [id, runner] of RUNNERS) {
        if (runner.status !== 'online') continue;
        // For mobile jobs, match on 'mobile' capability
        if (browsers.includes('mobile') && runner.capabilities.includes('mobile')) return runner;
        if (browsers.some(b => runner.capabilities.includes(b))) return runner;
    }
    return null;
}

// ---- Job Dispatch ----

function dispatchJob(jobId) {
    const job = JOBS.get(jobId);
    if (!job) return { error: 'Job not found' };
    if (job.status !== 'queued') return { error: 'Job not in queued state' };

    const runner = findAvailableRunner(job.browsers);
    if (!runner) {
        console.log('[Grid] No available runner for job ' + jobId + ' — will execute locally');
        return { dispatched: false, reason: 'no_runner' };
    }

    job.status = 'dispatched';
    job.runner_id = runner.id;
    updateJob(jobId, job);

    runner.status = 'busy';
    runner.current_job = jobId;
    RUNNERS.set(runner.id, runner);

    if (!RUNNER_JOBS.has(runner.id)) RUNNER_JOBS.set(runner.id, new Set());
    RUNNER_JOBS.get(runner.id).add(jobId);

    console.log('[Grid] Job ' + jobId + ' dispatched to runner ' + runner.id + ' (' + runner.name + ')');
    return { dispatched: true, runner_id: runner.id, runner_name: runner.name };
}

function completeJob(jobId, result) {
    const job = JOBS.get(jobId);
    if (!job) return;

    job.status = result.passed ? 'passed' : 'failed';
    job.completed_at = timestamp();
    job.result = result;

    if (job.runner_id) {
        const runner = RUNNERS.get(job.runner_id);
        if (runner) {
            runner.status = 'online';
            runner.current_job = null;
            runner.jobs_completed += result.passed ? 1 : 0;
            runner.jobs_failed += result.passed ? 0 : 1;
            RUNNERS.set(runner.id, runner);

            const jobSet = RUNNER_JOBS.get(job.runner_id);
            if (jobSet) jobSet.delete(jobId);
        }
    }

    updateJob(jobId, job);
    console.log('[Grid] Job ' + jobId + ' completed: ' + job.status + ' (' + (result.duration || 'N/A') + ')');
}

// ---- Local Execution ----

function executeLocally(job) {
    return new Promise((resolve) => {
        if (job.type === 'mobile') {
            executeMobileLocally(job).then(resolve);
            return;
        }

        console.log('[Grid] Executing job ' + job.id + ' locally (no runner available)');

        updateJob(job.id, { status: 'running', started_at: timestamp() });

        const { exec } = require('child_process');
        const resultsDir = path.join(__dirname, 'test-results');

        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

        let cmd = 'npx playwright test';
        if (job.spec) cmd += ' ' + job.spec;
        if (job.browsers && job.browsers.length === 1) cmd += ' --project=' + job.browsers[0];

        exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
            const passed = !error;
            const durationMatch = (stdout || '').match(/(\d+(?:\.\d+)s)/);
            const duration = durationMatch ? durationMatch[1] : '0s';

            const result = {
                passed: passed,
                duration: duration,
                output: stdout || stderr,
                job_id: job.id,
                executed_at: timestamp(),
                runner: 'local'
            };

            const videoFiles = findVideoFiles(resultsDir);
            if (videoFiles.length > 0) {
                result.video_path = path.basename(videoFiles[0]);
            }

            completeJob(job.id, result);
            resolve(result);
        });
    });
}

// ---- Find Video Files ----

function findVideoFiles(dir) {
    var fileList = [];
    if (!dir || !fs.existsSync(dir)) return fileList;
    var files = fs.readdirSync(dir);
    for (var i = 0; i < files.length; i++) {
        var filePath = path.join(dir, files[i]);
        var stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            var sub = findVideoFiles(filePath);
            for (var j = 0; j < sub.length; j++) fileList.push(sub[j]);
        } else if (files[i].endsWith('.webm') || files[i].endsWith('.mp4')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

// ---- Mobile Execution via Appium ----

async function executeMobileLocally(job) {
    console.log('[Grid] Executing mobile job ' + job.id + ' locally via Appium');

    updateJob(job.id, { status: 'running', started_at: timestamp() });

    // Find the app binary
    let binaryPath = job.app_binary_path;

    if (!binaryPath) {
        const uploadsDir = path.join(__dirname, 'uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir)
                .filter(function (f) { return /\.(apk|ipa|app)$/i.test(f); })
                .sort()
                .reverse();
            if (files.length > 0) {
                binaryPath = path.join(uploadsDir, files[0]);
            }
        }
    }

    if (!binaryPath) {
        const result = {
            passed: false,
            duration: '0s',
            output: 'No app binary found for mobile test. Upload an APK/IPA first.',
            job_id: job.id,
            executed_at: timestamp(),
            runner: 'local',
            error: 'No app binary found'
        };
        completeJob(job.id, result);
        return result;
    }

    console.log('[Grid] Mobile job ' + job.id + ': using binary ' + binaryPath);

    // Check Appium availability
    const appiumPort = parseInt(process.env.APPIUM_PORT || '4723');
    const appiumAvailable = await checkAppium(appiumPort);

    if (!appiumAvailable) {
        const result = {
            passed: false,
            duration: '0s',
            output: 'Appium server not reachable on port ' + appiumPort + '. Start Appium (appium --port ' + appiumPort + ') or set APPIUM_PORT.',
            job_id: job.id,
            executed_at: timestamp(),
            runner: 'local',
            error: 'Appium not available'
        };
        completeJob(job.id, result);
        return result;
    }

    // Run the Appium test via webdriverio
    const { exec } = require('child_process');
    const scriptPath = path.join(GRID_DIR, 'mobile-run-' + job.id + '.js');

    // Escape backslashes for the JS string inside the generated script
    const escapedBinary = binaryPath.replace(/\\/g, '\\\\');

    const mobileScript =
        "const { remote } = require('webdriverio');\n" +
        "const appiumPort = process.env.APPIUM_PORT || '4723';\n" +
        "const binaryPath = '" + escapedBinary + "';\n" +
        "\n" +
        "async function run() {\n" +
        "  const caps = {\n" +
        "    platformName: 'Android',\n" +
        "    'appium:deviceName': 'Android_Emulator',\n" +
        "    'appium:app': binaryPath,\n" +
        "    'appium:ensureWebviewsHavePages': true,\n" +
        "    'appium:nativeWebScreenshot': true,\n" +
        "    'appium:newCommandTimeout': 3600,\n" +
        "    'appium:connectHardwareKeyboard': true\n" +
        "  };\n" +
        "  let driver;\n" +
        "  try {\n" +
        "    driver = await remote({ hostname: '127.0.0.1', port: parseInt(appiumPort), path: '/wd/hub', capabilities: caps });\n" +
        "    await driver.pause(5000);\n" +
        "    const contexts = await driver.getContexts();\n" +
        "    await driver.deleteSession();\n" +
        "    return { passed: true, duration: '5s', output: 'Mobile test passed — session opened, contexts: ' + contexts.join(', ') + '', contexts: contexts };\n" +
        "  } catch (err) {\n" +
        "    try { await driver.deleteSession(); } catch(e) {}\n" +
        "    return { passed: false, duration: '0s', output: 'Appium error: ' + err.message, error: err.message };\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "run().then(r => { console.log(JSON.stringify(r)); process.exit(r.passed ? 0 : 1); })\n" +
        ".catch(err => { console.error(JSON.stringify({ passed: false, duration: '0s', output: err.message, error: err.message })); process.exit(1); });\n";

    fs.writeFileSync(scriptPath, mobileScript);

    return new Promise((resolve) => {
        exec('node "' + scriptPath + '"', { cwd: __dirname, timeout: 120000 }, (error, stdout, stderr) => {
            let result;
            try {
                const jsonMatch = (stdout || '').match(/\{[^{}]*"passed":\s*(true|false)[^{}]*\}/);
                if (jsonMatch) {
                    try { result = JSON.parse(jsonMatch[0]); } catch(e) { result = null; }
                }
                if (!result) {
                    result = {
                        passed: !error,
                        duration: '5s',
                        output: stdout || stderr,
                        job_id: job.id,
                        executed_at: timestamp(),
                        runner: 'local'
                    };
                }
                if (result.passed === undefined) result.passed = !error;
                if (!result.duration) result.duration = '5s';
                if (!result.output) result.output = stdout || stderr;
            } catch (e) {
                result = {
                    passed: !error,
                    duration: '5s',
                    output: stdout || stderr,
                    job_id: job.id,
                    executed_at: timestamp(),
                    runner: 'local'
                };
            }

            completeJob(job.id, result);
            resolve(result);
        });
    });
}

function checkAppium(port) {
    return new Promise((resolve) => {
        const http = require('http');
        const req = http.request({
            hostname: '127.0.0.1',
            port: parseInt(port),
            path: '/wd/hub/status',
            method: 'GET',
            timeout: 3000
        }, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

// ---- Grid Status ----

function getGridStatus() {
    const now = Date.now();
    const staleThreshold = 60000;

    const online = [];
    const busy = [];
    const offline = [];

    for (const [id, runner] of RUNNERS) {
        const isStale = now - new Date(runner.last_heartbeat).getTime() > staleThreshold;
        if (isStale && runner.status !== 'offline') {
            runner.status = 'offline';
            RUNNERS.set(id, runner);
        }

        const entry = Object.assign({}, runner);
        if (runner.status === 'online') online.push(entry);
        else if (runner.status === 'busy') busy.push(entry);
        else offline.push(entry);
    }

    const queued = [];
    const running = [];
    const completed = [];

    for (const [id, job] of JOBS) {
        const entry = Object.assign({}, job);
        if (job.status === 'queued') queued.push(entry);
        else if (job.status === 'running' || job.status === 'dispatched') running.push(entry);
        else completed.push(entry);
    }

    return {
        runners: {
            online: online.length,
            busy: busy.length,
            offline: offline.length,
            total: RUNNERS.size
        },
        jobs: {
            queued: queued.length,
            running: running.length,
            completed: completed.length,
            total: JOBS.size
        },
        runners_list: RUNNERS.values().toArray().sort(function (a, b) {
            return b.jobs_completed - a.jobs_completed;
        }),
        recent_jobs: JOBS.values().toArray()
            .sort(function (a, b) {
                return new Date(b.updated_at) - new Date(a.updated_at);
            })
            .slice(0, 20)
    };
}

// ---- Module Exports ----

module.exports = {
    createJob: createJob,
    updateJob: updateJob,
    dispatchJob: dispatchJob,
    completeJob: completeJob,
    registerRunner: registerRunner,
    heartbeat: heartbeat,
    findAvailableRunner: findAvailableRunner,
    executeLocally: executeLocally,
    executeMobileLocally: executeMobileLocally,
    getGridStatus: getGridStatus,
    generateJobId: generateJobId,
    generateRunnerId: generateRunnerId,
    findVideoFiles: findVideoFiles
};
