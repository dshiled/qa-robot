// Store (SQLite persistence) tests. Run: node scripts/store-test.js
// Uses a throwaway DB so it never touches real data.
process.env.QA_ROBOT_DB = require('path').join(
    require('os').tmpdir(), 'qa-robot-store-test-' + process.pid + '.db');

const store = require('../store.js');

let pass = 0, fail = 0;
function ok(label, cond) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
    cond ? pass++ : fail++;
}

const now = new Date().toISOString();

console.log('\n=== api keys persist ===');
store.insertApiKey({ id: 'qa_live_test1', name: 'Key One', team: 'default',
                     tier: 'free', is_active: true, created_at: now });
ok('insert + get', store.getApiKey('qa_live_test1')?.name === 'Key One');
ok('count is 1', store.countApiKeys() === 1);
ok('list returns it', store.listApiKeys().length === 1);
ok('lookup by name', store.getApiKeyByName('Key One')?.id === 'qa_live_test1');

console.log('\n=== updates ===');
store.updateApiKey('qa_live_test1', { tier: 'enterprise' });
ok('tier updated', store.getApiKey('qa_live_test1').tier === 'enterprise');
store.updateApiKey('qa_live_test1', { is_active: false });
ok('is_active false', store.getApiKey('qa_live_test1').is_active === false);
store.updateApiKey('qa_live_test1', { stripe_customer_id: 'cus_123' });
ok('stripe id saved', store.getApiKey('qa_live_test1').stripe_customer_id === 'cus_123');

console.log('\n=== column injection blocked ===');
// updateApiKey must ignore unknown keys rather than interpolating them into
// the SQL. The known column in the same call is still applied.
store.updateApiKey('qa_live_test1', { is_active: true, 'tier) VALUES (x);--': 'boom' });
const after = store.getApiKey('qa_live_test1');
ok('still resolves', after !== null);
ok('known column applied (is_active true)', after.is_active === true);
ok('tier not corrupted', after.tier === 'enterprise');

console.log('\n=== jobs round-trip ===');
store.saveJob({ id: 'job-deadbeef', spec: 'login.spec.ts', status: 'passed',
                created_at: now, updated_at: now });
ok('job saved', store.getJob('job-deadbeef')?.spec === 'login.spec.ts');
store.saveJob({ id: 'job-deadbeef', spec: 'login.spec.ts', status: 'failed',
                created_at: now, updated_at: now });
ok('job upserts', store.getJob('job-deadbeef')?.status === 'failed');
ok('no duplicate on upsert', store.listJobs().length === 1);
ok('loadAllJobs works', store.loadAllJobs().length === 1);
ok('missing job returns null', store.getJob('job-00000000') === null);

console.log('\n=== runners ===');
store.saveRunner({ id: 'runner-11112222', name: 'R1', status: 'online',
                   last_heartbeat: now });
ok('runner saved', store.getRunner('runner-11112222')?.name === 'R1');
ok('listRunners', store.listRunners().length === 1);

console.log('\n=== teardown ===');
store.deleteApiKey('qa_live_test1');
ok('key deleted', store.getApiKey('qa_live_test1') === null);
store.close();
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.QA_ROBOT_DB + suffix); } catch {}
}

console.log('\n========================================');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
console.log('========================================\n');
process.exit(fail > 0 ? 1 : 0);
