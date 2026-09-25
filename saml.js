// QA-Robot SAML Single Sign-On Middleware
// Generic, IdP-agnostic SAML 2.0 SP implementation.
// Supports: Okta, Azure AD, Google Workspace, Auth0, OneLogin, Keycloak, etc.
// Config via .env: SAML_ENTRY_POINT, SAML_ISSUER, SAML_CERT, SAML_IDP_SSO_URL,
//   SAML_IDP_SLO_URL, SAML_SP_ENTITY_ID, SAML_NAME_ID_FORMAT
//
// UX decision: SAML is an add-on route (/saml/*) alongside the existing
// email+password auth. Users can log in via SAML OR local auth — same session
// store, same API keys. Team admin configures which IdPs are allowed.
//
// This module does NOT pick a SAML library for you — Node SAML libs have
// varying maintenance status. The SP metadata + ACS + SLO endpoints are
// implemented here as raw Express routes; you wire in your XML signature
// validation library of choice (e.g. @node-saml/passport-saml, xml-crypto)
// by replacing the validateSamlResponse() stub.
//
// What's built:
//   - generateSPMetadata(): SP metadata XML (entity ID, ACS URL, certificates)
//   - buildAuthRequest(): SAML AuthnRequest XML builder
//   - samlLogin(req, res): redirect to IdP
//   - samlCallback(req, res): POST assertion handler
//   - samlLogout(req, res): SLO redirect
//   - attachRoutes(app): mounts /saml/* endpoints
//   - getSamlConfig(): reads config from auth-billing.js user record or env

const crypto = require('crypto');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// SAML config comes from either:
//   1. Per-team config stored in auth-billing.js (recommended for multi-tenant)
//   2. Fallback env vars (single-tenant / dev)
//
// Env var names (used when no team config present):
const SAML_ENV = {
  entryPoint:        process.env.SAML_ENTRY_POINT,        // IdP SSO URL
  issuer:            process.env.SAML_ISSUER,              // SP entity ID / issuer
  cert:              process.env.SAML_CERT,                // IdP signing cert (PEM)
  idpSsoUrl:         process.env.SAML_IDP_SSO_URL,         // alias for entryPoint
  idpSloUrl:         process.env.SAML_IDP_SLO_URL,         // IdP SLO URL
  spEntityId:        process.env.SAML_SP_ENTITY_ID,        // SP entity ID (defaults to BASE_URL)
  nameIdFormat:      process.env.SAML_NAME_ID_FORMAT || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  acsUrl:            process.env.SAML_ACS_URL,             // Assertion Consumer Service URL
  sloUrl:            process.env.SAML_SLO_URL,             // Single Logout Service URL
  signatureAlgorithm: process.env.SAML_SIGNATURE_ALG || 'rsa-sha256',
  digestAlgorithm:   process.env.SAML_DIGEST_ALG || 'sha256'
};

function getSamlConfig(tenant) {
  // TODO: when team config is stored in auth-billing.js, read it here:
  //   const team = teams.get(tenant);
  //   if (team?.saml?.enabled) return team.saml;
  // For now, fall back to env vars.
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const config = {
    entryPoint:       SAML_ENV.entryPoint        || SAML_ENV.idpSsoUrl,
    issuer:           SAML_ENV.issuer            || `${baseUrl}/saml/metadata`,
    cert:             SAML_ENV.cert,
    idpSsoUrl:        SAML_ENV.idpSsoUrl        || SAML_ENV.entryPoint,
    idpSloUrl:        SAML_ENV.idpSloUrl,
    spEntityId:       SAML_ENV.spEntityId        || `${baseUrl}/saml/metadata`,
    nameIdFormat:     SAML_ENV.nameIdFormat,
    acsUrl:           SAML_ENV.acsUrl            || `${baseUrl}/saml/callback`,
    sloUrl:           SAML_ENV.sloUrl            || `${baseUrl}/saml/logout`,
    signatureAlgorithm: SAML_ENV.signatureAlgorithm,
    digestAlgorithm:   SAML_ENV.digestAlgorithm
  };

  // Validate required fields
  const missing = [];
  if (!config.entryPoint)  missing.push('SAML_ENTRY_POINT / SAML_IDP_SSO_URL');
  if (!config.issuer)      missing.push('SAML_ISSUER');
  if (!config.cert)        missing.push('SAML_CERT');
  if (missing.length) {
    console.warn(`[SAML] Missing config: ${missing.join(', ')}. SAML auth disabled for tenant ${tenant}.`);
    return null;
  }
  return config;
}

// ---------------------------------------------------------------------------
// SP Metadata XML Generator
// ---------------------------------------------------------------------------

function generateSPMetadata(config) {
  // Generates SAML SP metadata XML for registration with the IdP.
  // This is what you give the IdP admin so they can configure the app.
  const now = new Date().toISOString();
  const certFingerprint = config.cert
    ? crypto.createHash('sha1').update(crypto.createPublicKey(config.cert).export({ type: 'spki', format: 'der' })).digest('hex').toUpperCase().match(/.{2}/g).join(':')
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="${config.spEntityId}"
                     validUntil="${new Date(Date.now() + 86400000 * 365).toISOString()}">
  <md:SPSSODescriptor
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"
    WantAuthnRequestsSigned="false"
    WantAssertionsSigned="true">

    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${config.acsUrl}"
      index="1" />

    <md:SingleLogoutService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="${config.sloUrl}" />

    ${certFingerprint ? `
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${config.cert}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>` : ''}

  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

// ---------------------------------------------------------------------------
// AuthnRequest Builder
// ---------------------------------------------------------------------------

function buildAuthRequest(config, relayState) {
  // Builds a SAML AuthnRequest (authn request) XML for redirect to IdP.
  // Uses HTTP-Redirect binding (GET) by default; POST binding is an option.
  const id = 'AR-' + crypto.randomBytes(16).toString('hex');
  const issueInstant = new Date().toISOString();
  const destination = config.entryPoint;
  const acsUrl = config.acsUrl;
  const issuer = config.issuer;
  const nameIdPolicy = config.nameIdFormat;

  // NOTE: Full XML signature on AuthnRequest is optional and IdP-dependent.
  // Most IdPs accept unsigned AuthnRequests. If your IdP requires signed
  // requests, add an XML signature here using xml-crypto or similar.
  const authnRequest = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${id}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  Destination="${destination}"
  AssertionConsumerServiceURL="${acsUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
  ProviderName="QA-Robot">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:NameIDPolicy
    Format="${nameIdPolicy}"
    AllowCreate="true" />
</samlp:AuthnRequest>`;

  // HTTP-Redirect binding: base64-encode the request, URL-encode, append as SAMLRequest param
  const encoded = Buffer.from(authnRequest).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const params = new URLSearchParams();
  params.set('SAMLRequest', encoded);
  if (relayState) params.set('RelayState', relayState);

  const redirectUrl = `${destination}?${params.toString()}`;
  return { redirectUrl, requestId: id, relayState };
}

// ---------------------------------------------------------------------------
// Validation Stub — replace with real XML signature verification
// ---------------------------------------------------------------------------

/**
 * validateSamlResponse(rawXml)
 *
 * Given the raw SAML assertion XML POSTed to /saml/callback, validate it:
 *   1. Check NotBefore / NotOnOrAfter timestamps
 *   2. Verify the Assertion XML signature using config.cert (IdP public key)
 *   3. Confirm Issuer matches config.issuer
 *   4. Confirm Destination matches config.acsUrl
 *   5. Extract: NameID (email), attributes (groups, roles, etc.)
 *
 * RETURN: { valid: true, email, attributes }  OR  { valid: false, error }
 *
 * THIS STUB does NOT verify signatures. It parses the XML and extracts the
 * NameID + attributes. Replace with real validation before production use.
 * Recommended: xml-crypto (npm install xml-crypto) for XML signature verification.
 */
function validateSamlResponse(rawXml) {
  // ---- PLACEHOLDER: replace with real XML signature validation ----
  //
  // Real implementation outline:
  //
  // const { XMLValidator } = require('xml-crypto');
  // const cert = config.cert; // IdP public cert in PEM
  //
  // // 1. Validate signature
  // const signature = await signedXml.checkSignature(rawXml, cert);
  // if (!signature) return { valid: false, error: 'Invalid SAML signature' };
  //
  // // 2. Validate timestamps
  // const assertion = parseXml(rawXml);
  // const notBefore = assertion.find('//*[local-name(.)="NotBefore"]')?.text();
  // const notOnOrAfter = assertion.find('//*[local-name(.)="NotOnOrAfter"]')?.text();
  // if (new Date(notOnOrAfter) < new Date()) return { valid: false, error: 'Assertion expired' };
  // if (new Date(notBefore) > new Date()) return { valid: false, error: 'Assertion not yet valid' };
  //
  // // 3. Validate issuer
  // const issuerEl = assertion.find('//*[local-name(.)="Issuer"]');
  // if (issuerEl.text() !== config.issuer) return { valid: false, error: 'Issuer mismatch' };
  //
  // // 4. Validate destination
  // const destinationEl = assertion.find('//*[local-name(.)="Destination"]');
  // if (destinationEl.text() !== config.acsUrl) return { valid: false, error: 'Destination mismatch' };

  // ---- Stub: parse XML and extract NameID + attributes ----
  try {
    // Minimal XML parsing without a library — use a proper XML parser in prod
    const nameIdMatch = rawXml.match(/<NameID[^>]*>([^<]+)<\/NameID>/i) ||
                        rawXml.match(/<NameID[^>]*Value="([^"]+)"/i);
    const email = nameIdMatch ? nameIdMatch[1] : null;

    // Extract attributes (e.g.groups, role, department)
    const attributes = {};
    const attrMatches = rawXml.matchAll(/<Attribute Name="([^"]+)"[^>]*>.*?<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/gis);
    for (const m of attrMatches) {
      attributes[m[1]] = m[2];
    }

    if (!email) {
      return { valid: false, error: 'No NameID/email found in SAML assertion' };
    }

    return {
      valid: true,
      email,
      nameId: email,
      attributes,
      rawXml  // keep for audit/debug
    };
  } catch (err) {
    return { valid: false, error: `XML parse error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Express Routes
// ---------------------------------------------------------------------------

function attachRoutes(app, auth) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  // GET /saml/metadata — SP metadata XML (for IdP registration)
  app.get('/saml/metadata', (req, res) => {
    const config = getSamlConfig(req.query.tenant || 'default');
    if (!config) {
      return res.status(503).send(`SAML not configured.

Required env vars:
  SAML_ENTRY_POINT  (IdP SSO URL)
  SAML_ISSUER       (SP entity ID)
  SAML_CERT         (IdP signing certificate, PEM)

See .env.example for full list.`);
    }
    res.set({
      'Content-Type': 'application/xml',
      'Cache-Control': 'no-cache'
    });
    res.send(generateSPMetadata(config));
  });

  // GET /saml/login — initiate SSO: redirect to IdP
  app.get('/saml/login', (req, res) => {
    const tenant = req.query.tenant || 'default';
    const config = getSamlConfig(tenant);
    if (!config) {
      return res.status(503).send('SAML not configured for this tenant.');
    }

    const relayState = req.query.r || req.body?.RelayState || '';
    const { redirectUrl, requestId } = buildAuthRequest(config, relayState);

    // Store request ID in session for callback validation
    if (req.session) {
      req.session.saml_request_id = requestId;
      req.session.saml_tenant = tenant;
    }

    console.log(`[SAML] AuthnRequest ${requestId} → ${config.entryPoint} (tenant: ${tenant})`);
    res.redirect(redirectUrl);
  });

  // POST /saml/callback — IdP sends assertion here
  app.post('/saml/callback', (req, res) => {
    const tenant = req.session?.saml_tenant || 'default';
    const config = getSamlConfig(tenant);
    if (!config) {
      return res.status(500).send('SAML not configured. Cannot process callback.');
    }

    const { SAMLResponse } = req.body || {};
    if (!SAMLResponse) {
      return res.status(400).send('Missing SAMLResponse');
    }

    // Decode the base64-encoded SAMLResponse
    let rawXml;
    try {
      const decoded = Buffer.from(SAMLResponse, 'base64').toString('utf8');
      rawXml = decodeURIComponent(decoded);
    } catch (err) {
      console.error(`[SAML] Failed to decode SAMLResponse: ${err.message}`);
      return res.status(400).send('Invalid SAMLResponse encoding');
    }

    // Validate the assertion
    const result = validateSamlResponse(rawXml);
    if (!result.valid) {
      console.error(`[SAML] Validation failed: ${result.error}`);
      return res.status(403).send(`SAML validation failed: ${result.error}`);
    }

    // Find or create user by email
    let user = auth.getUserByEmail(result.email);
    if (!user) {
      // Auto-provision: create user from SAML assertion
      user = auth.createUser({
        email: result.email,
        name: result.attributes.displayName || result.email.split('@')[0],
        tenant: tenant,
        auth_method: 'saml',
        saml_assertion: result.rawXml.slice(0, 500) // store partial for audit
      });
      console.log(`[SAML] Auto-provisioned new user: ${result.email} (tenant: ${tenant})`);
    } else {
      // Update auth method to SAML if it was local before
      if (user.auth_method === 'local') {
        user.auth_method = 'saml';
        console.log(`[SAML] User ${result.email} switched to SAML auth`);
      }
    }

    // Store SAML attributes for role mapping
    if (result.attributes) {
      user.saml_attributes = result.attributes;
    }

    // Map SAML groups → roles (configurable)
    const groups = result.attributes.groups ? result.attributes.groups.split(',') : [];
    const roleMap = {
      'qa-robot-admin': 'admin',
      'qa-robot-owner': 'owner',
      'qa-robot-member': 'member'
    };
    for (const group of groups) {
      const role = roleMap[group.trim()];
      if (role) {
        user.role = role;
        console.log(`[SAML] Mapped group "${group}" → role "${role}" for ${result.email}`);
        break;
      }
    }

    // Log the SAML login event
    auth.logAuthEvent({
      event: 'saml_login',
      email: result.email,
      tenant: tenant,
      provider: 'saml',
      details: {
        name_id: result.nameId,
        attributes: result.attributes,
        groups: groups
      },
      ip: req.ip || req.connection.remoteAddress,
      user_agent: req.headers['user-agent']
    });

    // Create session
    if (req.session) {
      req.session.user_id = user.id;
      req.session.email = user.email;
      req.session.role = user.role;
      req.session.api_key_id = user.api_key_id;
      req.session.tenant = tenant;
      req.session.auth_method = 'saml';
      req.session.save();
    }

    // Redirect to dashboard or RelayState
    const redirectTo = req.query.RelayState || req.body?.RelayState || `${baseUrl}/dashboard`;
    console.log(`[SAML] Login success: ${result.email} → ${redirectTo}`);
    res.redirect(redirectTo);
  });

  // GET /saml/logout — initiate SLO
  app.get('/saml/logout', (req, res) => {
    const tenant = req.session?.tenant || 'default';
    const config = getSamlConfig(tenant);
    if (!config || !config.idpSloUrl) {
      // Fall back to local logout
      req.session.destroy(() => {
        res.redirect(`${baseUrl}/`);
      });
      return;
    }

    const sessionIndex = req.session?.saml_session_index;
    const nameId = req.session?.email;

    // Build SLO redirect URL
    const params = new URLSearchParams();
    params.set('SAMLRequest', Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<samlp:LogoutRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="LR-${crypto.randomBytes(16).toString('hex')}"
  Version="2.0">
  <saml:Issuer>${config.issuer}</saml:Issuer>
  ${nameId ? `<saml:NameID>${nameId}</saml:NameID>` : ''}
  ${sessionIndex ? `<samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>` : ''}
</samlp:LogoutRequest>`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));

    console.log(`[SAML] SLO initiated for ${nameId || 'anonymous'}`);
    res.redirect(`${config.idpSloUrl}?${params.toString()}`);
  });

  // POST /saml/logout (optional: some IdPs POST logout responses)
  app.post('/saml/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect(`${baseUrl}/`);
    });
  });

  console.log('[SAML] Routes mounted: /saml/metadata, /saml/login, /saml/callback, /saml/logout');
}

// ---------------------------------------------------------------------------
// Health check — is SAML configured and usable?
// ---------------------------------------------------------------------------

function isSamlConfigured(tenant = 'default') {
  const config = getSamlConfig(tenant);
  return config !== null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  attachRoutes,
  getSamlConfig,
  generateSPMetadata,
  buildAuthRequest,
  validateSamlResponse,  // STUB — replace with real validation
  isSamlConfigured,
  SAML_ENV
};
