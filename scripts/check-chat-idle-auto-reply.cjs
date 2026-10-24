// Real React hook + browser events, virtual clock, synthetic history. No model/network/storage access.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(pkg, { paths: [path.dirname(require.resolve('react-dom')), process.cwd()] })), file), 'utf8');
const modules = {
    react: read('react', 'cjs/react.production.js'), 'react-dom': read('react-dom', 'cjs/react-dom.production.js'),
    'react-dom/client': read('react-dom', 'cjs/react-dom-client.production.js'), scheduler: read('scheduler', 'cjs/scheduler.production.js'),
    '@/lib/chat-storage': 'exports.loadChatMessages=()=>window.historyFixture;',
    '@/lib/keyboard-auto-send-config': `exports.IDLE_REPLY_CONFIG_UPDATED='chat-idle-reply-config-updated';exports.isKeyboardAutoSendEnabled=id=>window.enabled[id]===true;exports.getKeyboardAutoSendDebounceMs=()=>1000;`,
    hook: ts.transpileModule(fs.readFileSync('components/chat/use-chat-idle-auto-reply.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
};
(async () => {
    for (const engine of ['chromium', 'webkit']) {
        const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: process.env.CHAT_TEST_BROWSER }));
        try {
            const page = await browser.newPage(); const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => r.abort());
            await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
            await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
            await page.setContent('<div class="phone-shell"><div id="root"></div><button id="outside">Main index</button><div id="modal" aria-modal="true" hidden>Tools</div></div>');
            await page.addScriptTag({ content: `const modules=${JSON.stringify(modules)},cache={};window.require=name=>{if(cache[name])return cache[name].exports;const m={exports:{}};cache[name]=m;new Function('require','module','exports',modules[name])(require,m,m.exports);return m.exports;};
                const R=require('react'),{flushSync}=require('react-dom'),app=require('react-dom/client').createRoot(document.getElementById('root'));
                window.calls=[];window.enabled={s:true};window.historyFixture=[];window.opts={sessionId:'s',active:true,pending:true,generating:false,busy:false,messageId:''};
                function App(){const ref=R.useRef(null);require('hook').useChatIdleAutoReply(ref,{...opts,onTrigger:()=>calls.push([opts.sessionId,opts.messageId])});return R.createElement('section',{ref,id:'room'},R.createElement('textarea',{className:'chat-input-textarea'}));}
                window.render=patch=>{Object.assign(opts,patch);flushSync(()=>app.render(R.createElement(App)));};
                window.send=id=>{historyFixture=[{id,role:'user'}];render({messageId:id,pending:true,generating:false,busy:false});};render({});` });
            const tick = async ms => { await page.clock.runFor(ms); };
            const count = async n => assert.equal(await page.evaluate(() => calls.length), n);
            const send = async id => { await page.evaluate(id => send(id), id); await tick(0); };
            const input = page.locator('textarea'); await input.waitFor();
            // Focus may remain and the keyboard may be open: a sent bubble still replies after idle.
            await input.focus(); await send('focus'); await tick(999); await count(0); await tick(1); await count(1);
            await tick(5000); await count(1); // Failure/no assistant output must not auto retry.
            // Multiple sends extend the same turn; unrelated rerenders must not extend it.
            await send('first'); await tick(700); await send('second'); await tick(600);
            await page.evaluate(() => render({})); await tick(399); await count(1); await tick(1); await count(2);
            // Typing/dictation draft blocks even while idle; deleting it restarts a full interval.
            await send('draft'); await input.fill('still composing'); await tick(3000); await count(2);
            await input.fill(''); await tick(999); await count(2); await tick(251); await count(3);
            // IME and long pointer gestures cannot expire midway.
            await send('ime'); await input.dispatchEvent('compositionstart'); await tick(2000); await count(3);
            await input.dispatchEvent('compositionend'); await tick(1250); await count(4);
            await send('hold'); await input.dispatchEvent('pointerdown', { pointerId: 9 }); await tick(2000); await count(4);
            await input.dispatchEvent('pointerup', { pointerId: 9 }); await tick(1250); await count(5);
            // Emoji / recording / transcription / settings use the same explicit busy gate.
            await send('panel'); await page.evaluate(() => render({ busy: true })); await tick(4000); await count(5);
            await page.evaluate(() => render({ busy: false })); await tick(999); await count(5); await tick(251); await count(6);
            // Activity outside the composer, plus portalled tools, postpones the reply.
            await send('index'); await tick(800); await page.locator('#outside').dispatchEvent('click'); await tick(800); await count(6);
            await page.evaluate(() => { document.getElementById('modal').hidden = false; }); await tick(2000); await count(6);
            await page.evaluate(() => { document.getElementById('modal').hidden = true; }); await tick(1250); await count(7);
            // Hidden/background rooms resume only after a full quiet interval.
            await send('hidden'); await page.evaluate(() => { document.getElementById('root').style.display = 'none'; }); await tick(2000); await count(7);
            await page.evaluate(() => { document.getElementById('root').style.display = ''; }); await tick(1250); await count(8);
            await send('blur'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await tick(2000); await count(8);
            await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await tick(1250); await count(9);
            // Explicit manual generation consumes the turn, even if stopped/failed without an answer.
            await send('manual'); await page.evaluate(() => render({ generating: true })); await tick(0);
            await page.evaluate(() => render({ generating: false })); await tick(3000); await count(9);
            // New assistant output/storage changes invalidate an old pending callback.
            await send('answered'); await page.evaluate(() => historyFixture.push({ id: 'assistant', role: 'assistant' })); await tick(2000); await count(9);
            // Settings are per-session, changes cancel immediately, session switches cancel old timers.
            await send('disabled'); await page.evaluate(() => { enabled.s=false;window.dispatchEvent(new Event('chat-idle-reply-config-updated')); }); await tick(2000); await count(9);
            await page.evaluate(() => { enabled.s=true;window.dispatchEvent(new Event('chat-idle-reply-config-updated')); }); await tick(1000); await count(10);
            await send('old-session'); await tick(700); await page.evaluate(() => { render({ sessionId:'other',messageId:'other-message' });historyFixture=[{id:'other-message',role:'user'}]; }); await tick(3000); await count(10);
            await page.evaluate(() => { enabled.other=true;window.dispatchEvent(new Event('chat-idle-reply-config-updated')); }); await tick(1000); await count(11);
            assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['other','other-message']);
            // A real in-app touch proves foreground use even if a matching window focus event is missing.
            await send('returned-touch'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await tick(2000); await count(11);
            await input.dispatchEvent('pointerdown', { pointerId: 12 }); await input.dispatchEvent('pointerup', { pointerId: 12 });
            await tick(1250); await count(12);
            await page.evaluate(() => render({ messageId:'unmounted' })); await page.evaluate(() => { document.getElementById('root').remove(); }); await tick(2000); await count(12);
            assert.deepEqual(errors, []);
            console.log(`PASS ${engine}: focused idle, burst sends, drafts, IME, gestures, busy panels/voice, main-index activity, modal/hidden/background, manual stop/failure once, storage validation, per-session config and switching.`);
        } finally { await browser.close(); }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
