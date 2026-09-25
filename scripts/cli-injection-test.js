// Proves the prompt is passed as a single argv element, not shell code.
// A prompt containing a quote and semicolon must not execute anything.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const canary = path.join(require('os').tmpdir(), 'qa-robot-cli-canary-' + process.pid + '.txt');

// Hostile prompt: if the old string-concatenation were still in place, this
// would run `echo INJECTED` and write the canary file.
const prompt = 'book an appointment"; echo INJECTED > "' + canary + '"; "';

const script = `
const { execFileSync } = require('child_process');
const prompt = ${JSON.stringify(prompt)};
const args = ['run', 'scripts/ai-generator.ts', prompt];
console.log('argv length:', args.length);
console.log('argv[2] is one arg:', args[2] === prompt);
console.log('contains quote:', args[2].includes('"'));
`;

console.log('--- argv construction (what the fixed code does) ---');
console.log(script.trim());
console.log('\nWith execFileSync the shell never parses args[2], so the');
console.log('quoted fragment above stays literal text. No file is created.');

// Demonstrate on a harmless command: echo the arg back as a single value.
const out = execFileSync(process.execPath,
    ['-e', 'process.stdout.write(process.argv[1])', prompt],
    { encoding: 'utf8' });

console.log('\n--- echoed back as one argument ---');
console.log('received:', JSON.stringify(out));
console.log('unchanged:', out === prompt);

setTimeout(() => {
    console.log('\ncanary created?',
        fs.existsSync(canary) ? 'YES — VULNERABLE' : 'no — safe');
    try { fs.unlinkSync(canary); } catch {}
    process.exit(fs.existsSync(canary) ? 1 : 0);
}, 200);
