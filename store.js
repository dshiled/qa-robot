// ============================================================================
// QA-Robot Persistent Store
// ----------------------------------------------------------------------------
// Replaces the in-memory Maps that previously held API keys, jobs and runners,
// all of which were lost on every restart.
//
// Uses node:sqlite (built into Node 22+, no npm dependency required) so the
// product stays dependency-light and self-hostable with zero external services.
//
// Data is stored in ./data/qa-robot.db and is gitignored.
// ============================================================================

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.QA_ROBOT_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.QA_ROBOT_DB || path.join(DATA_DIR, 'qa-robot.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL gives us concurrent readers alongside a writer, and survives crashes.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    team                  TEXT NOT NULL DEFAULT 'default',
    tier                  TEXT NOT NULL DEFAULT 'free',
    is_active             INTEGER NOT NULL DEFAULT 1,
    stripe_customer_id    TEXT,
    stripe_subscription_id TEXT,
    created_at            TEXT NOT NULL,
    last_used             TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runners (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

function rowToApiKey(row) {
    return {
        id: row.id,
        name: row.name,
        team: row.team,
        tier: row.tier,
        is_active: row.is_active === 1,
        stripe_customer_id: row.stripe_customer_id,
        stripe_subscription_id: row.stripe_subscription_id,
        created_at: row.created_at,
        last_used: row.last_used
    };
}

function insertApiKey(info) {
    db.prepare(`
        INSERT INTO api_keys (id, name, team, tier, is_active, stripe_customer_id,
                              stripe_subscription_id, created_at, last_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        info.id, info.name, info.team, info.tier,
        info.is_active ? 1 : 0,
        info.stripe_customer_id ?? null,
        info.stripe_subscription_id ?? null,
        info.created_at, info.last_used ?? null
    );
    return info;
}

function getApiKey(id) {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    return row ? rowToApiKey(row) : null;
}

function getApiKeyByName(name, team = 'default') {
    const row = db.prepare('SELECT * FROM api_keys WHERE name = ? AND team = ?').get(name, team);
    return row ? rowToApiKey(row) : null;
}

function listApiKeys(team) {
    const rows = team
        ? db.prepare('SELECT * FROM api_keys WHERE team = ? ORDER BY created_at').all(team)
        : db.prepare('SELECT * FROM api_keys ORDER BY created_at').all();
    return rows.map(rowToApiKey);
}

function countApiKeys() {
    const row = db.prepare('SELECT COUNT(*) AS n FROM api_keys').get();
    return row ? row.n : 0;
}

// Only these columns may be written, so callers cannot inject a column name.
const MUTABLE_KEY_COLUMNS = ['name', 'team', 'tier', 'is_active',
                              'stripe_customer_id', 'stripe_subscription_id', 'last_used'];

function updateApiKey(id, fields) {
    const cols = [];
    const values = [];
    for (const [k, v] of Object.entries(fields)) {
        if (!MUTABLE_KEY_COLUMNS.includes(k)) continue;
        cols.push(`${k} = ?`);
        values.push(k === 'is_active' ? (v ? 1 : 0) : v);
    }
    if (cols.length === 0) return getApiKey(id);
    values.push(id);
    db.prepare(`UPDATE api_keys SET ${cols.join(', ')} WHERE id = ?`).run(...values);
    return getApiKey(id);
}

function deleteApiKey(id) {
    const info = getApiKey(id);
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return info;
}

// ---------------------------------------------------------------------------
// Jobs — stored as a JSON blob per row. The job object shape is already defined
// by runner-grid.js and evolves with it, so schemaless storage keeps the two
// modules decoupled.
// ---------------------------------------------------------------------------

function saveJob(job) {
    db.prepare(`
        INSERT INTO jobs (id, data, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data,
                                     updated_at = excluded.updated_at
    `).run(job.id, JSON.stringify(job), job.created_at || new Date().toISOString(),
           job.updated_at || new Date().toISOString());
    return job;
}

function getJob(id) {
    const row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(id);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
}

function parseRows(rows) {
    const out = [];
    for (const row of rows) {
        try { out.push(JSON.parse(row.data)); } catch { /* skip corrupt row */ }
    }
    return out;
}

function listJobs(limit = 50) {
    return parseRows(
        db.prepare('SELECT data FROM jobs ORDER BY updated_at DESC LIMIT ?').all(limit)
    );
}

// Used on boot to rehydrate the in-memory Maps from the last session.
function loadAllJobs() {
    return parseRows(db.prepare('SELECT data FROM jobs').all());
}

function deleteJob(id) {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

function saveRunner(runner) {
    db.prepare(`
        INSERT INTO runners (id, data, last_seen)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data,
                                      last_seen = excluded.last_seen
    `).run(runner.id, JSON.stringify(runner), runner.last_heartbeat || new Date().toISOString());
    return runner;
}

function getRunner(id) {
    const row = db.prepare('SELECT data FROM runners WHERE id = ?').get(id);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
}

function listRunners() {
    return parseRows(db.prepare('SELECT data FROM runners').all());
}

module.exports = {
    DB_PATH,
    // api keys
    insertApiKey, getApiKey, getApiKeyByName, listApiKeys, countApiKeys,
    updateApiKey, deleteApiKey,
    // jobs
    saveJob, getJob, listJobs, loadAllJobs, deleteJob,
    // runners
    saveRunner, getRunner, listRunners,
    close: () => db.close()
};

