// Auth + Billing module for QA-Robot
// Pure module — exports functions only, no route definitions

const crypto = require('crypto');

// ---- API Keys ----

const API_KEYS = new Map();

function generateApiKey() {
    return 'qa_live_' + crypto.randomBytes(16).toString('hex');
}

function isValidApiKey(key) {
    if (!key || typeof key !== 'string') return false;
    return API_KEYS.has(key) && API_KEYS.get(key).is_active;
}

function getApiKeyInfo(key) {
    return API_KEYS.get(key) || null;
}

// Middleware: require valid API key
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const apiKey = match ? match[1] : (req.query.api_key || req.body?.api_key);

    if (!apiKey || !isValidApiKey(apiKey)) {
        return res.status(401).json({ error: 'Unauthorized: valid API key required' });
    }

    req.apiKey = apiKey;
    req.apiKeyInfo = getApiKeyInfo(apiKey);
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
        // Demo mode: simulate upgrade directly so the full flow works without Stripe
        apiKeyInfo.tier = 'enterprise';
        apiKeyInfo.stripe_customer_id = 'demo_customer_' + crypto.randomBytes(8).toString('hex');
        apiKeyInfo.stripe_subscription_id = 'demo_sub_' + crypto.randomBytes(8).toString('hex');
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
            if (apiKey && API_KEYS.has(apiKey)) {
                const info = API_KEYS.get(apiKey);
                info.stripe_customer_id = session.customer;
                info.stripe_subscription_id = session.subscription;
                info.tier = 'enterprise';
                info.is_active = true;
                console.log(`[Billing] Upgraded ${apiKey} to enterprise`);
            }
            break;
        }
        case 'customer.subscription.deleted': {
            if (apiKey && API_KEYS.has(apiKey)) {
                const info = API_KEYS.get(apiKey);
                info.is_active = false;
                info.tier = 'free';
                console.log(`[Billing] Subscription cancelled for ${apiKey}`);
            }
            break;
        }
    }

    return { received: true };
}

module.exports = {
    generateApiKey,
    isValidApiKey,
    getApiKeyInfo,
    requireAuth,
    initStripe,
    handleStripeWebhook,
    createCheckoutSession,
    API_KEYS
};
