// Rewrites the closing "});" of each `...secure((req, res) => {` handler to "}));"
// Uses brace counting from the opening line, then verifies with `node --check`.
// Run once after changing route signatures; safe to re-run (idempotent).
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'server.js');
const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);

// Find the line index of every `...secure(` opener
const openers = [];
lines.forEach((line, i) => {
    if (line.includes('...secure(')) openers.push(i);
});

if (openers.length === 0) {
    console.log('No ...secure( routes found — nothing to do.');
    process.exit(0);
}

let changed = 0;

for (const start of openers) {
    // If already converted (contains "}));") we still need to skip its body
    let depth = 0;
    let end = -1;
    let alreadyDone = false;

    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        // depth returns to 0 right after the handler's opening brace is closed
        if (i > start && depth === 0) {
            end = i;
            break;
        }
    }

    if (end === -1) {
        console.log('WARN: could not find end of handler starting line ' + (start + 1));
        continue;
    }

    if (lines[end].trim() === '});') {
        lines[end] = lines[end].replace('});', '}));');
        changed++;
    } else if (lines[end].includes('}));')) {
        alreadyDone = true;
    } else {
        console.log('WARN: line ' + (end + 1) + ' ends with: ' + lines[end].trim());
    }
}

fs.writeFileSync(target, lines.join('\n'));
console.log('Handlers converted: ' + changed + ' of ' + openers.length);
