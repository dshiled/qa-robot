// QA-Robot Audit Log — Enterprise Event Tracking
// Append-only event log for compliance, security review, and operational visibility.
// Wired into server.js as a module.
// Event types: login, logout, api_key_created, api_key_revoked, test_run_started,
//   test_run_completed, job_dispatched, job_completed, config_changed,
//   billing_upgrade, team_member_added, prompt_submitted, prompt_blocked,
//   mobile_test_uploaded, mobile_test_executed, saml_login, saml_logout

const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(__dirname, 'audit-logs');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit-log.json');
const MAX_AUDIT_RECORDS = 10000; // cap before rotation
const ROTATE_KEEP = 5000;         // keep this many after rotation

// Ensure audit directory exists
if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

// ---- In-Memory Buffer ----

const eventBuffer = [];
let flushTimer = null;

// ---- Helpers ----

function auditTimestamp() {
    return new Date().toISOString();
}

function truncate(str, max) {
    if (!str) return null;
    str = String(str);
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// ---- Core: Log an Event ----

function logEvent(event) {
    event = event || {};
    const record = {
        id: 'evt-' + (event.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
        type: event.type || 'unknown',
        actor: event.actor || null,       // user_id, api_key_id, 'system', 'runner-xyz'
        actor_type: event.actor_type || 'system', // user | api_key | runner | system
        tenant: event.tenant || null,     // team/org id if multi-tenant
        target: event.target || null,     // what was affected (user_id, key_id, job_id, etc.)
        event_type: event.event_type || event.type,
        details: event.details || {},
        metadata: {
            ip: event.ip || null,
            user_agent: event.user_agent || null,
            source: event.source || 'system'
        },
        created_at: event.created_at || auditTimestamp()
    };

    // Sanitize — never log secrets
    if (record.details.api_key) record.details.api_key = record.details.api_key.slice(0, 8) + '***';
    if (record.details.token) record.details.token = '[REDACTED]';
    if (record.details.password) record.details.password = '[REDACTED]';

    eventBuffer.push(record);

    // Flush immediately if buffer is getting large
    if (eventBuffer.length >= 100) {
        flushBuffer();
    }

    // Schedule periodic flush
    if (!flushTimer) {
        flushTimer = setTimeout(flushBuffer, 2000);
    }

    return record;
}

// ---- Flush Buffer to Disk ----

function flushBuffer() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (eventBuffer.length === 0) return;

    const events = eventBuffer.splice(0, eventBuffer.length);
    appendToFile(events);
}

function appendToFile(events) {
    try {
        let existing = [];
        if (fs.existsSync(AUDIT_FILE)) {
            const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
            if (raw.trim()) {
                existing = JSON.parse(raw);
                if (!Array.isArray(existing)) existing = [];
            }
        }

        const combined = existing.concat(events);

        // Rotate if over cap
        if (combined.length > MAX_AUDIT_RECORDS) {
            const kept = combined.slice(combined.length - ROTATE_KEEP);
            fs.writeFileSync(AUDIT_FILE + '.old', JSON.stringify(combined.slice(0, combined.length - ROTATE_KEEP), null, 2));
            fs.writeFileSync(AUDIT_FILE, JSON.stringify(kept, null, 2));
        } else {
            fs.writeFileSync(AUDIT_FILE, JSON.stringify(combined, null, 2));
        }
    } catch (err) {
        console.error('[Audit] Failed to write audit log:', err.message);
    }
}

// ---- Query / Filter Events ----

function getEvents(options) {
    options = options || {};

    if (!fs.existsSync(AUDIT_FILE)) return { events: [], total: 0 };

    let raw;
    try {
        raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    } catch (err) {
        return { events: [], total: 0 };
    }

    let events;
    try {
        events = JSON.parse(raw);
        if (!Array.isArray(events)) events = [];
    } catch (err) {
        return { events: [], total: 0 };
    }

    // Apply filters
    if (options.type) {
        events = events.filter(e => e.type === options.type || e.event_type === options.type);
    }
    if (options.actor) {
        events = events.filter(e => e.actor && e.actor.includes(options.actor));
    }
    if (options.tenant) {
        events = events.filter(e => e.tenant === options.tenant);
    }
    if (options.from) {
        const from = new Date(options.from);
        events = events.filter(e => new Date(e.created_at) >= from);
    }
    if (options.to) {
        const to = new Date(options.to);
        events = events.filter(e => new Date(e.created_at) <= to);
    }
    if (options.limit) {
        events = events.slice(-options.limit);
    }

    // Sort newest first
    events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
        events: events,
        total: events.length,
        filters: options
    };
}

function getEventStats() {
    if (!fs.existsSync(AUDIT_FILE)) {
        return { total: 0, by_type: {}, by_actor_type: {}, by_severity: {}, recent_activity: [] };
    }

    let events;
    try {
        events = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
        if (!Array.isArray(events)) events = [];
    } catch (err) {
        events = [];
    }

    const byType = {};
    const byActorType = {};
    const now = Date.now();
    const oneHour = 3600 * 1000;
    const oneDay = 86400 * 1000;
    const hourCount = 0;
    const dayCount = 0;

    for (const e of events) {
        byType[e.type] = (byType[e.type] || 0) + 1;
        byActorType[e.actor_type] = (byActorType[e.actor_type] || 0) + 1;
    }

    // Recent activity (last 24h count by type)
    const recent = events.filter(e => (now - new Date(e.created_at).getTime()) < oneDay);

    return {
        total: events.length,
        by_type: byType,
        by_actor_type: byActorType,
        recent_24h: recent.length,
        recent: events.slice(0, 20)
    };
}

// ---- Export ----

function exportAudit(options) {
    const result = getEvents(options);
    return {
        exported_at: auditTimestamp(),
        count: result.events.length,
        format: 'json',
        filters: result.filters,
        events: result.events
    };
}

// ---- Event Type Helpers (convenience wrappers) ----

function logLogin(event) {
    return logEvent(Object.assign({
        type: 'login',
        event_type: 'authentication.login'
    }, event));
}

function logLogout(event) {
    return logEvent(Object.assign({
        type: 'logout',
        event_type: 'authentication.logout'
    }, event));
}

function logApiKeyCreated(event) {
    return logEvent(Object.assign({
        type: 'api_key_created',
        event_type: 'security.api_key_created'
    }, event));
}

function logApiKeyRevoked(event) {
    return logEvent(Object.assign({
        type: 'api_key_revoked',
        event_type: 'security.api_key_revoked'
    }, event));
}

function logTestRun(event) {
    return logEvent(Object.assign({
        type: 'test_run',
        event_type: 'test.test_run'
    }, event));
}

function logJobDispatch(event) {
    return logEvent(Object.assign({
        type: 'job_dispatched',
        event_type: 'grid.job_dispatched'
    }, event));
}

function logJobComplete(event) {
    return logEvent(Object.assign({
        type: 'job_completed',
        event_type: 'grid.job_completed'
    }, event));
}

function logBillingUpgrade(event) {
    return logEvent(Object.assign({
        type: 'billing_upgrade',
        event_type: 'billing.upgrade'
    }, event));
}

function logPromptSubmit(event) {
    return logEvent(Object.assign({
        type: 'prompt_submitted',
        event_type: 'ai.prompt_submitted'
    }, event));
}

function logPromptBlocked(event) {
    return logEvent(Object.assign({
        type: 'prompt_blocked',
        event_type: 'ai.prompt_blocked',
        severity: event.severity || 'high'
    }, event));
}

function logMobileUpload(event) {
    return logEvent(Object.assign({
        type: 'mobile_test_uploaded',
        event_type: 'mobile.upload'
    }, event));
}

function logMobileExecute(event) {
    return logEvent(Object.assign({
        type: 'mobile_test_executed',
        event_type: 'mobile.execute'
    }, event));
}

function logSamlLogin(event) {
    return logEvent(Object.assign({
        type: 'saml_login',
        event_type: 'sso.saml_login'
    }, event));
}

function logSamlLogout(event) {
    return logEvent(Object.assign({
        type: 'saml_logout',
        event_type: 'sso.saml_logout'
    }, event));
}

// ---- Module Exports ----

module.exports = {
    logEvent: logEvent,
    logLogin: logLogin,
    logLogout: logLogout,
    logApiKeyCreated: logApiKeyCreated,
    logApiKeyRevoked: logApiKeyRevoked,
    logTestRun: logTestRun,
    logJobDispatch: logJobDispatch,
    logJobComplete: logJobComplete,
    logBillingUpgrade: logBillingUpgrade,
    logPromptSubmit: logPromptSubmit,
    logPromptBlocked: logPromptBlocked,
    logMobileUpload: logMobileUpload,
    logMobileExecute: logMobileExecute,
    logSamlLogin: logSamlLogin,
    logSamlLogout: logSamlLogout,
    getEvents: getEvents,
    getEventStats: getEventStats,
    exportAudit: exportAudit,
    flushBuffer: flushBuffer
};
