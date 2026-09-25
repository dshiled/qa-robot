// Auth + Billing module for QA-Robot
// Pure module — exports functions only, no route definitions
//
// SECURITY: API keys are persisted in SQLite (store.js), not an in-memory Map.
// The previous Map meant every key and subscription vanished on restart.

const crypto = require('crypto');
const store = require('./store.js');

// ---- API Keys ----

function generateApiKey() {
    return 'qa_live_' + crypto.randomBytes(32).toString('hex');
}

// In-process cache so the auth hot path does not hit SQLite on every request.
// The store remains authoritative; this is rebuilt on boot and invalidated on
// every write, so a restart reloads from disk rather than losing data.
const API_KEYS = new Map();

function refreshKeyCache(id) {
    const info = store.getApiKey(id);
    if (info) API_KEYS.set(id, info);
    else API_KEYS.delete(id);
    return info;
}

// Rehydrate the cache from SQLite at boot.
function loadKeys() {
    API_KEYS.clear();
    for (const key of store.listApiKeys()) {
        API_KEYS.set(key.id, key);
    }
    console.log('[Auth] Loaded ' + API_KEYS.size + ' API key(s) from store');
    return API_KEYS.size;
}

function isValidApiKey(key) {
    if (!key || typeof key !== 'string') return false;
    const cached = API_KEYS.get(key);
    if (cached) return cached.is_active === true;
    // Cache miss: check the store in case it was written by another process.
    const info = store.getApiKey(key);
    if (info && info.is_active) {
        API_KEYS.set(key, info);
        return true;
    }
    return false;
}

function getApiKeyInfo(key) {
    if (!key || typeof key !== 'string') return null;
    return API_KEYS.get(key) || store.getApiKey(key) || null;
}

/**
 * Create and persist a key.
 * SECURITY: callers must be authenticated. Key creation is only reachable
 * unauthenticated via ensureBootstrapKey() on a fresh, empty install.
 */
function createApiKey({ name, team, tier = 'free', created_by = 'system' }) {
    const key = generateApiKey();
    const info = {
        id: key,
        name: name || 'Default Key',
        team: team || 'default',
        tier: tier,
        is_active: true,
        created_at: new Date().toISOString(),
        last_used: null
    };
    store.insertApiKey(info);
    API_KEYS.set(key, info);
    return { ...info, created_by };
}

function revokeApiKey(id) {
    const info = store.deleteApiKey(id);
    API_KEYS.delete(id);
    return info;
}

function updateApiKey(id, fields) {
    const info = store.updateApiKey(id, fields);
    refreshKeyCache(id);
    return info;
}

function listApiKeys(team) {
    return store.listApiKeys(team);
}

/**
 * SECURITY BOOTSTRAP — creates the first key on a completely fresh install.
 *
 * This replaces the previously PUBLIC 'POST /api/keys' route, which let anyone
 * mint a working key. The key is only created when the store is empty, and it
 * is written to data/ADMIN_KEY.txt (gitignored) and printed once to the
 * console so the operator can use it. Afterwards key creation requires auth.
 */
function ensureBootstrapKey() {
    if (store.countApiKeys() > 0) return null;

    const { name, team } = require('./bootstrap-config');
    const created = createApiKey({ name, team, tier: 'free', created_by: 'bootstrap' });

    const fs = require('fs');
    const path = require('path');
    const outPath = path.join(__dirname, 'data', 'ADMIN_KEY.txt');
    try {
        fs.writeFileSync(outPath,
            'QA-Robot admin API key (created automatically on first run)\n' +
            'Created: ' + created.created_at + '\n\n' +
            '  ' + created.id + '\n\n' +
            'Use it as:  Authorization: Bearer <key>\n' +
            'This file is gitignored. Delete it once you have stored the key.\n',
            { mode: 0o600 });
    } catch (e) {
        console.warn('[Auth] Could not write ADMIN_KEY.txt:', e.message);
    }

    console.log('\n' + '='.repeat(64));
    console.log('  FIRST RUN — no API keys existed, so an admin key was created');
    console.log('  ' + '='.repeat(64));
    console.log('  ' + created.id);
    console.log('');
    console.log('  Saved to: data/ADMIN_KEY.txt (gitignored)');
    console.log('  Use as:   Authorization: Bearer <key>');
    console.log('  Further keys now require authentication.');
    console.log('='.repeat(64) + '\n');

    return created;
}

// Middleware: require a valid API key.
//
// SECURITY: the key is only accepted from the Authorization header or the
// request body. It is no longer read from the query string, where it would be
// captured in access logs, proxy logs, browser history and Referer headers.
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const apiKey = match ? match[1] : (req.body && req.body.api_key);

    if (!apiKey || !isValidApiKey(apiKey)) {
        return res.status(401).json({ error: 'Unauthorized: valid API key required' });
    }

    req.apiKey = apiKey;
    req.apiKeyInfo = getApiKeyInfo(apiKey);
    next();
}

/**
 * Restrict a route to a specific team/tenant. The key's own team must match.
 * Call after requireAuth: app.post('/x', auth.requireAuth, auth.requireSameTeam, ...)
 */
function requireSameTeam(req, res, next) {
    if (!req.apiKeyInfo) return res.status(401).json({ error: 'Unauthorized' });
    const requested = req.body?.team || req.query?.team;
    if (requested && requested !== req.apiKeyInfo.team) {
        return res.status(403).json({ error: 'Forbidden: cannot act on another team' });
    }
    next();
}

// ---- Stripe ----

let stripe = null;

function initStripe() {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
        console.log('[Billing] STRIPE_SECRET_KEY not set — billing in demo mode');
        return null;
    }
    const Stripe = require('stripe');
    stripe = Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });
    console.log('[Billing] Stripe initialized');
    return stripe;
}

async function createCheckoutSession(apiKeyInfo, successUrl, cancelUrl) {
    if (!stripe) {
        // Demo mode: the local dev path with no Stripe key. It still PERSISTS the
        // tier change now, so the state survives a restart. This is a development
        // affordance only — it grants a paid tier without payment, so it must
        // never be reachable in production. See ALLOW_DEMO_BILLING in server.js.
        updateApiKey(apiKeyInfo.id, {
            tier: 'enterprise',
            stripe_customer_id: 'demo_customer_' + crypto.randomBytes(8).toString('hex'),
            stripe_subscription_id: 'demo_sub_' + crypto.randomBytes(8).toString('hex')
        });
        console.log('[Billing] Demo mode: upgraded ' + apiKeyInfo.id + ' to enterprise');
        return {
            id: 'demo_checkout_' + crypto.randomBytes(8).toString('hex'),
            url: successUrl,
            mock: true
        };
    }

    const priceId = process.env.STRIPE_PRICE_ID || 'price_enterprise_monthly';

    const session = await stripe.checkout.sessions.create({
        customer: apiKeyInfo.stripe_customer_id || undefined,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { api_key: apiKeyInfo.id, team: apiKeyInfo.team || 'default' },
        subscription_data: { metadata: { api_key: apiKeyInfo.id } }
    });

    return session;
}

async function handleStripeWebhook(payload, signature) {
    if (!stripe) {
        console.log('[Billing] Stripe not initialized — ignoring webhook');
        return { received: true };
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
        console.error('[Billing] Webhook signature failed:', err.message);
        return { error: 'Invalid signature' };
    }

    const apiKey = event.data.object.metadata?.api_key;

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            if (apiKey && store.getApiKey(apiKey)) {
                updateApiKey(apiKey, {
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: session.subscription,
                    tier: 'enterprise',
                    is_active: true
                });
                console.log(`[Billing] Upgraded ${apiKey} to enterprise`);
            }
            break;
        }
        case 'customer.subscription.deleted': {
            if (apiKey && store.getApiKey(apiKey)) {
                updateApiKey(apiKey, { is_active: false, tier: 'free' });
                console.log(`[Billing] Subscription cancelled for ${apiKey}`);
            }
            break;
        }
    }

    return { received: true };
}

module.exports = {
    // key management
    generateApiKey,
    createApiKey,
    revokeApiKey,
    updateApiKey,
    listApiKeys,
    loadKeys,
    ensureBootstrapKey,
    isValidApiKey,
    getApiKeyInfo,
    // middleware
    requireAuth,
    requireSameTeam,
    // billing
    initStripe,
    handleStripeWebhook,
    createCheckoutSession,
    API_KEYS   // in-process cache; store.js remains authoritative
};
