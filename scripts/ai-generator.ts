#!/usr/bin/env bun

/**
 * QA-Robot AI Test Generator — Multi-Model
 *
 * Supports multiple LLM providers with automatic fallback:
 *   1. GEMINI_API_KEY     → Google Gemini (default)
 *   2. ANTHROPIC_API_KEY  → Anthropic Claude
 *   3. OPENAI_API_KEY     → OpenAI GPT-4
 *
 * Quality ranking: GPT-4 > Claude > Gemini (for code generation)
 * Fallback chain: try each until one succeeds
 *
 * Usage:
 *   qa-robot generate "Log in and create an appointment"
 *   GEMINI_API_KEY=xyz qa-robot generate "..."
 *   AI_PROVIDER=claude qa-robot generate "..."
 *   AI_PROVIDER=gpt4 qa-robot generate "..."
 */

const fs = require('fs');
const path = require('path');

// ---- Configuration ----

const DEFAULT_MODEL = 'gemini-2.5-flash';

const MODEL_PRETTY_NAME = {
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-opus-4-20250514': 'Claude Opus 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
};

// Quality ranking (higher = try first when auto-selecting)
const MODEL_QUALITY = {
    'gpt-4o': 100,
    'claude-opus-4-20250514': 95,
    'claude-sonnet-4-20250514': 85,
    'gemini-2.5-pro': 80,
    'gemini-2.5-flash': 60,
    'gpt-4o-mini': 50,
};

// System prompt shared across all providers
const SYSTEM_PROMPT = `You are a strict QA Test Generator.
The user will describe a test scenario.
You must ONLY output valid Playwright TypeScript code based on the prompt.
Do not wrap your output in markdown blocks (```).
Do not output any explanations or conversational text.
Output raw TypeScript code.
The test must import { test, expect } from '@playwright/test';
Always use targetUrl = process.env.TARGET_URL || 'http://localhost:3000';
Write clean, readable tests with descriptive test names and proper assertions.
Use page.waitForSelector or page.getByRole for reliable element selection.
Avoid hardcoded timeouts — use web-first assertions instead.`;

// ---- Provider Abstraction ----

/**
 * @typedef {Object} Provider
 * @property {string} name
 * @property {string} model
 * @property {boolean} available
 * @property {function(string): Promise<string>} generate
 */

// Gemini provider
async function createGeminiProvider() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    return {
        name: 'Gemini',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        available: true,
        async generate(prompt) {
            console.log(`\n🤖 AI: Generating with ${MODEL_PRETTY_NAME[this.model] || this.model} (Gemini)...`);

            const response = await ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: SYSTEM_PROMPT,
                    temperature: 0.1,
                },
            });

            let code = response.text || '';

            // Strip markdown if hallucinated
            if (code.startsWith('```typescript')) code = code.replace('```typescript\n', '');
            if (code.startsWith('```ts')) code = code.replace('```ts\n', '');
            if (code.startsWith('```')) code = code.replace(/^```\w*\n?/, '');
            if (code.endsWith('```')) code = code.slice(0, -3);

            return code.trim();
        },
    };
}

// Claude provider (Anthropic)
async function createClaudeProvider() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

    return {
        name: 'Claude',
        model,
        available: true,
        async generate(prompt) {
            console.log(`\n🤖 AI: Generating with ${MODEL_PRETTY_NAME[model] || model} (Claude)...`);

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4000,
                    system: SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Claude API error ${response.status}: ${errorBody}`);
            }

            const data = await response.json();
            let code = data.content?.[0]?.text || '';

            // Strip markdown
            if (code.startsWith('```typescript') || code.startsWith('```ts') || code.startsWith('```')) {
                code = code.replace(/^```\w*\n?/i, '');
            }
            if (code.endsWith('```')) code = code.slice(0, -3);

            return code.trim();
        },
    };
}

// OpenAI provider (GPT-4)
async function createOpenAIProvider() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    return {
        name: 'OpenAI',
        model,
        available: true,
        async generate(prompt) {
            console.log(`\n🤖 AI: Generating with ${MODEL_PRETTY_NAME[model] || model} (OpenAI)...`);

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.1,
                    max_tokens: 4000,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
            }

            const data = await response.json();
            let code = data.choices?.[0]?.message?.content || '';

            // Strip markdown
            if (code.startsWith('```typescript') || code.startsWith('```ts') || code.startsWith('```')) {
                code = code.replace(/^```\w*\n?/i, '');
            }
            if (code.endsWith('```')) code = code.slice(0, -3);

            return code.trim();
        },
    };
}

// ---- Provider Selection ----

function getPreferredProvider() {
    const forced = process.env.AI_PROVIDER && process.env.AI_PROVIDER.toLowerCase();
    if (forced === 'gemini' || forced === 'google') return 'gemini';
    if (forced === 'claude' || forced === 'anthropic') return 'claude';
    if (forced === 'gpt4' || forced === 'openai' || forced === 'gpt-4') return 'openai';
    return null; // auto-select
}

function selectProviders(providers) {
    const forced = getPreferredProvider();

    if (forced) {
        const match = providers.find(p =>
            (forced === 'gemini' && p.name === 'Gemini') ||
            (forced === 'claude' && p.name === 'Claude') ||
            (forced === 'openai' && p.name === 'OpenAI')
        );
        return match ? [match] : providers;
    }

    // Auto-select: sort by quality (highest first)
    return [...providers].sort((a, b) => {
        const qa = MODEL_QUALITY[a.model] || 0;
        const qb = MODEL_QUALITY[b.model] || 0;
        return qb - qa;
    });
}

// ---- Main Generation Logic ----

async function generateTest(prompt) {
    console.log('🤖 QA-Robot AI Test Generator (Multi-Model)');
    console.log(`   Scenario: "${prompt}"`);
    console.log('');

    // Discover available providers
    const providers = [];
    const errors = [];

    const gemini = await createGeminiProvider();
    if (gemini) providers.push(gemini);
    else errors.push('Gemini: GEMINI_API_KEY not set');

    const claude = await createClaudeProvider();
    if (claude) providers.push(claude);
    else errors.push('Claude: ANTHROPIC_API_KEY not set');

    const openai = await createOpenAIProvider();
    if (openai) providers.push(openai);
    else errors.push('OpenAI: OPENAI_API_KEY not set');

    if (providers.length === 0) {
        console.error('❌ No AI providers available.');
        console.error('   Set at least one of:');
        console.error('     - GEMINI_API_KEY');
        console.error('     - ANTHROPIC_API_KEY');
        console.error('     - OPENAI_API_KEY');
        console.error('');
        console.error('   Or explicitly select one:');
        console.error('     AI_PROVIDER=gemini qa-robot generate "..."');
        console.error('     AI_PROVIDER=claude qa-robot generate "..."');
        console.error('     AI_PROVIDER=gpt4 qa-robot generate "..."');
        process.exit(1);
    }

    if (providers.length > 1) {
        console.log(`📡 Available providers: ${providers.map(p => `${p.name} (${MODEL_PRETTY_NAME[p.model] || p.model})`).join(', ')}`);
        console.log(`   Auto-selected: ${providers[0].name} (${MODEL_PRETTY_NAME[providers[0].model] || providers[0].model}) — highest quality\n`);
    }

    // Try each provider in order until one succeeds
    const ordered = selectProviders(providers);

    for (let i = 0; i < ordered.length; i++) {
        const provider = ordered[i];
        try {
            const code = await provider.generate(prompt);

            if (!code || code.length < 50) {
                console.warn(`⚠️  ${provider.name} returned empty/short code — trying next provider...`);
                continue;
            }

            // Validate it looks like Playwright code
            if (!code.includes("import { test") && !code.includes("from '@playwright/test'")) {
                console.warn(`⚠️  ${provider.name} did not generate Playwright imports — trying next provider...`);
                continue;
            }

            // Save the generated test
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `ai-generated-${timestamp}.spec.ts`;
            const testPath = path.join(__dirname, '..', 'tests', filename);

            fs.mkdirSync(path.join(__dirname, '..', 'tests'), { recursive: true });
            fs.writeFileSync(testPath, code);

            console.log(`\n✅ Test generated successfully with ${provider.name} (${MODEL_PRETTY_NAME[provider.model] || provider.model})`);
            console.log(`📁 Saved to: tests/${filename}`);
            console.log('');
            console.log('   Next steps:');
            console.log('     1. Review the generated test in tests/' + filename);
            console.log('     2. Run it: qa-robot run');
            console.log('     3. Add more API keys for fallback providers:');
            console.log('        export ANTHROPIC_API_KEY="sk-..."');
            console.log('        export OPENAI_API_KEY="sk-..."');

            return;
        } catch (error) {
            console.error(`❌ ${provider.name} failed: ${error.message}`);

            if (i < ordered.length - 1) {
                console.log(`   Falling back to ${ordered[i + 1].name}...\n`);
            } else {
                console.error('\n❌ All providers failed. Cannot generate test.');
                process.exit(1);
            }
        }
    }
}

// Support direct execution
if (require.main === module) {
    const prompt = process.argv[2];
    if (!prompt) {
        console.error('Usage: bun run scripts/ai-generator.ts <prompt>');
        console.error('');
        console.error('Examples:');
        console.error('  qa-robot generate "Go to the hospital OS and book an appointment"');
        console.error('  AI_PROVIDER=claude qa-robot generate "Test the checkout flow"');
        console.error('');
        console.error('Environment variables:');
        console.error('  GEMINI_API_KEY     - Google Gemini (default)');
        console.error('  ANTHROPIC_API_KEY  - Anthropic Claude');
        console.error('  OPENAI_API_KEY     - OpenAI GPT-4');
        console.error('  AI_PROVIDER        - Force a specific provider: gemini | claude | gpt4');
        process.exit(1);
    }
    generateTest(prompt);
}
