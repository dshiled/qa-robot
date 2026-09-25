// Bootstrap defaults for the first-run admin key.
//
// Kept in its own file so auth-billing.js does not hardcode identity strings.
// Override per-deployment with QA_ROBOT_ADMIN_KEY_NAME / QA_ROBOT_ADMIN_TEAM.

const name = process.env.QA_ROBOT_ADMIN_KEY_NAME || 'Admin Key';
const team = process.env.QA_ROBOT_ADMIN_TEAM || 'default';

module.exports = { name, team };
