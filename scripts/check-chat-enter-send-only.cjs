// Execute the real keyboard, draft and publish callbacks with synthetic storage/model sinks.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = ts.createSourceFile('chat-room.tsx', fs.readFileSync(path.join(root, 'components/chat/chat-room.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['sendDraft', 'handleSubmit', 'commitSendText'].includes(node.name.text) && !callbacks[node.name.text]) {
        callbacks[node.name.text] = node.initializer.getText(source);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onKeyDown' && node.initializer?.expression?.getText(source).includes('mentions.keyDown')) {
        callbacks.keyDown = node.initializer.expression.getText(source);
    }
    ts.forEachChild(node, visit);
}
visit(source);
assert.deepEqual(Object.keys(callbacks).sort(), ['commitSendText', 'handleSubmit', 'keyDown', 'sendDraft']);
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const keyboard = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'lib/chat-input-keyboard.ts'), 'utf8')), keyboard);
function fixture(overrides = {}) {
    const calls = { ai: 0, stops: 0, prevent: 0, director: [], pending: null, messages: [] };
    const context = {
        ...keyboard.exports, inputText: 'message', enterToSendEnabled: true,
        inputLocked: false, isGenerating: false, isGroup: false, isSpectator: false,
        mentions: { keyDown: () => false }, setSuggestClosed: () => {},
        resetTextareaHeight: () => {}, onClosePanels: () => {},
        setInputText: text => { context.inputText = text; },
        onStopGeneration: () => calls.stops++,
        onTriggerAIResponse: () => calls.ai++, triggerAIResponse: () => calls.ai++,
        onSendDirectorNote: text => { calls.director.push(text); return true; },
        session: { id: 'fixture', isGroup: false }, isQuoting: false,
        canUseFireworks: () => false, canUseEcho: () => false, canUseLove: () => false,
        isDiceOnlyMessage: () => false, quotePhoto: undefined, quoteData: undefined,
        listeningContext: null, sentAt: '2026-10-06T00:00:00.000Z',
        loadChatSessions: () => [], resolveGroupMentions: () => ({}), groupCharMap: new Map(),
        isKeyboardAutoSendEnabled: () => false,
        pushChatMessage: message => message,
        setMessages: update => { calls.messages = update(calls.messages); },
        hasEcho: () => false, hasLove: () => false, hasFireworks: () => false,
        setPendingGenerate: pending => { calls.pending = pending; },
        ...overrides,
    };
    context.onSendText = (text, options) => { context.options = options; context.commitSendText(text); return true; };
    vm.createContext(context);
    vm.runInContext(compile(Object.entries(callbacks).map(([name, body]) => `var ${name} = ${body};`).join('\n')), context);
    return { context, calls, press: event => context.keyDown({ key: 'Enter', preventDefault: () => calls.prevent++, ...event }) };
}
for (const event of [{}, { ctrlKey: true }, { metaKey: true }]) {
    for (const group of [false, true]) {
        const f = fixture({ isGroup: group, session: { id: 'fixture', isGroup: group } });
        f.press(event);
        assert.equal(f.calls.messages.length, 1);
        assert.equal(f.calls.messages[0].content, 'message');
        assert.equal(f.context.inputText, '');
        assert.equal(f.calls.ai, 0, 'Enter must not request a model reply');
        assert.equal(f.calls.pending, true, 'Published bubbles are eligible for opt-in idle reply');
    }
}
for (const override of [{ inputLocked: true }, { isGenerating: true }, { inputText: '' }, { inputText: '   ' }]) {
    const f = fixture(override); f.press();
    assert.equal(f.calls.messages.length, 0); assert.equal(f.calls.ai, 0); assert.equal(f.calls.stops, 0);
}
for (const event of [{ shiftKey: true }, { altKey: true }, { nativeEvent: { isComposing: true } }]) {
    const f = fixture(); f.press(event); assert.equal(f.calls.messages.length, 0); assert.equal(f.calls.prevent, 0);
}
const disabled = fixture({ enterToSendEnabled: false }); disabled.press(); assert.equal(disabled.calls.prevent, 0);
const mention = fixture({ mentions: { keyDown: () => true } }); mention.press(); assert.equal(mention.calls.messages.length, 0);
const button = fixture(); button.context.handleSubmit(); assert.equal(button.calls.ai, 1); assert.equal(button.calls.messages.length, 1);
const emptyButton = fixture({ inputText: '' }); emptyButton.context.handleSubmit(); assert.equal(emptyButton.calls.ai, 1);
const stop = fixture({ isGenerating: true }); stop.context.handleSubmit(); assert.equal(stop.calls.stops, 1);
const director = fixture({ isGroup: true, isSpectator: true, inputLocked: true }); director.press(); assert.deepEqual(director.calls.director, ['message']);
const idleButton = fixture({ isKeyboardAutoSendEnabled: () => true }); idleButton.context.handleSubmit();
assert.equal(idleButton.calls.ai, 1); assert.equal(idleButton.calls.pending, true);
console.log('PASS: Enter sends without immediate reply; opt-in idle reply can follow. Explicit send-and-reply is immediate even when enabled; manual empty reply/stop, modifiers/IME/mentions and director behavior preserved. No real storage/model calls.');

if (process.env.CHAT_ENTER_REAL_UI === '1') {
    (async () => {
        const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
        const browser = process.env.CHAT_TEST_ENGINE === 'webkit'
            ? await webkit.launch({ headless: true })
            : await chromium.launch({ headless: true, executablePath: process.env.CHAT_TEST_BROWSER });
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            const errors = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } });
                requests.push(url.pathname); return route.abort();
            });
            // Dedicated browser profile and synthetic data; never the user's profile.
            await page.addInitScript(() => {
                if (localStorage.getItem('enter_fixture_ready')) return;
                localStorage.setItem('enter_fixture_ready', '1');
                localStorage.setItem('float_identity_runtime_v1', JSON.stringify({ version: 1, activeUserId: 'keyboard-fixture', legacyOwnerId: 'keyboard-fixture', userIds: ['keyboard-fixture'], deletingUserIds: [], revision: 0 }));
                localStorage.setItem('ai_phone_chat_settings_v1', JSON.stringify({ enterToSendEnabled: true }));
                localStorage.setItem('float_keyboard_auto_send_v1', JSON.stringify({ sessionEnabled: {}, sessionDebounceMs: {} }));
            });
            await page.goto('http://127.0.0.1:3003/dev/imessage26', { waitUntil: 'domcontentloaded', timeout: 120000 });
            const input = page.locator('.chat-input-textarea');
            await input.waitFor({ timeout: 120000 });
            assert.equal(await input.getAttribute('enterkeyhint'), 'send');
            const rows = page.locator('.chat-msg-wrapper[data-role="user"]');
            const count = await rows.count();
            await input.fill('keyboard send-only fixture'); await input.press('Enter');
            await page.waitForFunction(() => document.querySelector('.chat-input-textarea')?.value === '');
            assert.equal(await rows.count(), count + 1);
            const requestsBeforeBlur = requests.length;
            await input.blur();
            // With idle reply off, sending and blurring must not request a reply.
            await page.waitForTimeout(500);
            assert.equal(requests.length, requestsBeforeBlur);
            assert.equal(await page.locator('.chat-send-btn[data-generating]').count(), 0);
            await input.fill('line one'); await input.press('Shift+Enter'); await input.press('x');
            assert.equal(await input.inputValue(), 'line one\nx');
            await input.press('Control+Enter');
            await page.waitForFunction(() => document.querySelector('.chat-input-textarea')?.value === '');
            assert.equal(await rows.count(), count + 2);
            const emptyCount = await rows.count(); await input.press('Enter');
            assert.equal(await rows.count(), emptyCount);
            assert.deepEqual(errors, []);
            console.log('PASS: actual 3003 ChatRoom Enter/Ctrl+Enter send; with idle reply disabled, blur does not generate. Isolated profile; all API/external requests blocked.');
        } finally { await browser.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
}
