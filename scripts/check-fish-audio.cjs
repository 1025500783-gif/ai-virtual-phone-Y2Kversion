// Isolated contract tests. No network, account, model, or user storage access.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
let calls = [], fetchImpl, timeout, releases = 0, active = true;
class Clock extends Date { static now() { return Date.parse('2026-10-24T00:00:00Z'); } }
const identity = { assertIdentityActive: () => { if (!active) throw Error('identity changed'); }, registerIdentityRequest: () => () => releases++ };
function load(file, deps = {}) {
    const context = { exports: {}, require: name => { if (!(name in deps)) throw Error('Unexpected import: ' + name); return deps[name]; },
        Blob, Response, URL, AbortController, TypeError, DOMException, Date: Clock,
        setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => {},
        fetch: async (...args) => { calls.push(args); return fetchImpl(...args); } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context.exports;
}
const protocol = load('lib/fish-audio-protocol.ts');
const fish = load('lib/fish-audio-tts.ts', { './identity-runtime': identity, './fish-audio-protocol': protocol });
const config = { id: 'fish-test', provider: 'FishAudio', model: fish.FISH_AUDIO_FREE_MODEL, baseUrl: fish.FISH_AUDIO_BASE_URL,
    apiKey: 'synthetic-key', defaultVoice: 'voice-test', enableTTS: true, enableSTT: false };
let configs = [config], bindings = { char: 'fish-test' };
const storage = { loadVoiceConfigs: () => configs, loadBindingConfig: () => ({}), resolveBinding: (_, id) => ({ voiceConfigId: bindings[id] }) };
const voice = load('lib/voice-expression.ts', { './settings-storage': storage,
    './voice-guides/elevenlabs': load('lib/voice-guides/elevenlabs.ts'),
    './voice-guides/fish-audio': load('lib/voice-guides/fish-audio.ts') });
const tts = load('lib/tts-service.ts', { '@/lib/identity-runtime': { ...identity, identityLocalStorage: {} }, './identity-runtime': identity, './settings-storage': storage,
    './voice-expression': voice, './fish-audio-tts': fish, './elevenlabs-tts': { synthesizeElevenLabs: () => { throw Error('Paid fallback'); } } });
async function main() {
    assert.equal(tts.resolveVoiceConfig('char').provider, 'FishAudio');
    fetchImpl = async () => new Response(new Uint8Array([73, 68, 51]), { headers: { 'content-type': 'audio/mpeg' } });
    assert.equal(await tts.synthesizeSpeech('  ', config), null);
    assert.equal(calls.length, 0);
    const blob = await tts.synthesizeSpeech('{voice:chuckles} 你好。[long pause]', config);
    assert.equal(blob.type, 'audio/mpeg'); assert.equal(blob.size, 3);
    const [url, init] = calls[0];
    assert.equal(url, '/api/voice/fish-audio');
    assert.equal(init.headers.model, 's2.1-pro-free'); assert.equal(init.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert(init.signal);
    assert.deepEqual(JSON.parse(init.body), { text: '[chuckling] 你好。[long-break]', reference_id: 'voice-test', format: 'mp3', sample_rate: 44100, mp3_bitrate: 128 });
    for (const model of ['', undefined, null, 's1', 's2.1-pro-typo', 's2.1-pro-free ', 'S2.1-PRO-FREE']) {
        const before = calls.length;
        await assert.rejects(tts.synthesizeSpeech('test', { ...config, model }), /有效.*模型/);
        assert.equal(calls.length, before, 'invalid model must stop before network');
    }
    for (const baseUrl of ['https://proxy.invalid/v1', 'https://api.fish.audio.evil/v1', 'http://api.fish.audio/v1', 'https://api.fish.audio/v1?model=s2.1-pro']) {
        await assert.rejects(fish.synthesizeFishAudio('test', { ...config, baseUrl }), /官方接口/);
    }
    for (const now of [fish.FISH_AUDIO_FREE_UNTIL, fish.FISH_AUDIO_FREE_UNTIL + 1, NaN]) assert.throws(() => fish.fishAudioSpeechRequest('test', config, now), /截止时间/);
    assert.equal(fish.fishAudioSpeechRequest('test', config, fish.FISH_AUDIO_FREE_UNTIL - 1).headers.model, 's2.1-pro-free');
    for (const model of fish.FISH_AUDIO_MODELS) {
        const before = calls.length;
        await tts.synthesizeSpeech('{voice:chuckling} test', { ...config, model });
        assert.equal(calls.length, before + 1);
        assert.equal(calls.at(-1)[1].headers.model, model, 'only selected model is requested');
        assert.equal(JSON.parse(calls.at(-1)[1].body).text, '[chuckling] test');
        if (model !== fish.FISH_AUDIO_FREE_MODEL) assert.equal(fish.fishAudioSpeechRequest('test', { ...config, model }, fish.FISH_AUDIO_FREE_UNTIL + 1).headers.model, model, 'free expiry does not disable paid selections');
    }
    await assert.rejects(fish.synthesizeFishAudio('test', { ...config, apiKey: '' }), /API Key/);
    await assert.rejects(fish.synthesizeFishAudio('test', { ...config, defaultVoice: '' }), /音色 ID/);
    for (const model of fish.FISH_AUDIO_MODELS) for (const status of [400, 401, 402, 403, 404, 429, 500, 503]) {
        const before = calls.length;
        fetchImpl = async () => new Response('synthetic-key private text', { status });
        await assert.rejects(tts.synthesizeSpeech('private text', { ...config, model }), e => e.message.includes(String(status)) && !e.message.includes('synthetic-key') && !e.message.includes('private text'));
        assert.equal(calls.length, before + 1, 'errors must not retry or fall back');
        assert.equal(calls.at(-1)[1].headers.model, model);
    }
    fetchImpl = async () => Response.json({ error: 'invalid_origin' }, { status: 403 });
    await assert.rejects(fish.synthesizeFishAudio('test', config), e => e.message.includes('Float 请求来源校验失败') && !e.message.includes('账户无权'));
    for (const type of ['application/json', 'text/html', 'text/plain']) {
        fetchImpl = async () => new Response('{}', { headers: { 'content-type': type } });
        await assert.rejects(fish.synthesizeFishAudio('test', config), /不是音频/);
    }
    fetchImpl = async () => new Response('', { headers: { 'content-type': 'audio/mpeg' } });
    await assert.rejects(fish.synthesizeFishAudio('test', config), /空音频/);
    fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(fish.synthesizeFishAudio('test', config), /Float 语音接口/);
    // Timeout covers download as well as response headers.
    fetchImpl = async () => ({ ok: true, headers: new Headers({ 'content-type': 'audio/mpeg' }), blob: async () => { timeout(); throw new DOMException('aborted', 'AbortError'); } });
    await assert.rejects(fish.synthesizeFishAudio('test', config), /超时/);
    active = false; const before = calls.length;
    await assert.rejects(fish.synthesizeFishAudio('test', config), /identity changed/); assert.equal(calls.length, before);
    active = true;
    fetchImpl = async () => { active = false; return new Response('mp3', { headers: { 'content-type': 'audio/mpeg' } }); };
    await assert.rejects(fish.synthesizeFishAudio('test', config), /identity changed/); active = true;
    assert.ok(releases >= 14);
    const fishPrompt = voice.voiceExpressionInstruction(['char']);
    assert.match(fishPrompt, /Fish Audio角色ID：char/); assert.match(fishPrompt, /chuckling/); assert.doesNotMatch(fishPrompt, /ElevenLabs|chuckles|免费|付费|API|保证/);
    assert.doesNotMatch(fishPrompt, /teasing|fondly exasperated|dog barking|soft road noise|小狗型/);
    for (const cue of ['whispering', 'clear throat', 'sighing', 'break', 'long-break', 'emphasis', 'slightly sad', 'rustling sound']) assert.ok(fishPrompt.includes(cue));
    assert.match(fishPrompt, /描述性语气标记后要有对应台词/);
    assert.match(fishPrompt, /下一标记或句末结束/);
    assert.match(voice.voiceExpressionInstruction(['char'], true), /当前为通话/);
    configs = [config, { id: 'eleven', provider: 'ElevenLabs', model: 'eleven_v3' }]; bindings.elevenChar = 'eleven';
    const mixed = voice.voiceExpressionInstruction(['char', 'elevenChar', 'unbound']);
    assert.match(mixed, /Fish Audio角色ID：char/); assert.match(mixed, /ElevenLabs角色ID：elevenChar/);
    const [elevenBlock, fishBlock] = mixed.split('\n\n');
    assert.match(elevenBlock, /ElevenLabs角色ID：elevenChar/); assert.doesNotMatch(elevenBlock, /Fish Audio|chuckling/);
    assert.match(fishBlock, /Fish Audio角色ID：char/); assert.doesNotMatch(fishBlock, /ElevenLabs|chuckles|teasing/);
    assert.doesNotMatch(mixed, /unbound/);
    assert.equal(voice.voiceExpressionInstruction(['char', 'char']).match(/Fish Audio角色ID：char/g).length, 1);
    bindings.char = 'eleven';
    const switched = voice.voiceExpressionInstruction(['char']);
    assert.match(switched, /ElevenLabs角色ID：char/); assert.doesNotMatch(switched, /Fish Audio/);
    bindings.char = 'fish-test';
    for (const selected of fish.FISH_AUDIO_MODELS) {
        configs[0] = { ...config, model: selected };
        assert.match(voice.voiceExpressionInstruction(['char']), /Fish Audio角色ID：char/);
    }
    for (const model of fish.FISH_AUDIO_MODELS) assert.equal(voice.supportsVoiceExpression('FishAudio', model), true);
    assert.equal(voice.supportsVoiceExpression('FishAudio', 's1'), false);
    console.log('PASS Fish Audio: exact selected model, free-only expiry/origin/unknown-model guards, all-model errors without retry/fallback, binary/timeout/identity, binding and expression compatibility. No real API calls.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
