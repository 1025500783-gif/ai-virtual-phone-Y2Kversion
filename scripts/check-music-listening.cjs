// Production capture, publish callbacks and prompt assembly; synthetic clocks/storage, no API calls.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file, mocks = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
        { exports, console, Intl, require: name => mocks[name] || {} }, { filename: file });
    return exports;
}
const music = load('lib/music-listening.ts');
const track = { id: 'song-a', title: '测试歌曲', artist: '歌手', lyrics: '[00:30.00]最前一句\n[00:38.50]上一句的海\n[00:44.00]此刻的蓝\n[00:50.00]未来的天', duration: 90 };
let owner = 'A', active = true;
let snapshot = { identityId: 'A', currentTrack: track, currentTime: 45, isPlaying: true };
const capture = load('lib/music-listening-capture.ts', {
    './music-listening': music,
        './listen-together': { listeningRoomPrompt: () => '' },
    './music-control-bridge': { getMusicControlBridge: () => ({ getState: () => snapshot }) },
    './identity-runtime': { getCurrentIdentityId: () => owner, assertIdentityActive: () => { if (!active) throw Error('inactive'); } },
}).captureMusicListeningContext;
const sentAt = '2026-10-06T00:00:45.000Z';
assert.equal(capture(sentAt), null, "ordinary chat captures no live lyrics");
const context = music.createMusicListeningContext(snapshot, owner, sentAt);
assert.equal(context.position, 45);
assert.deepEqual(Array.from(context.lines, line => line.time), [30, 38.5, 44]);
snapshot.currentTime = 52;
assert.equal(context.position, 45);
assert.equal(context.lines.at(-1).text, '此刻的蓝');
const quote = music.createMusicListeningContext(snapshot, 'A', sentAt, { time: 38.5, text: '上一句的海' });
snapshot = { ...snapshot, currentTrack: { ...track, id: 'song-b', title: '第二首' }, currentTime: 10 };
assert.equal(capture(sentAt, quote).trackId, 'song-a');
assert.equal(capture(sentAt, quote).reference.time, 38.5);
const formatted = music.musicListeningHistoryText({ role: 'user', listeningContext: context }, '上一句太有意思了');
assert.equal(formatted, "上一句太有意思了", "old automatic snapshots are ignored");
assert.doesNotMatch(formatted, /当前 00:44：此刻的蓝/);
assert.doesNotMatch(formatted, /未来的天|00:52/);
assert.doesNotMatch(music.musicListeningHistoryText({ role: 'user', listeningContext: quote }, '这句！'), /当前/);
owner = 'B'; assert.equal(capture(sentAt, quote), null, 'old bridge and lyric draft cannot cross identities');
active = false; assert.throws(() => capture(), /inactive/); active = true; owner = 'A';
const lines = music.parseTimedLyrics('[00:01.50][00:04.00]复唱\n[00:03.00]\n[ar:歌手]\n[00:01.50]复唱');
assert.equal(lines.length, 3); assert.equal(lines[1].text, '');
assert.equal(music.parseTimedLyrics('[offset:500]\n[00:01.00]提前半秒')[0].time, .5);
assert.equal(music.createMusicListeningContext({ ...snapshot, currentTrack: track, currentTime: 20 }, owner, sentAt), undefined);
assert.equal(music.createMusicListeningContext({ ...snapshot, currentTrack: { ...track, lyrics: '无时间歌词' } }, owner, sentAt), undefined);

function extract(file, name) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer.getText(source);
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source).replace('export ', '');
        ts.forEachChild(node, visit);
    }
    visit(source); assert.ok(found, name); return found;
}
const writes = [], cache = [], publishes = [];
const runtime = {
    assertIdentityActive() {}, assertCharacterIdentityAccess() {}, getCurrentIdentityId: () => owner,
    captureMusicListeningContext: capture, createMessageId: () => `message-${writes.length}`,
    getNextMessageOrder: () => 1, runChatPluginTransformSync: (_hook, value) => {
        const message = { ...value.message }; delete message.listeningContext; return { message };
    },
    _messagesCache: cache, dbPutMessage: message => writes.push(structuredClone(message)),
    _sessionsCache: [], getChatMessagePreview: () => '', loadChatSessions: () => [], emitChatPluginEvent() {},
    isSessionPreviewCandidate: () => false,
};
// Execute real pushChatMessage up to the durable DB/cache boundary, omitting unrelated post-persist notifications.
const pushSource = extract('lib/chat-storage.ts', 'pushChatMessage').split('    // Auto update session last message')[0] + ' return newMsg; }';
vm.createContext(runtime);
vm.runInContext(ts.transpileModule(pushSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, runtime);
snapshot = { ...snapshot, currentTrack: track, currentTime: 45 };
const chat = {
    retryVersionRunRef: { current: false },
    ...runtime, pushChatMessage: runtime.pushChatMessage, session: { id: 'fixture' }, isGenerating: false,
    quotingMessage: null, ensureGroupSpeakPermission: () => true, cancelFollowUp() {},
    loadChatMessages: () => cache, getQuotePreview: () => '歌词', setQuotingMessage() {},
    captureMusicListeningContext: capture,
    canUseFireworks: () => false, canUseLove: () => false, canUseEcho: () => false,
    isDiceOnlyMessage: () => false, setMessages: updater => updater([]),
    hasEcho: () => false, hasLove: () => false, hasFireworks: () => false,
    setPendingGenerate: value => publishes.push(value), triggerAIResponse: () => { throw Error('unexpected model call'); },
    getChatPluginHookBus: () => ({ hasHandlers: () => true }),
    runChatPluginTransform: async (_hook, value) => { snapshot.currentTime = 52; return value; },
};
vm.createContext(chat);
vm.runInContext(ts.transpileModule(`var handleSendText = ${extract('components/chat/chat-room.tsx', 'handleSendText')};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, chat);
(async () => {
    assert.equal(chat.handleSendText('上一句真好', { autoReply: false }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!writes.at(-1).listeningContext, "ordinary asynchronous send has no music snapshot");

    assert.equal(publishes.at(-1), false);
    chat.quotingMessage = { id: 'lyric-draft', listeningContext: quote };
    chat.handleSendText('这句像你', { autoReply: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.at(-1).listeningContext.reference.time, 38.5);
    assert.equal(writes.at(-1).mediaData.quoteMessageId, undefined);
    assert.ok(!JSON.parse(JSON.stringify(writes[0])).listeningContext);

    const time = load('lib/character-time.ts');
    const assembler = load('lib/llm-prompt-assembler.ts', {
        './listen-together': { listeningRoomPrompt: () => '' },
        './music-listening': music,
        './macro-engine': load('lib/macro-engine.ts', { './character-time': time }),
        './character-time': time,
        './prompt-time': load('lib/prompt-time.ts', { './character-time': time, './chat-storage': { loadChatAppSettings: () => ({ timeAware: false }) } }),
        './prompt-sanitizer': { stripStateAndInnerForPrompt: text => text },
        './character-world-storage': { formatCharacterRelationsForPrompt: () => '' },
        './dwelling-storage': { readDwellingLayoutCache: () => null },
        './voice-expression': { voiceExpressionInstruction: () => '' },
        './chat-quotation': load('lib/chat-quotation.ts'),
        './preset-scope': load('lib/preset-scope.ts'),
        './currency-context': { walletCurrencyInstruction: () => '' },
        './photo-album-discussion': { albumChatContext: () => '' },
        './memory-storage': { loadMemoryConfig: () => ({  }) },
        './moments-storage': { loadMomentsConfig: () => ({ bilingualTranslationEnabled: false }) },
        './moments-bilingual': { buildMomentsBilingualInstruction: () => '' },
        './chat-echo': { echoHistoryText: (_m, body) => body },
        './chat-love': { loveHistoryText: (_m, body) => body },
        './chat-fireworks': { fireworksHistoryText: (_m, body) => body },
    });
    const character = { id: 'C', name: 'C', persona: '沉稳' };
    const base = { character, history: [writes[0]], worldBooks: [], regexes: [], preset: null, appId: 'chat', appTags: ['chat', 'text'], userIdentity: { id: 'A', name: 'A' }, timeAware: false };
    const privatePrompt = assembler.assemblePromptPayload(base);
    const sharedSong = { ...writes[0], listeningContext: undefined, mediaType: 'music_share', mediaData: { musicTitle: 'Song', musicArtist: 'Singer' } };
    assert.equal(assembler.formatRichMediaForHistory(sharedSong, 'A', 'C'), '[音乐分享:Song|Singer]\n' + sharedSong.content.trim());
    assert.equal(assembler.formatRichMediaForHistory({ ...sharedSong, content: '' }, 'A', 'C'), '[音乐分享:Song|Singer]');
    assert.equal(assembler.assemblePromptPayload({ ...base, history: [sharedSong] }).filter(message => message.content === music.MUSIC_LISTENING_INSTRUCTION).length, 1);

    const groupRuntime = { loadCharacters: () => [character], formatRichMediaForHistory: assembler.formatRichMediaForHistory,
        echoHistoryText: (_m, text) => text, loveHistoryText: (_m, text) => text, fireworksHistoryText: (_m, text) => text };
    vm.createContext(groupRuntime);
    vm.runInContext(ts.transpileModule(extract('lib/group-chat-engine.ts', 'annotateGroupHistory'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, groupRuntime);
    const groupHistory = groupRuntime.annotateGroupHistory([writes[0]], ['C'], 'A');
    const groupInput = { members: [{ character, worldBooks: [], regexes: [], currentStateValues: [] }], history: groupHistory, preset: null, regexes: [], timeAware: false };
    const groupPrompt = assembler.assembleGroupPromptPayload(groupInput);
    assert.equal(assembler.assembleGroupPromptPayload({ ...groupInput, history: [sharedSong] }).map(message => message.content).join('\n').split(music.MUSIC_LISTENING_INSTRUCTION).length - 1, 1);

    const unifiedRecentItems = [{ kind: 'history', timestamp: sentAt, historyIndex: 0 }];
    for (const prompt of [privatePrompt, groupPrompt,
        assembler.assemblePromptPayload({ ...base, unifiedRecentItems }),
        assembler.assembleGroupPromptPayload({ ...groupInput, unifiedRecentItems })]) {
        const text = prompt.map(message => message.content).join('\n');
        assert.doesNotMatch(text, /当前 00:44：此刻的蓝/);
        assert.doesNotMatch(text, /前1句 00:38：上一句的海/);
        assert.doesNotMatch(text, /未来的天/);
        assert.equal(text.split(music.MUSIC_LISTENING_INSTRUCTION).length - 1, 0);
    }
    assert.ok(!assembler.assemblePromptPayload({ ...base, history: [] }).some(message => message.content === music.MUSIC_LISTENING_INSTRUCTION));
    const explicit = assembler.assemblePromptPayload({ ...base, history: [writes[1]] }).map(m => m.content).join('\n');
    assert.match(explicit, /明确引用 00:38：上一句的海/);
    assert.doesNotMatch(explicit, /当前 00:44|当前 00:50|未来的天/);
    console.log('PASS: no automatic snapshots; explicit quotes retained; legacy snapshots ignored; explicit lyric precedence after song changes, identity guard, LRC repeats/gaps/missing timing, actual asynchronous send + persistence boundary, real private/group prompts; zero model/network calls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
