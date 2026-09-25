// QA-Robot Prompt Safety Layer
// Test-generation-specific risk detection for AI-generated Playwright tests.
// Focused on what actually matters for a QA test automation product.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- Configuration ----

const ENABLE_INSPECTOR = process.env.QA_ROBOT_ENABLE_INSPECTOR !== 'false'; // on by default

// Alert thresholds — only alert on these severity levels by default
const ALERT_SEVERITY = new Set(['high', 'critical']);

// Maximum prompt length to inspect (larger prompts are flagged for review, not blocked)
const MAX_PROMPT_LENGTH = 8000;

// ---- Intent Classification (fast keyword + heuristic first pass) ----

// Risky intents that indicate prompt injection or malicious test generation
const RISKY_INTENT_PATTERNS = [
    // Extraction / data exfiltration
    { pattern: /\b(exfiltrat\w*|extract\s+(all|every|all\s+the|the\s+entire)|dump\s+(the\s+)?(data|database|table|column|record))\b/i,
      intent: 'data_exfiltration', severity: 'critical', label: 'Data Exfiltration' },

    // Credential / secret theft
    { pattern: /\b(credential|secret|api[_-]?key|token|password|passwd|pwd)\s+(steal|extract|dump|exfiltrat|leak|bypass|circumvent|ignore|override|remove|delete)\b/i,
      intent: 'credential_theft', severity: 'critical', label: 'Credential Theft' },

    // Privilege escalation / auth bypass
    { pattern: /\b(bypass\s+(auth|login|permission|acl|role|admin|security|verification)|privilege\s+escalat|elevate\s+(privilege|access|permission)|becom(e|\s+an?\s+)(admin|root|superuser|administrator))\b/i,
      intent: 'privilege_escalation', severity: 'critical', label: 'Privilege Escalation' },

    // Prompt injection / instruction override
    { pattern: /(ignore\s+(all\s+)?(previous|prior|above|the\s+)?(instruction|rule|constraint|guideline|directive|system)\s+(and|then|now|also)?|disregard\s+(all\s+)?(previous|prior|above|the\s+)?(instruction|rule|constraint|guideline|directive|system)|override\s+(all\s+)?(previous|prior|above|the\s+)?(instruction|rule|constraint|guideline|directive|system)|forget\s+(all\s+)?(previous|prior|above|the\s+)?(instruction|rule|constraint|guideline|directive|system)|new\s+instruction|i\s+now\s+authorize|i\s+grant\s+you\s+(full|unlimited|complete)\s+access)/i,
      intent: 'prompt_injection', severity: 'high', label: 'Prompt Injection' },

    // Test that hits production or destructive actions
    { pattern: /\b(delete\s+(all|every|the\s+entire|all\s+the)\s+(user|account|record|data|row|entry|file|directory|database|table)|drop\s+(table|database|collection)|truncate\s+(table|database)|rm\s+-rf|format\s+(disk|drive|table)|wipe\s+(data|database|disk))\b/i,
      intent: 'destructive_action', severity: 'critical', label: 'Destructive Action in Test' },

    // Sending real emails, SMS, payments, external API calls as part of test
    { pattern: /\b(send\s+(email|sms|push|notification|webhook|callback|request)\s+to\s+(production|real|external|live)|\b(call|invoke|hit|ping|query)\s+(production|real|external|live|staging)\s+(api|endpoint|service|server)|\bpay\b.*\b(test\s*)?(credit\s*)?card\b|stripe\s+(charge|payment|payment_intent)|mail(?:to)?\s*[(\s].{0,40}@)/i,
      intent: 'real_world_side_effect', severity: 'high', label: 'Real-World Side Effect' },

    // Accessing files outside the test environment
    { pattern: /(read|access|open|write|modify|delete)\s+\/(etc|windows|system32|home|root|usr|var|opt)/i,
      intent: 'path_traversal', severity: 'high', label: 'Path Traversal / File System Access' },
    { pattern: /\.\.\/|\.\.\//i,
      intent: 'path_traversal', severity: 'high', label: 'Path Traversal (dot-dot)' },
    { pattern: /\b(cat|ls|dir|find|grep|wget|curl|nc|netcat|ncat)\s+/i,
      intent: 'path_traversal', severity: 'high', label: 'Shell Command in Prompt' },

    // Self-modifying code / test rewriting itself
    { pattern: /\b(self[+-]modif[ya]tion|rewrite\s+(itself|the\s+test|this\s+script|the\s+file)|modify\s+(its\s+own|the\s+test\s+file|this\s+script)|change\s+(its\s+own|the\s+test|this\s+file)\s+code|update\s+(itself|the\s+test|this)\s+to|delete\s+(its\s+own|the\s+test|this)\s+file)\b/i,
      intent: 'self_modification', severity: 'high', label: 'Self-Modifying Test' },

    // Attempts to include arbitrary/external code
    { pattern: /(eval\s*\(|Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|new\s+Function\(|import\s*\([^)]*\)|require\s*\(\s*['"`]\.?\/?\.?\/)/i,
      intent: 'arbitrary_code_execution', severity: 'critical', label: 'Arbitrary Code Execution' },

    // MITM / proxy / certificate manipulation (bypass security)
    { pattern: /\b(mitmproxy|proxy\s+(server|configure|set|add)|disable\s+(ssl|certificate|security|verification)|ignore\s+(ssl|certificate|security|certificate\s+error)|allow\s+(insecure|self[+-]signed|untrusted)\s+(connection|ssl|certificate)|bypass\s+(certificate|ssl|security)\s+verification)\b/i,
      intent: 'mitm_proxy', severity: 'high', label: 'MITM / Certificate Manipulation' },

    // xenograft / implant / persistence
    { pattern: /\b(xenograft|implant|persist(?:ence|ent)\s+(mechanism|backdoor|channel|agent|script|code|payload)|backdoor|rootkit|hidden\s+(process|agent|channel|beacon|payload))\b/i,
      intent: 'implant_persistence', severity: 'critical', label: 'Implant / Persistence' },
];

// Rules specific to test generation (Playwright / QA context)
const TEST_GEN_RULES = [
    // Generating tests that target real production auth
    { pattern: /\blogin\s+as\s+(admin|root|superuser|manager|doctor|receptionist)\s+(with|using)\s+(the\s+)?(real|actual|production|staging)\s+(password|credential|account|user)\b/i,
      intent: 'production_auth_in_test', severity: 'high', label: 'Production Credentials in Test' },

    // Extracting data from the app under test (beyond what a test should do)
    { pattern: /\b(scrape|extract|crawl|harvest|collect)\s+(all\s+)?(user|patient|order|record|invoice|payment|customer|card|ssn|personal|pii|phone|address|email)\s+(data|info|list|table|from|of)\b/i,
      intent: 'data_scraping', severity: 'high', label: 'Data Scraping in Test' },

    // Tests that exfiltrate via network to external URLs
    { pattern: /\b(fetch|axios|request|http|https|xmlhttprequest)\s*\(.*(http:\/\/|https:\/\/)*(external|other|foreign|attacker|evil|c2|command\s*&\s*control)/i,
      intent: 'network_exfiltration', severity: 'critical', label: 'Network Exfiltration' },
];

// ---- Inspection Engine ----

function inspectPrompt(prompt, context) {
    if (!ENABLE_INSPECTOR) {
        return { safe: true, intent: 'none', flags: [], severity: 'none', message: 'Inspector disabled' };
    }

    if (!prompt || typeof prompt !== 'string') {
        return { safe: true, intent: 'none', flags: [], severity: 'none', message: 'Empty prompt' };
    }

    var flags = [];
    var highestSeverity = 'none';
    var matchedIntent = 'none';
    var matchedLabel = '';

    // Check length
    if (prompt.length > MAX_PROMPT_LENGTH) {
        flags.push({ type: 'length', severity: 'medium', message: 'Prompt exceeds ' + MAX_PROMPT_LENGTH + ' chars (' + prompt.length + ' chars) — flagged for review' });
        if (severityRank('medium') > severityRank(highestSeverity)) {
            highestSeverity = 'medium';
        }
    }

    // Check for encoded payloads (base64, hex, url-encoded blobs)
    if (/^(?:[A-Za-z0-9+/]{40,}={0,2}|%[0-9A-Fa-f]{2}){20,}/.test(prompt.trim()) || /^0x[0-9a-fA-F]{40,}/.test(prompt.trim())) {
        flags.push({ type: 'encoded_payload', severity: 'high', message: 'Prompt contains large encoded/hex/base64 blob — possible obfuscated payload' });
        if (severityRank('high') > severityRank(highestSeverity)) {
            highestSeverity = 'high';
            matchedIntent = 'encoded_payload';
            matchedLabel = 'Encoded/Obfuscated Payload';
        }
    }

    // Check all risk patterns
    var allPatternList = RISKY_INTENT_PATTERNS.concat(TEST_GEN_RULES);
    for (var i = 0; i < allPatternList.length; i++) {
        var rule = allPatternList[i];
        if (rule.pattern.test(prompt)) {
            flags.push({
                type: rule.intent,
                severity: rule.severity,
                label: rule.label,
                message: rule.message || ('Detected: ' + rule.label)
            });
            if (severityRank(rule.severity) > severityRank(highestSeverity)) {
                highestSeverity = rule.severity;
                matchedIntent = rule.intent;
                matchedLabel = rule.label;
            }
        }
    }

    // Determine safety
    var shouldAlert = false;
    for (var j = 0; j < flags.length; j++) {
        if (ALERT_SEVERITY.has(flags[j].severity)) { shouldAlert = true; break; }
    }
    var isUnsafe = false;
    for (var k = 0; k < flags.length; k++) {
        if (flags[k].severity === 'critical' || flags[k].severity === 'high') { isUnsafe = true; break; }
    }
    var safe = !isUnsafe;

    return {
        safe: safe,
        intent: matchedIntent,
        label: matchedLabel,
        severity: highestSeverity,
        flags: flags,
        shouldAlert: shouldAlert,
        prompt_length: prompt.length,
        timestamp: new Date().toISOString(),
        context: {
            user_agent: context && context.user_agent || null,
            ip: context && context.ip || null,
            api_key_id: context && context.api_key_id || null,
            tenant: context && context.tenant || null,
            target_url: context && context.target_url || null
        }
    };
}

function severityRank(s) {
    var ranks = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return ranks[s] || 0;
}

// ---- Alert Persistence ----

var ALERTS_DB_PATH = path.join(__dirname, 'prompt-alerts.json');

function loadAlerts() {
    try {
        if (fs.existsSync(ALERTS_DB_PATH)) {
            return JSON.parse(fs.readFileSync(ALERTS_DB_PATH, 'utf8'));
        }
    } catch (err) {
        console.error('[PromptSafety] Failed to load alerts DB:', err.message);
    }
    return [];
}

function saveAlerts(alerts) {
    try {
        fs.writeFileSync(ALERTS_DB_PATH, JSON.stringify(alerts, null, 2));
    } catch (err) {
        console.error('[PromptSafety] Failed to save alerts DB:', err.message);
    }
}

function recordAlert(inspection, prompt) {
    if (!inspection.shouldAlert) return null;

    var alerts = loadAlerts();
    var alert = {
        id: 'alert-' + crypto.randomBytes(4).toString('hex'),
        prompt_preview: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
        prompt_hash: crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 16),
        intent: inspection.intent,
        label: inspection.label,
        severity: inspection.severity,
        flags: inspection.flags.map(function (f) { return { type: f.type, severity: f.severity, label: f.label }; }),
        safe: inspection.safe,
        context: inspection.context,
        created_at: inspection.timestamp,
        source: 'api'
    };

    alerts.unshift(alert);

    // Keep only last 1000 alerts
    if (alerts.length > 1000) alerts.length = 1000;

    saveAlerts(alerts);
    console.log('[PromptSafety] ALERT recorded: ' + alert.id + ' — ' + alert.label + ' (' + alert.severity + ')');
    return alert;
}

// ---- Recent Alerts (for dashboard) ----

function getRecentAlerts(limit) {
    if (!limit) limit = 50;
    var alerts = loadAlerts();
    return alerts.slice(0, limit);
}

function getAlertStats() {
    var alerts = loadAlerts();
    var stats = {
        total: alerts.length,
        by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
        by_intent: {},
        recent: alerts.slice(0, 10)
    };

    for (var i = 0; i < alerts.length; i++) {
        var alert = alerts[i];
        if (stats.by_severity[alert.severity]) stats.by_severity[alert.severity]++;
        if (!stats.by_intent[alert.intent]) stats.by_intent[alert.intent] = 0;
        stats.by_intent[alert.intent]++;
    }

    return stats;
}

// ---- Module Export ----

module.exports = {
    inspectPrompt: inspectPrompt,
    recordAlert: recordAlert,
    getRecentAlerts: getRecentAlerts,
    getAlertStats: getAlertStats,
    ALERT_SEVERITY: ALERT_SEVERITY,
    MAX_PROMPT_LENGTH: MAX_PROMPT_LENGTH,
    ENABLE_INSPECTOR: ENABLE_INSPECTOR
};
