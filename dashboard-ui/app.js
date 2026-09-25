// Clean SPA Router for QA-Robot Dashboard

const views = {
    dashboard: `
        <!-- Hero Section with Generated 3D Robot Mascot -->
        <section class="hero-banner">
            <div class="hero-text">
                <h1>Great Infrastructure.<br><span class="accent-blue">Better Results.</span></h1>
                <p class="subtitle">We build automated QA robots that test your app, block bugs, and bring in real business confidence.</p>
            </div>
            <img src="mascot.jpg" alt="3D QA Robot Mascot" class="hero-mascot" />
        </section>

        <!-- KPI Cards -->
        <section class="kpi-grid" id="kpi-container">
            <p>Loading metrics...</p>
        </section>

        <!-- Recent Runs Table -->
        <section class="recent-runs">
            <div class="section-header">
                <h2>Recent E2E Deployments</h2>
                <button class="action-btn" onclick="triggerPipeline()">▶ Run Pipeline</button>
            </div>
            <table class="runs-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Test Suite</th>
                        <th>Duration</th>
                        <th>Date</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="runs-tbody">
                    <tr><td colspan="5">Loading runs from API...</td></tr>
                </tbody>
            </table>
        </section>
    `,
    runs: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Test Execution History</h1>
            <p class="subtitle">Complete log of all Playwright headless browser test runs across your environments.</p>
        </header>

        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
            <button class="action-btn" style="background: var(--brand-blue);" onclick="filterRuns('all')">All Runs</button>
            <button class="action-btn" style="background: #10b981;" onclick="filterRuns('passed')">Passed Only</button>
            <button class="action-btn" style="background: #ef4444;" onclick="filterRuns('failed')">Failed Only</button>
        </div>

        <section class="recent-runs">
            <table class="runs-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Test Suite</th>
                        <th>Duration</th>
                        <th>Date</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="runs-tbody">
                    <tr><td colspan="5">Loading test runs...</td></tr>
                </tbody>
            </table>
        </section>
    `,
    videos: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Failed Test Video Artifacts</h1>
            <p class="subtitle">Review MP4 video recordings captured automatically by Playwright when tests fail.</p>
        </header>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
            <div class="kpi-card" style="gap: 16px;">
                <div style="aspect-ratio: 16/9; background: #0f172a; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                    <button class="watch-btn" onclick="openVideoPlayer('run-002')" style="font-size: 1.05rem;">▶ Play Recording (run-002)</button>
                </div>
                <div>
                    <h3 style="color: var(--brand-navy); font-size: 1.1rem; margin-bottom: 4px; font-weight: 800;">Registration Edge Cases</h3>
                    <p style="color: var(--danger); font-size: 0.9rem; font-weight: 600;">Failed at step: Form validation timeout</p>
                </div>
            </div>

            <div class="kpi-card" style="gap: 16px;">
                <div style="aspect-ratio: 16/9; background: #0f172a; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                    <button class="watch-btn" onclick="openVideoPlayer('run-005')" style="font-size: 1.05rem;">▶ Play Recording (run-005)</button>
                </div>
                <div>
                    <h3 style="color: var(--brand-navy); font-size: 1.1rem; margin-bottom: 4px; font-weight: 800;">Billing Checkout Timeout</h3>
                    <p style="color: var(--danger); font-size: 0.9rem; font-weight: 600;">Failed at step: Stripe webFrame load</p>
                </div>
            </div>
        </div>
    `,
    settings: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Enterprise Settings & Billing</h1>
            <p class="subtitle">Manage API credentials, team members, and cloud subscription.</p>
        </header>

        <div style="display: flex; flex-direction: column; gap: 24px;">
            <div class="kpi-card" style="padding: 32px; display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="font-size: 1.3rem; margin-bottom: 4px; color: var(--brand-navy); font-weight: 800;">Enterprise Subscription Plan</h3>
                    <p style="color: var(--text-muted);">$1,000 / month • Unlimited Robot Runs & Video Storage</p>
                </div>
                <button class="upgrade-btn" style="width: auto; padding: 12px 28px;" onclick="alert('Redirecting to Stripe Billing Portal...')">Manage Billing via Stripe</button>
            </div>

            <div class="kpi-card" style="padding: 32px;">
                <h3 style="font-size: 1.2rem; margin-bottom: 12px; color: var(--brand-navy); font-weight: 800;">QA-Robot API Key</h3>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <input type="text" value="qa_live_98f4h2984928f9a8f294" readonly style="flex-grow: 1; padding: 14px; border-radius: 10px; border: 1px solid var(--border-color); background: #f8fafc; font-family: monospace; font-size: 1rem; font-weight: 600;" />
                    <button class="action-btn" onclick="alert('API Key Copied to Clipboard!')">Copy Key</button>
                </div>
            </div>
        </div>

        <!-- SAML SSO Section -->
        <div class="kpi-card" style="padding: 32px; border: 1px solid var(--border-color); background: #0f172a;">
            <h3 style="font-size: 1.2rem; margin-bottom: 12px; color: var(--brand-navy); font-weight: 800;">SAML Single Sign-On</h3>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">Enterprise SSO via your identity provider (Okta, Azure AD, Google Workspace, Auth0, etc.)</p>

            <div id="saml-status" style="padding: 12px 16px; border-radius: 8px; background: #1e293b; margin-bottom: 16px;">
                <span style="color: var(--text-muted); font-size: 0.85rem;">Checking SAML configuration...</span>
            </div>

            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button class="action-btn" id="saml-login-btn" style="background: #7c3aed;">Login via SSO</button>
                <button class="action-btn" style="background: var(--danger);" onclick="if(confirm('Logout from all sessions?')) window.location.href='/saml/logout'">Logout (SLO)</button>
            </div>
            <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 12px;">
                Your SAML metadata is available at: <code style="background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">/saml/metadata</code>
            </p>
        </div>
    `,
    mobile: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Mobile App Testing (Beta)</h1>
            <p class="subtitle">Upload your iOS or Android app to run automated Appium tests on local emulators.</p>
        </header>

        <div class="upload-zone" id="apk-dropzone" onclick="document.getElementById('apk-input').click()">
            <svg class="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
            <h3 class="upload-title">Drag & Drop your .apk or .app file here</h3>
            <p class="upload-subtitle">or click to browse from your computer</p>
            <button class="upload-btn">Browse Files</button>
            <input type="file" id="apk-input" accept=".apk,.app,.ipa" style="display: none;">
        </div>

        <div id="upload-progress">
            <span id="upload-status-text">⏳ Uploading and initializing emulator...</span>
        </div>
    `,
    grid: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Runner Grid</h1>
            <p class="subtitle">Distributed test execution across runner nodes. Start a runner with: <code style="background: #1e293b; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;">qa-robot grid</code></p>
        </header>

        <!-- Grid Status KPI Cards -->
        <section class="kpi-grid" id="grid-kpi-container" style="margin-bottom: 28px;">
            <p>Loading grid status...</p>
        </section>

        <!-- Runners List -->
        <section class="recent-runs" style="margin-bottom: 28px;">
            <div class="section-header">
                <h2>Registered Runners</h2>
                <span id="runner-count" style="color: var(--text-muted); font-size: 0.9rem;"></span>
            </div>
            <div id="runners-container" style="display: flex; flex-direction: column; gap: 12px;">
                <p style="color: var(--text-muted); padding: 16px; text-align: center;">Loading runners...</p>
            </div>
        </section>

        <!-- Jobs Queue -->
        <section class="recent-runs">
            <div class="section-header">
                <h2>Job Queue</h2>
                <span id="job-count" style="color: var(--text-muted); font-size: 0.9rem;"></span>
            </div>
            <table class="runs-table">
                <thead>
                    <tr>
                        <th>Job ID</th>
                        <th>Type</th>
                        <th>Browsers</th>
                        <th>Status</th>
                        <th>Runner</th>
                        <th>Duration</th>
                        <th>Started</th>
                    </tr>
                </thead>
                <tbody id="jobs-tbody">
                    <tr><td colspan="7">Loading jobs...</td></tr>
                </tbody>
            </table>
        </section>
    `,
    audit: `
        <header style="margin-bottom: 24px;">
            <h1 style="font-size: 2.2rem; font-weight: 900; color: var(--brand-navy);">Audit Log</h1>
            <p class="subtitle">Enterprise event history — who did what, when, and from where. Required for SOC 2 / ISO 27001 / HIPAA compliance reviews.</p>
        </header>

        <!-- Filters -->
        <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; align-items: center;">
            <select id="audit-type-filter" style="padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text); font-size: 0.9rem;">
                <option value="">All Event Types</option>
                <option value="api_key_created">API Key Created</option>
                <option value="api_key_revoked">API Key Revoked</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
                <option value="test_run_started">Test Run Started</option>
                <option value="test_run_completed">Test Run Completed</option>
                <option value="job_dispatched">Job Dispatched</option>
                <option value="job_completed">Job Completed</option>
                <option value="prompt_submitted">Prompt Submitted</option>
                <option value="prompt_blocked">Prompt Blocked</option>
                <option value="saml_login">SAML Login</option>
                <option value="saml_logout">SAML Logout</option>
                <option value="mobile_upload">Mobile Upload</option>
                <option value="billing_upgrade">Billing Upgrade</option>
                <option value="team_member_added">Team Member Added</option>
                <option value="config_changed">Config Changed</option>
                <option value="ci_results_received">CI Results Received</option>
            </select>
            <select id="audit-actor-filter" style="padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text); font-size: 0.9rem;">
                <option value="">All Actors</option>
            </select>
            <button class="action-btn" style="background: var(--brand-navy);" onclick="exportAuditLog()">Export JSON</button>
            <span id="audit-count" style="color: var(--text-muted); font-size: 0.9rem; margin-left: auto;"></span>
        </div>

        <!-- Audit Events Table -->
        <section class="recent-runs">
            <table class="runs-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Event Type</th>
                        <th>Actor</th>
                        <th>Actor Type</th>
                        <th>Tenant</th>
                        <th>Target</th>
                        <th>Details</th>
                        <th>IP / UA</th>
                    </tr>
                </thead>
                <tbody id="audit-tbody">
                    <tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--text-muted);">Loading audit events...</td></tr>
                </tbody>
            </table>
        </section>
    `
};

let apiData = [];

// Fetch data from Node.js Backend API
async function fetchTestRuns() {
    try {
        const response = await fetch('http://localhost:3000/api/runs');
        apiData = await response.json();
    } catch (error) {
        console.error("Using fallback data", error);
        apiData = [
            { id: "run-004", suite: "Hospital OS Core Flows", duration: "8.7s", date: "Just now", status: "passed" },
            { id: "run-003", suite: "Checkout E2E", duration: "12.4s", date: "2 hours ago", status: "passed" },
            { id: "run-002", suite: "Registration Edge Cases", duration: "4.1s", date: "5 hours ago", status: "failed" },
            { id: "run-001", suite: "Hospital OS Core Flows", duration: "8.5s", date: "Yesterday", status: "passed" }
        ];
    }
}

function renderKPIs() {
    const container = document.getElementById('kpi-container');
    if (!container) return;

    const total = apiData.length;
    const passed = apiData.filter(r => r.status === 'passed').length;
    const failed = apiData.filter(r => r.status === 'failed').length;
    const passRate = total === 0 ? 0 : ((passed / total) * 100).toFixed(1);

    container.innerHTML = `
        <div class="kpi-card">
            <h3>Total Tests</h3>
            <div class="value">${total}</div>
        </div>
        <div class="kpi-card">
            <h3>Pass Rate</h3>
            <div class="value success">${passRate}%</div>
        </div>
        <div class="kpi-card">
            <h3>Failed Runs</h3>
            <div class="value danger">${failed}</div>
        </div>
    `;
}

function renderTable(filter = 'all') {
    const tbody = document.getElementById('runs-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    let filteredData = apiData;
    if (filter === 'passed') filteredData = apiData.filter(r => r.status === 'passed');
    if (filter === 'failed') filteredData = apiData.filter(r => r.status === 'failed');

    if(filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 24px; text-align: center;">No matching test runs found.</td></tr>';
        return;
    }

    filteredData.forEach(run => {
        const tr = document.createElement('tr');
        const statusClass = run.status === 'passed' ? 'passed' : 'failed';
        const statusText = run.status === 'passed' ? 'Passed' : 'Failed';
        
        let actionHTML = '';
        if (run.status === 'failed') {
            actionHTML = `<button class="watch-btn" onclick="openVideoPlayer('${run.id}')">▶ Watch Video</button>`;
        } else {
            actionHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No Video</span>`;
        }

        tr.innerHTML = `
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td style="font-weight: 600;">${run.suite}</td>
            <td style="color: var(--text-muted);">${run.duration}</td>
            <td style="color: var(--text-muted);">${run.date}</td>
            <td>${actionHTML}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.filterRuns = function(filter) {
    renderTable(filter);
};

window.triggerPipeline = async function() {
    const btn = document.querySelector('.action-btn');
    const originalText = btn ? btn.innerText : '▶ Run Pipeline';
    
    if (btn) {
        btn.innerText = '⏳ Executing Playwright Tests...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
    }

    try {
        const res = await fetch('/api/run-tests', { method: 'POST' });
        const data = await res.json();
        
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        }

        alert(data.passed ? "✅ QA-Robot Test Suite Passed!" : "⚠️ QA-Robot Test Suite Finished (Some tests failed. Video saved!)");
        
        // Refresh table & KPIs with newly generated test report
        await fetchTestRuns();
        renderKPIs();
        renderTable();
        renderGridPanel();

    } catch (err) {
        console.error(err);
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        }
        alert("Failed to connect to backend execution API.");
    }
};

// ---- Grid Panel ----

async function fetchGridStatus() {
    try {
        const res = await fetch('/api/grid/status');
        return await res.json();
    } catch (err) {
        console.error('Failed to fetch grid status:', err);
        return null;
    }
}

function renderGridPanel() {
    fetchGridStatus().then(status => {
        if (!status) return;

        const kpiContainer = document.getElementById('grid-kpi-container');
        if (kpiContainer) {
            kpiContainer.innerHTML = `
                <div class="kpi-card">
                    <h3>Online Runners</h3>
                    <div class="value success">${status.runners.online}</div>
                </div>
                <div class="kpi-card">
                    <h3>Busy Runners</h3>
                    <div class="value" style="color: #f59e0b;">${status.runners.busy}</div>
                </div>
                <div class="kpi-card">
                    <h3>Offline Runners</h3>
                    <div class="value danger">${status.runners.offline}</div>
                </div>
                <div class="kpi-card">
                    <h3>Total Runners</h3>
                    <div class="value">${status.runners.total}</div>
                </div>
                <div class="kpi-card">
                    <h3>Queued Jobs</h3>
                    <div class="value">${status.jobs.queued}</div>
                </div>
                <div class="kpi-card">
                    <h3>Running Jobs</h3>
                    <div class="value" style="color: #f59e0b;">${status.jobs.running}</div>
                </div>
                <div class="kpi-card">
                    <h3>Completed Jobs</h3>
                    <div class="value success">${status.jobs.completed}</div>
                </div>
                <div class="kpi-card">
                    <h3>Total Jobs</h3>
                    <div class="value">${status.jobs.total}</div>
                </div>
            `;
        }

        const runnerCount = document.getElementById('runner-count');
        if (runnerCount) {
            runnerCount.textContent = `${status.runners.total} runner(s) registered`;
        }

        const runnersContainer = document.getElementById('runners-container');
        if (runnersContainer) {
            if (status.runners_list.length === 0) {
                runnersContainer.innerHTML = `
                    <div style="padding: 32px; text-align: center; background: #f8fafc; border-radius: 12px; border: 1px dashed var(--border-color);">
                        <p style="color: var(--text-muted); margin-bottom: 8px;">No runners registered yet.</p>
                        <p style="color: var(--text-muted); font-size: 0.9rem;">Start a runner from the command line:</p>
                        <code style="display: block; background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-top: 12px; font-size: 0.9rem;">
                            qa-robot grid
                        </code>
                        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 8px;">
                            The runner will connect to this dashboard and pick up queued jobs automatically.
                        </p>
                    </div>
                `;
            } else {
                runnersContainer.innerHTML = status.runners_list.map(runner => `
                    <div class="kpi-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="status-badge ${runner.status}">${runner.status}</span>
                                <strong style="color: var(--brand-navy);">${runner.name}</strong>
                                <span style="color: var(--text-muted); font-size: 0.8rem; font-family: monospace;">${runner.id}</span>
                            </div>
                            <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">
                                ${runner.capabilities.join(', ')} &nbsp;|&nbsp; ${runner.jobs_completed} passed, ${runner.jobs_failed} failed
                                ${runner.current_job ? ` &nbsp;|&nbsp; Current: <code style="background: #1e293b; padding: 1px 6px; border-radius: 3px; font-size: 0.8rem;">${runner.current_job}</code>` : ''}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 0.8rem; color: var(--text-muted);">v${runner.version}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">
                                ${new Date(runner.registered_at).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        const tbody = document.getElementById('jobs-tbody');
        const jobCount = document.getElementById('job-count');
        if (tbody && jobCount) {
            jobCount.textContent = `${status.jobs.total} job(s) total`;

            if (status.recent_jobs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--text-muted);">No jobs yet. Click "Run Pipeline" to queue one, or upload an APK on the Mobile Tests page.</td></tr>';
            } else {
                tbody.innerHTML = status.recent_jobs.map(job => {
                    const statusClass = job.status === 'passed' ? 'passed' : (job.status === 'failed' ? 'failed' : (job.status === 'running' ? 'running' : 'queued'));
                    const statusText = job.status.charAt(0).toUpperCase() + job.status.slice(1);
                    const started = job.started_at ? new Date(job.started_at).toLocaleTimeString() : '—';
                    const duration = job.result && job.result.duration ? job.result.duration : (job.status === 'running' ? '…' : '—');
                    const isMobile = job.type === 'mobile';
                    function baseName(p) { if (!p) return '—'; var parts = p.split('/'); if (parts.length === 1) parts = p.split('\\'); return parts[parts.length - 1] || '—'; }
                    const deviceInfo = isMobile ?
                        (job.result && job.result.contexts ? job.result.contexts.join(', ') : (job.app_binary_path ? baseName(job.app_binary_path) : '—')) :
                        (Array.isArray(job.browsers) ? job.browsers.join(', ') : job.browsers || '—');
                    return `
                        <tr>
                            <td style="font-family: monospace; font-size: 0.85rem;">${job.id}</td>
                            <td>${job.type}${isMobile ? ' <span style="background:#8b5cf6;color:white;padding:1px 6px;border-radius:4px;font-size:0.7rem;">mobile</span>' : ''}</td>
                            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${job.app_binary_path || ''}">${isMobile ? (job.app_binary_path ? baseName(job.app_binary_path || '') : '—') : deviceInfo}</td>
                            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                            <td style="font-size: 0.85rem;">${job.runner_id || 'local'}</td>
                            <td>${duration}</td>
                            <td style="font-size: 0.85rem; color: var(--text-muted);">${started}</td>
                        </tr>
                    `;
                }).join('');
            }
        }
    });
}

// ---- Router ----
async function router() {
    const root = document.getElementById('app-root');
    const hash = window.location.hash || '#/dashboard';
    
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.getAttribute('href') === hash) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    if (hash === '#/dashboard') {
        root.innerHTML = views.dashboard;
        await fetchTestRuns();
        renderKPIs();
        renderTable();
    } else if (hash === '#/mobile') {
        root.innerHTML = views.mobile;
        initMobileUpload();
    } else if (hash === '#/runs') {
        root.innerHTML = views.runs;
        await fetchTestRuns();
        renderTable();
    } else if (hash === '#/videos') {
        root.innerHTML = views.videos;
    } else if (hash === '#/settings') {
        root.innerHTML = views.settings;
    } else if (hash === '#/grid') {
        root.innerHTML = views.grid;
        renderGridPanel();
        // Auto-refresh grid panel every 10 seconds
        setInterval(renderGridPanel, 10000);
    } else if (hash === '#/audit') {
        root.innerHTML = views.audit;
        await fetchAuditLog();
        renderAuditLog();
        // Auto-refresh audit log every 30 seconds
        if (window._auditInterval) clearInterval(window._auditInterval);
        window._auditInterval = setInterval(() => { fetchAuditLog().then(renderAuditLog); }, 30000);
    } else {
        root.innerHTML = views.dashboard;
    }
}

// ---- Audit Log ----

async function fetchAuditLog() {
    try {
        const filter = document.getElementById('audit-type-filter');
        const type = filter ? filter.value : '';
        const url = type
            ? `http://localhost:3000/api/audit?type=${encodeURIComponent(type)}`
            : 'http://localhost:3000/api/audit';
        const response = await fetch(url);
        window._auditData = await response.json();
    } catch (error) {
        console.error('Failed to fetch audit log:', error);
        window._auditData = { events: [], total: 0, has_more: false };
    }
}

function renderAuditLog() {
    const tbody = document.getElementById('audit-tbody');
    const countEl = document.getElementById('audit-count');
    const data = window._auditData || { events: [], total: 0 };

    if (countEl) countEl.textContent = `${data.total} event(s) total`;

    if (!tbody) return;
    if (data.events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--text-muted);">No audit events yet. Actions like API key creation, logins, and test runs will appear here.</td></tr>';
        return;
    }

    const typeColors = {
        'api_key_created': '#f59e0b',
        'api_key_revoked': '#ef4444',
        'login': '#10b981',
        'logout': '#6b7280',
        'test_run_started': '#3b82f6',
        'test_run_completed': '#3b82f6',
        'job_dispatched': '#8b5cf6',
        'job_completed': '#8b5cf6',
        'prompt_submitted': '#06b6d4',
        'prompt_blocked': '#dc2626',
        'saml_login': '#7c3aed',
        'saml_logout': '#6b7280',
        'mobile_upload': '#f97316',
        'billing_upgrade': '#10b981',
        'team_member_added': '#059669',
        'config_changed': '#6b7280',
        'ci_results_received': '#14b8a6'
    };

    tbody.innerHTML = data.events.map(e => {
        const color = typeColors[e.type] || 'var(--text-muted)';
        const details = e.details || {};
        const detailStr = Object.keys(details).length > 0
            ? JSON.stringify(details).slice(0, 120) + (JSON.stringify(details).length > 120 ? '…' : '')
            : '—';
        const meta = e.metadata || {};
        const ip = meta.ip || '—';
        const ua = (meta.user_agent || '').split('/')[0] || '—';
        const actorLabel = e.actor_type === 'system' ? `<span style="color: var(--text-muted);">${e.actor}</span>` : e.actor;

        return `
            <tr>
                <td style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">${e.created_at}</td>
                <td><span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 6px;"></span>${e.type}</td>
                <td>${actorLabel}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem; text-transform: capitalize;">${e.actor_type || '—'}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${e.tenant || '—'}</td>
                <td style="font-family: monospace; font-size: 0.8rem; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${e.target || ''}">${e.target || '—'}</td>
                <td style="font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted);" title="${detailStr}">${detailStr}</td>
                <td style="font-size: 0.75rem; color: var(--text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ip} ${ua}">${ip}<br><span style="font-size:0.7rem;">${ua}</span></td>
            </tr>
        `;
    }).join('');
}

function exportAuditLog() {
    const data = window._auditData || { events: [], total: 0 };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-robot-audit-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ---- Mobile Upload ----

function initMobileUpload() {
    const dropzone = document.getElementById('apk-dropzone');
    const input = document.getElementById('apk-input');
    const progress = document.getElementById('upload-progress');
    const statusText = document.getElementById('upload-status-text');

    if (!dropzone || !input) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    input.addEventListener('change', function() {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        if (files.length === 0) return;
        const file = files[0];
        uploadFile(file);
    }

    async function uploadFile(file) {
        dropzone.style.display = 'none';
        progress.style.display = 'block';
        statusText.innerText = `⏳ Uploading ${file.name}...`;

        const formData = new FormData();
        formData.append('appBinary', file);

        try {
            const res = await fetch('/api/run-mobile-test', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                statusText.innerHTML = `✅ Mobile test for <b>${file.name}</b> submitted to grid — check the Runner Grid panel for status.`;
            } else {
                throw new Error("API returned error");
            }
        } catch (err) {
            statusText.innerHTML = `❌ Failed to upload mobile app: ${err.message}`;
            setTimeout(() => {
                progress.style.display = 'none';
                dropzone.style.display = 'block';
            }, 3000);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('hashchange', router);
    router();
});
