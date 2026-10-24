// Actual 3003 settings UI in a fresh browser profile. All APIs are mocked or blocked.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CHAT_TEST_BASE_URL || 'http://127.0.0.1:3003';
async function run(engine) {
    const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ headless: true, executablePath: process.env.CHAT_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }));
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        page.setDefaultTimeout(20000);await page.addLocatorHandler(page.getByRole('button',{name:'关闭更新卡片',exact:true}),async()=>page.getByRole('button',{name:'关闭更新卡片',exact:true}).click());
        const calls = [], errors = [], dialogs = []; let status = 402;
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
        await page.route('**/*', r => {
            const u = new URL(r.request().url());
            if (u.origin === base && u.pathname === '/api/auth/me') return r.fulfill({ json: { ok: true, account: { id: 'fish-qa', username: 'fish-qa', displayName: 'Fish QA', status: 'active' } } });
            if (u.origin === base && u.pathname === '/api/voice/fish-audio') {
                calls.push({ headers: r.request().headers(), body: r.request().postDataJSON() });
                return r.fulfill({ status, json: { message: 'synthetic private upstream detail' } });
            }
            return u.origin === base && !u.pathname.startsWith('/api/') ? r.continue() : r.abort();
        });
        const openSettings = async () => {
            await page.goto(base + '/?phone-session=fish-qa', { timeout: 120000 });
            await page.getByRole('button', { name: '聊天', exact: true }).waitFor();
            const notice = page.getByRole('button', { name: '我知道了', exact: true });
            await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
            if (await notice.isVisible()) await notice.click();
            await page.evaluate(() => dispatchEvent(new CustomEvent('open-app', { detail: { appId: 'settings' } })));
            await page.getByText('语音 API', { exact: true }).click();
        };
        await openSettings();
        await page.getByRole('button', { name: '新增语音方案' }).click();
        const provider = page.getByLabel('语音服务商');
        await provider.selectOption('FishAudio');
        // Native expanded picker remains keyboard-operable and has all existing providers.
        assert.equal(await provider.locator('option').count(), 5);
        await provider.focus(); await provider.press('ArrowDown'); await provider.press('Enter');
        if (engine === 'chromium') assert.equal(await provider.inputValue(), 'ElevenLabs');
        await provider.selectOption('FishAudio');
        const modal = page.locator('.modal-sheet');
        const preview = async () => {
            const dialog = page.waitForEvent('dialog');
            await page.getByRole('button', { name: '试听语音', exact: true }).click();
            await dialog;
            await page.getByRole('button', { name: '试听语音', exact: true }).waitFor();
        };
        await modal.locator('input[type="text"]').first().fill('Fish QA');
        const model = page.getByLabel('Fish Audio 语音模型');
        assert.equal(await model.inputValue(), 's2.1-pro-free');
        assert.equal(await modal.locator('select').count(), 2, 'provider and model selectors only');
        assert.equal(await model.locator('option').count(), 5);
        assert.equal(await modal.getByText('同步音色列表', { exact: true }).count(), 0);
        await preview();
        assert.equal(calls.length, 0, 'missing credentials stop locally');
        await page.getByPlaceholder('输入密钥...').fill('synthetic-fish-qa-key');
        await page.getByLabel('语音音色 ID').fill('synthetic-voice-id');
        for (const code of [402, 429]) {
            status = code; const count = calls.length;
            await preview();
            await page.waitForTimeout(200);
            assert.equal(calls.length, count + 1, dialogs.at(-1));
            assert(dialogs.at(-1).includes(String(code))); assert(!dialogs.at(-1).includes('synthetic private'));
        }
        for (const call of calls) { assert.equal(call.headers.model, 's2.1-pro-free'); assert.equal(call.body.reference_id, 'synthetic-voice-id'); }
        for (const selected of ['s2.1-pro', 's2-pro', 'drama-3']) {
            await model.selectOption(selected);
            await page.getByText('已选择付费模型，试听、聊天语音与通话合成按 Fish Audio 账户价格计费。', { exact: true }).waitFor();
            const count = calls.length;
            await preview();
            assert.equal(calls.length, count + 1); assert.equal(calls.at(-1).headers.model, selected);
            assert.equal(await model.inputValue(), selected, 'failure must not change selection');
        }
        await model.selectOption('s2.1-pro');
        // Screenshots contain no key or personal data.
        await page.getByPlaceholder('输入密钥...').fill('');
        fs.mkdirSync('qa/fish-audio', { recursive: true });
        for (const width of [390, 320]) for (const scheme of ['light', 'dark']) {
            await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: scheme });
            await page.getByLabel('语音音色 ID').scrollIntoViewIfNeeded();
            assert(await modal.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'no horizontal modal overflow');
            const panel = await modal.evaluate(e => getComputedStyle(e).getPropertyValue('--c-panel').trim());
            if (scheme === 'dark') assert.equal(panel, '#202024');
            await page.screenshot({ path: `qa/fish-audio/${engine}-${width}-${scheme}.png` });
        }
        await page.getByPlaceholder('输入密钥...').fill('synthetic-fish-qa-key');
        await page.getByRole('button', { name: '保存语音配置', exact: true }).click();
        await page.waitForTimeout(200);
        await openSettings();
        await page.getByRole('button', { name: '编辑 Fish QA', exact: true }).click();
        assert.equal(await provider.inputValue(), 'FishAudio');
        assert.equal(await model.inputValue(), 's2.1-pro', 'paid choice persists exactly');
        assert.equal(await page.getByLabel('语音音色 ID').inputValue(), 'synthetic-voice-id');
        assert.equal(await page.getByPlaceholder('输入密钥...').inputValue(), 'synthetic-fish-qa-key');
        // Simulate an unknown imported model in this disposable profile only.
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('AiPhoneKvDB');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
                const rows = store.getAll();
                rows.onsuccess = () => {
                    const row = rows.result.find(r => r.key.endsWith('ai_phone_voice_configs_v1'));
                    const configs = JSON.parse(row.value);
                    configs.find(c => c.name === 'Fish QA').model = 's2.1-pro-typo';
                    store.put({ ...row, value: JSON.stringify(configs) });
                };
                tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
            };
        }));
        await openSettings();
        await page.getByRole('button', { name: '编辑 Fish QA', exact: true }).click();
        await page.getByText('此配置的模型为空或无法识别，请重新选择；不会自动使用默认模型。', { exact: true }).waitFor();
        const count = calls.length;
        await preview();
        assert.equal(calls.length, count, 'unknown model must not reach network');
        await model.selectOption('s2.1-pro-free');
        assert.equal(await model.inputValue(), 's2.1-pro-free');
        await provider.selectOption('ElevenLabs');
        assert.equal(await page.getByPlaceholder('输入密钥...').inputValue(), '');
        await provider.selectOption('FishAudio');
        assert.equal(await page.getByLabel('语音音色 ID').inputValue(), '');
        assert.equal(await page.getByPlaceholder('输入密钥...').inputValue(), '');
        assert.deepEqual(errors, []);
        console.log(`PASS actual 3003 ${engine}: default free, all paid selections and exact model requests, no fallback on errors, paid choice persists, unknown model blocked, switch cleanup, 390/320 system day/night. No real APIs or user storage.`);
    } finally { await browser.close(); }
}
(async () => { for (const engine of ['chromium', 'webkit']) await run(engine); })().catch(e => { console.error(e); process.exitCode = 1; });
