// ============================================================================
// Load .env FIRST — before any module reads process.env.
// Without this, GEMINI_API_KEY / STRIPE_SECRET_KEY / PORT are all undefined
// unless the shell exports them, and features silently no-op.
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const multer = require('multer');
const crypto = require('crypto');

// Load auth+billing module
const auth = require('./auth-billing.js');

// Load audit log module
const audit = require('./audit-log.js');

// Load runner grid module
const grid = require('./runner-grid.js');

// Load prompt safety module
const promptSafety = require('./prompt-safety.js');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

// SECURITY: CORS is restricted by default. A blanket cors() lets any origin
// call this API. Set ALLOWED_ORIGINS to a comma-separated list to permit
// specific origins (e.g. https://app.example.com).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

if (allowedOrigins.length > 0) {
    app.use(cors({ origin: allowedOrigins, credentials: true }));
    console.log('[CORS] Restricted to: ' + allowedOrigins.join(', '));
} else {
    // Default: same-origin only. No Access-Control-Allow-Origin header is
    // emitted, so browsers block cross-origin XHR from other sites.
    app.use(cors({ origin: false }));
    console.log('[CORS] Same-origin only (set ALLOWED_ORIGINS to widen)');
}

app.use(express.json());

// Serve static assets
app.use(express.static(path.join(__dirname, 'dashboard-ui'), { index: false }));

// ---- SAML SSO: DISABLED (SECURITY) ----
// SAML is NOT mounted. validateSamlResponse() never verifies the XML
// signature — it regex-scrapes <NameID> out of the POST body and returns
// valid:true, so anyone able to reach /saml/callback could forge an
// assertion and log in as any user. It also calls auth.getUserByEmail(),
// auth.createUser() and auth.logAuthEvent(), none of which exist.
//
// Shipping this mounted while selling a security product would be worse
// than having no SSO at all. To re-enable, a real signature-verifying
// library (@node-saml/node-saml-passport or xml-crypto) must be integrated
// and the missing user-store functions implemented first.
// See saml.js for the integration outline.

// Public Landing Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard-ui', 'landing.html'));
});

// SaaS Dashboard App
app.get(['/app', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard-ui', 'index.html'));
});

// ---- Helpers ----

function findVideoFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findVideoFiles(filePath, fileList);
        } else if (file.endsWith('.webm') || file.endsWith('.mp4')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

function generateRunId() {
    return 'ci-' + crypto.randomBytes(4).toString('hex');
}

function getFallbackRuns() {
    return [
        { id: "sample_video.webm", suite: "Hospital OS Core Flows", duration: "8.7s", date: "Just now", status: "passed" },
        { id: "sample_video.webm", suite: "Checkout E2E Suite", duration: "12.4s", date: "2 hours ago", status: "passed" },
        { id: "sample_video.webm", suite: "Registration Form Edge Cases", duration: "4.1s", date: "5 hours ago", status: "failed" },
        { id: "sample_video.webm", suite: "Hospital OS Core Flows", duration: "8.5s", date: "Yesterday", status: "passed" }
    ];
}

// ---- Video Streaming ----

app.get('/api/videos/:filename', (req, res) => {
    const filename = req.params.filename;
    const testResultsDir = path.join(__dirname, 'test-results');
    
    const allVideos = findVideoFiles(testResultsDir);
    let videoPath = allVideos.find(v => path.basename(v) === filename || v.includes(filename));
    
    if (!videoPath && allVideos.length > 0) {
        videoPath = allVideos[0];
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
        return res.status(404).send('Video file not found');
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': videoPath.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        });
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': videoPath.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        });
        fs.createReadStream(videoPath).pipe(res);
    }
});

// ---- Test Runs ----

app.get('/api/runs', (req, res) => {
    const reportPath = path.join(__dirname, 'test-results', 'report.json');
    
    if (fs.existsSync(reportPath)) {
        try {
            const data = fs.readFileSync(reportPath, 'utf8');
            const report = JSON.parse(data);
            
            const allSpecs = [];
            function collectSpecs(suites) {
                for (const suite of suites) {
                    if (suite.specs && suite.specs.length > 0) allSpecs.push(...suite.specs);
                    if (suite.suites && suite.suites.length > 0) collectSpecs(suite.suites);
                }
            }
            collectSpecs(report.suites);
            
            const runs = allSpecs.map((spec, index) => {
                const test = spec.tests && spec.tests.length > 0 ? spec.tests[0] : null;
                const result = test && test.results && test.results.length > 0 ? test.results[0] : null;
                const videoAttachment = result && result.attachments 
                    ? result.attachments.find(a => a.name === 'video') 
                    : null;
                const videoName = videoAttachment ? path.basename(videoAttachment.path) : null;
                
                return {
                    id: videoName || `run-00${index + 1}.webm`,
                    suite: spec.title || 'Unknown Suite',
                    duration: result ? `${(result.duration / 1000).toFixed(1)}s` : '0s',
                    date: result && result.startTime ? new Date(result.startTime).toLocaleString() : new Date().toLocaleString(),
                    status: (result && (result.status === 'passed' || result.status === 'expected')) ? 'passed' : 'failed'
                };
            });
            
            return res.json(runs.length > 0 ? runs : getFallbackRuns());
        } catch (error) {
            console.error('[api/runs] Error parsing report.json:', error.message);
            return res.json(getFallbackRuns());
        }
    } else {
        return res.json(getFallbackRuns());
    }
});

// ---- On-Demand Test Execution (Grid-Aware) ----

app.post('/api/run-tests', (req, res) => {
    const spec = req.body && req.body.spec ? req.body.spec : null;
    const browsers = req.body && req.body.browsers ? req.body.browsers : ['chromium', 'firefox', 'webkit'];

    // Create a grid job. createJob validates spec/browsers and THROWS on
    // invalid input — surface that as a 400 rather than a 500/crash.
    let job;
    try {
        job = grid.createJob({
            type: 'e2e',
            spec: spec,
            browsers: browsers,
            requested_by: 'dashboard'
        });
    } catch (e) {
        console.warn('[Backend] Rejected test run:', e.message);
        return res.status(400).json({ success: false, error: e.message });
    }

    console.log(`[Backend] Triggering test run${spec ? ' (' + spec + ')' : ''} on ${job.browsers.join(', ')}...`);

    // Audit log: test run started
    audit.logTestRun({
        actor: 'dashboard',
        actor_type: 'system',
        tenant: 'default',
        target: null,
        details: { spec: job.spec || 'all', browsers: job.browsers, triggered_by: 'dashboard' },
        ip: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent']
    });

    // Try to dispatch to a runner
    const dispatch = grid.dispatchJob(job.id);

    if (dispatch.dispatched) {
        // Runner will pick it up — return job ID for polling
        console.log(`[Backend] Job ${job.id} dispatched to runner ${dispatch.runner_id}`);
        return res.json({
            success: true,
            message: 'Test run dispatched to runner grid',
            job_id: job.id,
            runner: dispatch.runner_name,
            status: 'dispatched'
        });
    }

    // No runner available — execute locally and wait
    console.log(`[Backend] No runner available — executing job ${job.id} locally`);
    grid.executeLocally(job).then(result => {
        res.json({
            success: true,
            message: 'Playwright test execution finished',
            passed: result.passed,
            duration: result.duration,
            output: result.output,
            job_id: job.id,
            video: result.video_path,
            runner: 'local'
        });
    }).catch(err => {
        res.status(500).json({ success: false, error: err.message, job_id: job.id });
    });
});

// ---- Grid Job Endpoints ----

// Create a grid job (programmatic API)
app.post('/api/grid/jobs', (req, res) => {
    // createJob validates spec/browsers and throws on invalid input.
    let job;
    try {
        job = grid.createJob({
            type: req.body.type,
            target_url: req.body.target_url,
            spec: req.body.spec,
            browsers: req.body.browsers,
            requested_by: req.body.requested_by || 'api'
        });
    } catch (e) {
        console.warn('[Grid API] Rejected job:', e.message);
        return res.status(400).json({ error: e.message });
    }

    const dispatch = grid.dispatchJob(job.id);
    res.json({
        job_id: job.id,
        status: dispatch.dispatched ? 'dispatched' : 'queued',
        runner: dispatch.runner_name || null,
        browsers: job.browsers,
        type: job.type
    });
});

// SECURITY: jobId arrives from the URL and is used to build a filesystem
// path. Reject anything that is not a plain job-XXXXXXXX id, otherwise
// path traversal could read/write arbitrary .json files.
function isValidJobId(jobId) {
    return typeof jobId === 'string' && /^job-[0-9a-f]{8}$/.test(jobId);
}

// Get job status
app.get('/api/grid/jobs/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    if (!isValidJobId(jobId)) {
        return res.status(400).json({ error: 'Invalid job id' });
    }
    // Read from disk (the authoritative store for completed jobs)
    try {
        const jobPath = path.join(__dirname, 'grid-runs', `${jobId}.json`);
        if (fs.existsSync(jobPath)) {
            const jobData = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
            return res.json(jobData);
        }
    } catch {}
    res.status(404).json({ error: 'Job not found' });
});

// List recent jobs
app.get('/api/grid/jobs', (req, res) => {
    const status = grid.getGridStatus();
    res.json(status.recent_jobs);
});

// Complete a job (called by runner after execution)
app.post('/api/grid/jobs/:jobId/complete', (req, res) => {
    const jobId = req.params.jobId;
    if (!isValidJobId(jobId)) {
        return res.status(400).json({ error: 'Invalid job id' });
    }
    const { passed, duration, output, video_path } = req.body;

    // Update via grid module
    const job = grid.updateJob(jobId, {
        status: passed ? 'passed' : 'failed',
        completed_at: new Date().toISOString(),
        result: {
            passed,
            duration: duration || '0s',
            output: output || '',
            video_path: video_path || null,
            runner: 'runner'
        }
    });

    if (!job) {
        // Fallback: write to disk directly
        try {
            const jobPath = path.join(__dirname, 'grid-runs', jobId + '.json');
            if (fs.existsSync(jobPath)) {
                const jobData = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
                jobData.status = passed ? 'passed' : 'failed';
                jobData.completed_at = new Date().toISOString();
                jobData.result = { passed, duration: duration || '0s', output: output || '', video_path: video_path || null, runner: 'runner' };
                fs.writeFileSync(jobPath, JSON.stringify(jobData, null, 2));

                // Audit log: job completed via fallback
                audit.logJobComplete({
                    actor: 'runner',
                    actor_type: 'runner',
                    tenant: 'default',
                    target: jobId,
                    details: { passed: passed, duration: duration || '0s', runner: 'local' },
                    ip: req.ip || req.connection.remoteAddress,
                    user_agent: req.headers['user-agent']
                });

                return res.json(jobData);
            }
        } catch {}
        return res.status(404).json({ error: 'Job not found' });
    }

    // Audit log: job completed
    audit.logJobComplete({
        actor: 'runner',
        actor_type: 'runner',
        tenant: 'default',
        target: jobId,
        details: { passed: passed, duration: duration || '0s', runner: 'runner' },
        ip: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent']
    });

    res.json({ success: true, job_id: jobId, status: job.status });
});

// ---- Grid Runner Endpoints ----

// Register / heartbeat a runner
app.post('/api/grid/runners', (req, res) => {
    const runner = grid.registerRunner(req.body);
    res.json({
        runner_id: runner.id,
        name: runner.name,
        status: runner.status,
        capabilities: runner.capabilities,
        message: 'Runner registered. Include this runner_id in heartbeat calls.'
    });
});

// Heartbeat (called by runner every 30s)
app.post('/api/grid/runners/heartbeat', (req, res) => {
    const runnerId = req.body && req.body.runner_id;
    if (!runnerId) return res.status(400).json({ error: 'runner_id required' });

    const runner = grid.heartbeat(runnerId);
    if (!runner) return res.status(404).json({ error: 'Runner not found' });

    res.json({ status: runner.status, current_job: runner.current_job });
});

// Get grid status (dashboard)
app.get('/api/grid/status', (req, res) => {
    res.json(grid.getGridStatus());
});

// ---- Prompt Safety Layer ----

// Check a prompt for safety (the main endpoint apps call)
// POST /api/check-prompt  { "prompt": "...", "context": { ... } }
// Returns { safe, intent, label, severity, flags, prompt_length, advice }
app.post('/api/check-prompt', express.json({ limit: '1mb' }), (req, res) => {
    try {
        const prompt = req.body && req.body.prompt;
        if (!prompt) return res.status(400).json({ error: 'prompt is required' });

        const context = {
            user_agent: req.headers['user-agent'] || null,
            ip: req.ip || req.connection.remoteAddress || null,
            api_key_id: (req.apiKeyInfo && req.apiKeyInfo.id) || null,
            tenant: (req.apiKeyInfo && req.apiKeyInfo.team) || null,
            target_url: (req.body && req.body.context && req.body.context.target_url) || null,
            source: 'check-prompt-api'
        };

        const inspection = promptSafety.inspectPrompt(prompt, context);

        // Audit log: prompt submission
        audit.logPromptSubmit({
            actor: context.api_key_id || 'anonymous',
            actor_type: context.api_key_id ? 'api_key' : 'user',
            tenant: context.tenant,
            target: null,
            details: { prompt_preview: (prompt && prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt), intent: inspection.intent, safe: inspection.safe },
            ip: context.ip,
            user_agent: context.user_agent
        });

        // Record alert if needed
        if (inspection.shouldAlert) {
            promptSafety.recordAlert(inspection, prompt);
        }

        // Build advice string
        var advice = '';
        if (!inspection.safe) {
            if (inspection.severity === 'critical') {
                advice = 'BLOCKED: This prompt contains a critical safety violation and was not processed. Do not send this prompt again.';
            } else if (inspection.severity === 'high') {
                advice = 'WARNING: This prompt was flagged for a high-severity safety concern. Review before allowing test generation. If this is a legitimate test scenario, rephrase to avoid the flagged pattern.';
            } else {
                advice = 'FLAGGED: This prompt triggered a safety review. Verify intent before proceeding.';
            }
        } else if (inspection.intent === 'none' && inspection.prompt_length > promptSafety.MAX_PROMPT_LENGTH) {
            advice = 'OK: Prompt is safe but unusually long (' + inspection.prompt_length + ' chars). Consider shortening for faster processing.';
        } else {
            advice = 'OK: Prompt passed safety inspection.';
        }

        res.json({
            safe: inspection.safe,
            intent: inspection.intent,
            label: inspection.label,
            severity: inspection.severity,
            flags: inspection.flags,
            prompt_length: inspection.prompt_length,
            advice: advice,
            timestamp: inspection.timestamp
        });
    } catch (error) {
        console.error('[PromptSafety] /api/check-prompt error:', error.message);
        res.status(500).json({ error: 'Safety check failed: ' + error.message });
    }
});

// Get recent prompt safety alerts (dashboard)
app.get('/api/prompt-alerts', (req, res) => {
    try {
        var limit = parseInt(req.query.limit) || 50;
        res.json(promptSafety.getRecentAlerts(limit));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get prompt safety stats
app.get('/api/prompt-alerts/stats', (req, res) => {
    try {
        res.json(promptSafety.getAlertStats());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---- CI Integration ----

// In-memory CI runs store
const ciRuns = new Map();

// POST /api/ci/results — called by GitHub Actions after test run
app.post('/api/ci/results', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const body = req.body;
        const runId = generateRunId();
        const timestamp = new Date().toISOString();

        const ciRun = {
            id: runId,
            github_run_id: body.run_id || null,
            github_job_id: body.job_id || null,
            repo: body.repo || null,
            ref: body.ref || null,
            sha: body.sha || null,
            event: body.event || 'push',
            pr_number: body.pull_request_number || null,
            status: body.status || 'completed',
            conclusion: body.conclusion || 'success',
            url: body.url || null,
            commit_url: body.commit_url || null,
            test_results: body.test_results || [],
            dashboard_url: `http://localhost:${PORT}/app`,
            created_at: timestamp,
            updated_at: timestamp
        };

        ciRuns.set(runId, ciRun);

        // Persist to disk
        const ciDir = path.join(__dirname, 'ci-runs');
        if (!fs.existsSync(ciDir)) fs.mkdirSync(ciDir, { recursive: true });
        fs.writeFileSync(path.join(ciDir, `${runId}.json`), JSON.stringify(ciRun, null, 2));

        const totalTests = ciRun.test_results?.length || 0;
        const failedTests = ciRun.test_results?.filter(t => t.status === 'failed').length || 0;
        console.log(`[CI] Received results for ${runId}: ${ciRun.conclusion} (${totalTests} tests, ${failedTests} failed)`);

        // Audit log: CI results received
        audit.logEvent({
            type: 'ci_results',
            event_type: 'ci.results_received',
            actor: 'github-actions',
            actor_type: 'system',
            tenant: ciRun.repo,
            target: ciRun.github_run_id,
            details: { conclusion: ciRun.conclusion, total_tests: totalTests, failed_tests: failedTests, repo: ciRun.repo, ref: ciRun.ref },
            ip: req.ip || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        // Post PR comment if this was a PR
        if (ciRun.event === 'pull_request' && ciRun.pr_number && ciRun.repo) {
            postPRComment(ciRun).catch(err => console.error('[CI] PR comment failed:', err.message));
        }

        // Set commit status
        if (ciRun.sha && ciRun.repo) {
            setCommitStatus(ciRun).catch(err => console.error('[CI] Commit status failed:', err.message));
        }

        res.json({ success: true, run_id: runId, message: 'CI results received' });

    } catch (error) {
        console.error('[CI] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Async: post comment on GitHub PR
async function postPRComment(ciRun) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) { console.log('[CI] GITHUB_TOKEN not set — skipping PR comment'); return; }

    const passed = ciRun.conclusion === 'success';
    const total = ciRun.test_results?.length || 0;
    const failed = ciRun.test_results?.filter(t => t.status === 'failed').length || 0;
    const passedCount = total - failed;

    const commentBody = `## 🤖 QA-Robot E2E Test Results

| Metric | Value |
|--------|-------|
| **Status** | ${passed ? '✅ Passed' : '❌ Failed'} |
| **Tests Run** | ${total} |
| **Passed** | ${passedCount} |
| **Failed** | ${failed} |
| **Commit** | [${ciRun.sha?.substring(0, 7)}](${ciRun.commit_url || ciRun.url}) |
| **Workflow** | [View on GitHub](${ciRun.url}) |

${failed > 0 ? `### ❌ Failed Tests

${ciRun.test_results.filter(t => t.status === 'failed').map(t => `- **${t.name || t.suite}**: ${t.error || 'Test failed'}`).join('\n')}

🎥 **Watch the failure video**: [QA-Robot Dashboard](${ciRun.dashboard_url})
` : '✅ All tests passed — ready to merge.'}

---
*🤖 Automated by [QA-Robot](${ciRun.dashboard_url})*`;

    const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(ciRun.repo)}/issues/${encodeURIComponent(ciRun.pr_number)}/comments`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ body: commentBody })
        }
    );

    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const comment = await res.json();
    console.log(`[CI] Posted PR comment #${comment.id} on ${ciRun.repo}#${ciRun.pr_number}`);
}

// Async: set commit status on GitHub
async function setCommitStatus(ciRun) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) { console.log('[CI] GITHUB_TOKEN not set — skipping commit status'); return; }

    const state = ciRun.conclusion === 'success' ? 'success' : 'failure';
    const description = ciRun.conclusion === 'success'
        ? 'QA-Robot E2E tests passed'
        : 'QA-Robot E2E tests failed — deploy blocked';

    const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(ciRun.repo)}/statuses/${ciRun.sha}`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                state,
                target_url: ciRun.dashboard_url,
                description,
                context: 'QA-Robot/E2E-Tests'
            })
        }
    );

    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    console.log(`[CI] Set commit status: ${state} for ${ciRun.repo}@${ciRun.sha?.substring(0, 7)}`);
}

// GET /api/ci/runs — list recent CI runs
app.get('/api/ci/runs', (req, res) => {
    const ciDir = path.join(__dirname, 'ci-runs');
    const runs = [];

    if (fs.existsSync(ciDir)) {
        const files = fs.readdirSync(ciDir)
            .filter(f => f.endsWith('.json'))
            .sort()
            .reverse()
            .slice(0, 50);

        for (const file of files) {
            try {
                runs.push(JSON.parse(fs.readFileSync(path.join(ciDir, file), 'utf8')));
            } catch {}
        }
    }

    for (const [, run] of ciRuns) {
        if (!runs.find(r => r.id === run.id)) runs.push(run);
    }

    res.json(runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// ---- Audit Log Endpoints ----

// GET /api/audit — query audit events with filters
app.get('/api/audit', (req, res) => {
    try {
        const options = {
            type: req.query.type || null,
            actor: req.query.actor || null,
            tenant: req.query.tenant || null,
            from: req.query.from || null,
            to: req.query.to || null,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        };
        const result = audit.getEvents(options);
        res.json({
            events: result.events.slice(options.offset, options.offset + options.limit),
            total: result.total,
            filters: result.filters,
            has_more: (options.offset + options.limit) < result.total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/audit/stats — aggregate audit stats
app.get('/api/audit/stats', (req, res) => {
    try {
        res.json(audit.getEventStats());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/audit/export — export audit log (JSON)
app.get('/api/audit/export', (req, res) => {
    try {
        const options = {
            limit: parseInt(req.query.limit) || 1000,
            type: req.query.type || null,
            from: req.query.from || null,
            to: req.query.to || null
        };
        const data = audit.exportAudit(options);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-export.json"');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---- Mobile Test Upload (Grid-Aware) ----

app.post('/api/run-mobile-test', upload.single('appBinary'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No app binary file provided.' });

        console.log(`📥 Received mobile app: ${req.file.originalname}`);

        // Move file to a stable location
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const ext = path.extname(req.file.originalname);
        const destName = 'mobile-app' + ext;
        const destPath = path.join(uploadsDir, destName);

        // Remove old binary if exists
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        fs.renameSync(req.file.path, destPath);

        console.log(`📦 Mobile binary saved: ${destPath}`);

        // Create a grid job for the mobile test
        const job = grid.createJob({
            type: 'mobile',
            target_url: process.env.TARGET_URL || 'http://localhost:3000',
            app_binary_path: destPath,
            browsers: ['mobile'],
            requested_by: 'dashboard'
        });

        // Audit log: mobile test upload
        audit.logMobileUpload({
            actor: 'dashboard',
            actor_type: 'system',
            tenant: 'default',
            target: job.id,
            details: { filename: req.file.originalname, binary_path: destPath },
            ip: req.ip || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        // Try to dispatch to a runner with mobile capability
        const dispatch = grid.dispatchJob(job.id);
        if (dispatch.dispatched) {
            console.log(`[Mobile] Job ${job.id} dispatched to runner ${dispatch.runner_id}`);
            return res.json({
                success: true,
                message: 'Mobile test dispatched to runner grid',
                job_id: job.id,
                runner: dispatch.runner_name,
                status: 'dispatched',
                binary: req.file.originalname
            });
        }

        // No runner — execute locally via Appium
        console.log(`[Mobile] No runner available — executing job ${job.id} locally via Appium`);
        grid.executeMobileLocally(job).then(result => {
            res.json({
                success: true,
                message: 'Mobile test execution completed',
                job_id: job.id,
                passed: result.passed,
                duration: result.duration,
                output: result.output,
                runner: 'local',
                binary: req.file.originalname
            });
        }).catch(err => {
            res.status(500).json({ success: false, error: err.message, job_id: job.id });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---- Auth: API Key Management ----

// Create a new API key (public — first-time setup)
app.post('/api/keys', express.json(), (req, res) => {
    try {
        const key = auth.generateApiKey();
        const info = {
            id: key,
            name: req.body.name || 'Default Key',
            team: req.body.team || 'default',
            tier: 'free',
            is_active: true,
            created_at: new Date().toISOString(),
            last_used: null
        };
        auth.API_KEYS.set(key, info);
        console.log(`[Auth] Created API key: ${key} for ${info.name}`);

        // Audit log
        audit.logApiKeyCreated({
            actor: info.name,
            actor_type: 'user',
            tenant: info.team,
            target: key,
            details: { key_name: info.name, team: info.team, tier: info.tier },
            ip: req.ip || req.connection.remoteAddress,
            user_agent: req.headers['user-agent']
        });

        res.json({ api_key: key, ...info });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all API keys (requires auth)
app.get('/api/keys', auth.requireAuth, (req, res) => {
    const keys = [];
    auth.API_KEYS.forEach((info, key) => {
        keys.push({ api_key: key, name: info.name, team: info.team, tier: info.tier, is_active: info.is_active, created_at: info.created_at });
    });
    res.json(keys);
});

// Upgrade to enterprise (starts Stripe checkout or demo flow)
app.post('/api/keys/:keyId/upgrade', auth.requireAuth, async (req, res) => {
    const { keyId } = req.params;
    const info = auth.API_KEYS.get(keyId);
    if (!info) return res.status(404).json({ error: 'API key not found' });
    if (info.tier === 'enterprise') return res.json({ message: 'Already on enterprise tier' });

    const protocol = req.protocol;
    const host = req.get('host');
    const successUrl = `${protocol}://${host}/app?billing=success&key=${keyId}`;
    const cancelUrl = `${protocol}://${host}/app?billing=cancelled`;

    try {
        const session = await auth.createCheckoutSession(info, successUrl, cancelUrl);
        res.json({
            checkout_url: session.url,
            session_id: session.id,
            mock: session.mock || false,
            message: session.mock
                ? 'Demo mode: Stripe not configured. Simulating upgrade...'
                : 'Redirecting to Stripe Checkout...'
        });
    } catch (error) {
        console.error('[Billing] Checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Billing status
app.get('/api/billing/status', auth.requireAuth, (req, res) => {
    const info = req.apiKeyInfo;
    res.json({
        api_key: info.id,
        tier: info.tier,
        is_active: info.is_active,
        last_used: info.last_used,
        created_at: info.created_at,
        plan: info.tier === 'enterprise'
            ? { price: '$1,000/month', features: ['Unlimited robot runs', 'Video storage', 'CI integration', 'Priority support', 'SLA'] }
            : { price: '$0', features: ['Local runs only', 'AI test generation', 'HTML reports', 'Community support'] }
    });
});

// Stripe webhook endpoint
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.headers['stripe-signature'];
    auth.handleStripeWebhook(req.body, signature)
        .then(result => res.json(result))
        .catch(err => res.status(400).json({ error: err.message }));
});

// ---- Keep Alive ----

function keepAlive() {
    if (typeof Bun !== 'undefined' && Bun.sleep) {
        Bun.sleep(Infinity);
    } else {
        const interval = setInterval(() => {}, 60000);
        process.on('SIGTERM', () => { clearInterval(interval); process.exit(0); });
        process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });
    }
}

app.listen(PORT, () => {
    console.log(`QA-Robot Public Site & SaaS backend running at http://localhost:${PORT}`);
});

keepAlive();
