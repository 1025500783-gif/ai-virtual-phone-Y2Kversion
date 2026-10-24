const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
class Clock extends Date { static now() { return Date.parse('2026-10-24T00:00:00Z'); } }
let calls = [], mock, timer;
function load(file, deps = {}, globals = {}) {
    const context = { exports: {}, Request, Response, Headers, URL, AbortController, Date: Clock,
        setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => {},
        require: id => { if (!(id in deps)) throw Error('Unexpected import ' + id); return deps[id]; }, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context.exports;
}
const protocol = load('lib/fish-audio-protocol.ts');
const route = load('app/api/voice/fish-audio/route.ts', { '@/lib/fish-audio-protocol': protocol, '@/lib/server/fish-audio-fetch': { fishAudioFetch: async (...args) => { calls.push(args); return mock(...args); } } });
function request(model = 's2.1-pro-free', body = { text: 'hello', reference_id: 'synthetic-voice' }, headers = {}) {
    return new Request('http://localhost:3003/api/voice/fish-audio', { method: 'POST', headers: { Authorization: 'Bearer synthetic-key', model, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
async function main() {
    mock = async () => new Response('ID3', { headers: { 'content-type': 'audio/mpeg' } });
    for (const model of protocol.FISH_AUDIO_MODELS) {
        const before = calls.length, response = await route.POST(request(model));
        assert.equal(response.status, 200); assert.equal(await response.text(), 'ID3');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(calls.length, before + 1);
        const [url, init] = calls.at(-1); assert.equal(url, 'https://api.fish.audio/v1/tts');
        assert.equal(init.headers.model, model); assert.equal(init.headers.Authorization, 'Bearer synthetic-key');
        assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert(init.signal);
        assert.equal(JSON.parse(init.body).reference_id, 'synthetic-voice');
    }
    for (const model of ['', 's2.1-pro-typo', 's1']) {
        const before = calls.length; assert.equal((await route.POST(request(model))).status, 400); assert.equal(calls.length, before);
    }
    const before = calls.length;
    assert.equal((await route.POST(request('s2.1-pro', {}, {}))).status, 400);
    assert.equal((await route.POST(request('s2.1-pro', { text: 'hello', reference_id: 'v' }, { Authorization: '' }))).status, 400);
    assert.equal((await route.POST(request('s2.1-pro', { text: 'hello', reference_id: 'v' }, { Origin: 'https://evil.invalid' }))).status, 403);
    assert.equal((await route.POST(request('s2.1-pro', { text: 'a'.repeat(256001), reference_id: 'v' }))).status, 413);
    assert.equal(calls.length, before);
    // Custom Next server's internal URL differs from the browser's LAN origin.
    const lan = new Request('http://localhost:3003/api/voice/fish-audio', { method: 'POST', headers: { host: '192.0.2.10:3003', origin: 'http://192.0.2.10:3003', 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await route.POST(lan)).status, 400, 'matching LAN Host passes origin check before input validation');
    const spoofed = request('s2.1-pro', { text: 'hello', reference_id: 'v' }, { host: '192.0.2.10:3003', origin: 'https://evil.invalid', 'x-forwarded-host': 'evil.invalid' });
    assert.equal((await route.POST(spoofed)).status, 403, 'untrusted forwarded host must not bypass origin check');
    assert.equal(calls.length, before);
    for (const status of [401, 402, 403, 404, 429, 500, 503]) {
        mock = async () => new Response('private text synthetic-key', { status });
        const count = calls.length, response = await route.POST(request('s2.1-pro'));
        assert.equal(response.status, status); assert.equal(calls.length, count + 1);
        assert.equal(await response.text(), '{"error":"fish_upstream_error"}');
    }
    mock = async () => { throw Error('private text synthetic-key'); };
    const network = await route.POST(request()); assert.equal(network.status, 502); assert.equal((await network.json()).error, 'fish_network_error');
    mock = async () => { timer(); throw Error('aborted'); };
    assert.equal((await route.POST(request())).status, 504);
    mock = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal((await route.POST(request())).status, 502);
    mock = async () => new Response('', { headers: { 'content-type': 'audio/mpeg' } });
    assert.equal((await route.POST(request())).status, 502);
    mock = async () => ({ ok: true, headers: new Headers({ 'content-type': 'audio/mpeg' }), arrayBuffer: async () => { timer(); throw Error('download aborted'); } });
    assert.equal((await route.POST(request())).status, 504);
    // Caller URL/options cannot override the fixed upstream endpoint or canonical body.
    mock = async () => new Response('ID3', { headers: { 'content-type': 'audio/mpeg' } });
    await route.POST(request('drama-3', { text: 'hello', reference_id: 'v', url: 'http://127.0.0.1', model: 's2.1-pro', format: 'json' }));
    assert.equal(calls.at(-1)[0], 'https://api.fish.audio/v1/tts'); assert.equal(calls.at(-1)[1].headers.model, 'drama-3');
    assert.equal(JSON.parse(calls.at(-1)[1].body).format, 'mp3');
    // Development Windows selects its enabled system proxy before the only request.
    const networkCalls = []; let regs = 0;
    const deps = { 'node:child_process': { execFile: (_bin, args, _options, cb) => { regs++; cb(null, { stdout: args.at(-1) === 'ProxyEnable' ? 'ProxyEnable REG_DWORD 0x1' : 'ProxyServer REG_SZ 127.0.0.1:7897' }); } },
        'node:util': { promisify: fn => (...args) => new Promise((resolve, reject) => fn(...args, (error, result) => error ? reject(error) : resolve(result))) },
        undici: { ProxyAgent: class { constructor(url) { this.url = url; } } }, '../proxy-fetch': { proxyFetch: async () => { throw Error('unexpected direct fallback'); } } };
    const fetcher = load('lib/server/fish-audio-fetch.ts', deps, { process: { platform: 'win32', env: { NODE_ENV: 'development' } }, fetch: async (...args) => { networkCalls.push(args); return new Response('ok'); } });
    await fetcher.fishAudioFetch('https://api.fish.audio/v1/tts', {});
    assert.equal(regs, 2); assert.equal(networkCalls.length, 1); assert.equal(networkCalls[0][1].dispatcher.url, 'http://127.0.0.1:7897/');
    let productionCalls = 0;
    const production = load('lib/server/fish-audio-fetch.ts', { ...deps, '../proxy-fetch': { proxyFetch: async (url, init) => { productionCalls++; assert.equal(url, 'https://api.fish.audio/v1/tts'); assert.equal(init.method, 'POST'); return new Response('ok'); } } }, { process: { platform: 'linux', env: { NODE_ENV: 'production' } }, fetch: () => { throw Error('unexpected direct production request'); } });
    await production.fishAudioFetch('https://api.fish.audio/v1/tts', { method: 'POST' });
    assert.equal(productionCalls, 1); assert.equal(regs, 2, 'production must not read Windows proxy');
    console.log('PASS Fish relay: exact models, fixed upstream, canonical body, validation/origin, no retries, safe errors, binary/download timeout and development Windows proxy selection. No real APIs.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
