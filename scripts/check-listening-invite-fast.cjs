// Synthetic clocks/storage and transport only; no account, model or music requests.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
function load(file, mocks = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, console: { ...console, info() {} }, Map, Set, require: name => mocks[name] || {} }, { filename: file });
    return exports;
}
function extract(file, name) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace(/^export /, '');
}
const preview = load('lib/stream-preview.ts', { './text-tool-protocol': { stripTextToolDirectives: text => text } });
let identity = 'identity-a', room, snapshot, applied = [];
const fast = load('lib/listening-invite-fast.ts', {
    './listen-together': {
        getListeningRoom: () => room,
        applyListeningRoomReply: (marker, sessionId, actorId) => {
            const action = marker.endsWith(':接受]') ? 'joined' : 'declined';
            if (room.isGroup) room.members.find(member => member.characterId === actorId).status = action;
            else room.status = action;
            applied.push({ marker, sessionId, actorId });
        },
    },
    './music-control-bridge': { getMusicControlBridge: () => ({ getState: () => snapshot }) },
    './identity-runtime': { getCurrentIdentityId: () => identity },
    './stream-preview': preview,
});
const session = { id: 'chat-a', contactId: 'char-a', streamOnline: false };
function reset(overrides = {}) {
    identity = 'identity-a'; applied = [];
    room = { id: 'room-a', identityId: identity, sessionId: session.id, characterId: session.contactId, status: 'invited', initiator: 'user', ...overrides };
    snapshot = { identityId: identity, currentTrack: { id: 'song-a', title: '曲名', artist: '歌手', album: '专辑', duration: 190, lyrics: '不应注入的整份歌词' }, isPlaying: true };
    return [{ role: 'user', mediaType: 'listening_invite', mediaData: { listeningInvite: { roomId: room.id } } }];
}
let history = reset();
assert.equal(fast.pendingListeningInvite(session, history).id, room.id);
assert.equal(fast.pendingListeningInvite(session, [...history, { role: 'user', content: '补充文字' }]).id, room.id);
assert.equal(fast.pendingListeningInvite(session, [{...history[0],isRetracted:true},{role:'user',content:'补充文字'}]),null);
assert.equal(fast.pendingListeningInvite(session, [...history,{role:'assistant',content:'已回复'},{role:'user',content:'后来文字'}]),null);
assert.equal(fast.pendingListeningInvite(session, [...history, { role: 'assistant', content: '已回复' }]), null);
const instruction = fast.listeningInviteFirstInstruction(room);
assert.match(instruction, /曲名.*歌手.*专辑/);
assert.match(instruction, /190/);
assert.doesNotMatch(instruction, /不应注入的整份歌词/);
snapshot.identityId = 'identity-b'; assert.doesNotMatch(fast.listeningInviteFirstInstruction(room), /曲名/);
snapshot.identityId = identity;
let observer = fast.createListeningInviteStreamObserver(room);
observer.push('[一起听:room-'); assert.equal(room.status, 'invited');
observer.push('a:接受'); assert.equal(room.status, 'invited');
observer.push(']'); assert.equal(room.status, 'joined', 'consent takes effect before prose/end-of-stream');
observer.push('\n现在听的是曲名。'); observer.push('[一起听:room-a:接受]');
assert.equal(applied.length, 1, 'a repeated marker must not repeat joining/effects');
for (const action of ['接受','拒绝']) {
    const marker=`[一起听:${action}]`;
    for(let split=1;split<marker.length;split++){
        reset();observer=fast.createListeningInviteStreamObserver(room);
        observer.push(marker.slice(0,split));assert.equal(applied.length,0);
        observer.push(marker.slice(split));assert.equal(applied.length,1);
        assert.equal(room.status,action==='接受'?'joined':'declined');
        assert.equal(applied[0].marker,`[一起听:room-a:${action}]`);
    }
}
for (let length = 1; length < '[一起听:room-a:接受]'.length; length++) {
    reset(); observer = fast.createListeningInviteStreamObserver(room);
    observer.push('[一起听:room-a:接受]'.slice(0, length)); assert.equal(applied.length, 0);
    observer.push('[一起听:room-a:接受]'.slice(length)); assert.equal(applied.length, 1);
}
for (const invalid of ['正文举例：[一起听:room-a:接受]', '[一起听:other:接受]', '<thinking>[一起听:room-a:接受]</thinking>', '<private>[一起听:room-a:接受]</private>']) {
    reset(); observer = fast.createListeningInviteStreamObserver(room, { thinkingTags: ['private'] });
    observer.push(invalid); assert.equal(applied.length, 0, invalid);
}
reset(); observer = fast.createListeningInviteStreamObserver(room);
observer.push('<thinking>考虑是否加入</thinking>\n[一起听:room-a:拒绝]');
assert.equal(room.status, 'declined');
for (const invalidate of [() => { room = null; }, () => { room.id = 'new-room'; }, () => { identity = 'identity-b'; }, () => { room.status = 'declined'; }]) {
    reset(); observer = fast.createListeningInviteStreamObserver({ ...room }); invalidate();
    observer.push('[一起听:room-a:接受]'); assert.equal(applied.length, 0);
}
reset(); const controller = new AbortController(); observer = fast.createListeningInviteStreamObserver(room, { signal: controller.signal });
controller.abort(); observer.push('[一起听:room-a:接受]'); assert.equal(applied.length, 0);
reset({ isGroup: true, userJoined: true, members: [{ characterId: 'char-a', status: 'invited' }, { characterId: 'char-b', status: 'invited' }] });
observer = fast.createListeningInviteStreamObserver(room, { names: new Map([['甲', 'char-a'], ['乙', 'char-b']]) });
observer.push('[陌生人]: [一起听:room-a:接受]\n[甲]: [一起听:room-a:接'); assert.equal(applied.length, 0);
observer.push('受]\n你好。\n[乙]: [一起听:room-a:拒绝]');
assert.deepEqual(applied.map(item => item.actorId), ['char-a', 'char-b']);
assert.equal(room.members[0].status, 'joined'); assert.equal(room.members[1].status, 'declined');
for (const prefix of ['[', '[一', '[一起', '[一起听', '[一起听:room-a:接', '[一起听:room-a:接受]']) assert.equal(preview.cleanStreamText(prefix), '');
assert.equal(preview.cleanStreamText('[一起听:room-a:接受]\n你好'), '你好');

// Exercise the real generation core with an unfinished simulated response.
(async () => {
    // Real SSE reader + JSON reassembly, with short output and an open transport.
    // Without the invitation override the existing timestamp filter withholds 64 chars.
    const sse = load('lib/sse-json.ts');
    const transport = { console, TextDecoder, createSseJsonParser: sse.createSseJsonParser,
        ChatEngineError: Error, stripHallucinatedTimestamps: text => text,
        parseProviderStreamDelta: (_provider, event) => ({ content: event?.choices?.[0]?.delta?.content || '' }),
    };
    vm.createContext(transport);
    for (const name of ['parseSseEvents', 'createStreamingTimestampStripper', 'readSseStream']) vm.runInContext(ts.transpileModule(extract('lib/chat-engine.ts', name), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, transport);
    for (const stripTimestamps of [true, false]) {
        reset(); observer = fast.createListeningInviteStreamObserver(room);
        let wire;
        const body = new ReadableStream({ start(controller) { wire = controller; } });
        const reading = transport.readSseStream(new Response(body), 'openai', { onDelta: delta => observer.push(delta) }, stripTimestamps);
        const packet = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '[一起听:room-a:接受]' } }] })}\n\n`);
        wire.enqueue(packet.slice(0, 19)); wire.enqueue(packet.slice(19));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(room.status, stripTimestamps ? 'invited' : 'joined', 'short consent must not wait in the timestamp tail');
        wire.close(); await reading;
        assert.equal(room.status, 'joined');
    }
    history = reset();
    let finishStream;
    const tail = new Promise(resolve => { finishStream = resolve; });
    let firstDecision;
    const decision = new Promise(resolve => { firstDecision = resolve; });
    const runtime = {
        console, pendingListeningInvite: fast.pendingListeningInvite,
        createListeningInviteStreamObserver: fast.createListeningInviteStreamObserver,
        buildChatPromptMessages: async () => ({ llmMessages: [], character: { id: 'char-a', name: '甲' }, config: {}, preset: null, regexes: [], toolsEnabled: false, enabledTools: [] }),
        mergeAppTags: tags => tags, isSessionStreamingEnabled: s => s.streamOnline,
        getMaxToolRounds: () => 1,
        sendLLMStreamRequest: async (_config, _preset, _messages, _regexes, _meta, _options, callbacks) => {
            assert.equal(_options.immediateContent, true, 'invitation must bypass timestamp-tail buffering');
            callbacks.onDelta('[一起听:room-a:接受]'); firstDecision();
            await tail; callbacks.onDelta('\n正在听曲名。');
            return { content: '[一起听:room-a:接受]\n正在听曲名。' };
        },
        sendLLMRequest: () => { throw Error('must use streaming for invitation'); },
        throwIfAborted() {}, stripPresetTexts: text => text,
        parseActionTags: text => ({ cleanText: text, actions: [] }),
        parseToolFetches: () => [], parseToolCalls: () => ({ toolCalls: [] }),
        stripStateAndInnerForPrompt: text => text,
        incrementEventCounter() {}, maybeRunSummarization: async () => {},
    };
    vm.createContext(runtime);
    vm.runInContext(ts.transpileModule(extract('lib/chat-engine.ts', 'generateChatCompletionCore'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, runtime);
    let completed = false;
    const generation = runtime.generateChatCompletionCore({ ...session, streamOnline: true }, history,
        { appTags: ['chat', 'text', 'followup'] }, {}, { shortcutHandles: [] }).then(result => { completed = true; return result; });
    await decision;
    assert.equal(room.status, 'joined'); assert.equal(completed, false, 'joining does not wait for the tail');
    finishStream(); await generation;
    assert.equal(applied.length, 1);

    // Execute the production prompt builder: preserve role/context and disable only
    // network recall, images and tools for this invitation, never persistent settings.
    history = reset();
    const boundConfig = { id: 'api-a', enableImageRecognition: true };
    const preset = { id: 'preset-a', builtIn: true, prompts: [] };
    let assembled, recallConfig, imagePreparations = 0, toolReads = 0;
    const empty = () => '';
    const builder = {
        console, pendingListeningInvite: fast.pendingListeningInvite, listeningInviteFirstInstruction: fast.listeningInviteFirstInstruction,
        loadCharacters: () => [{ id: 'char-a', name: '甲', description: '必要人设' }],
        loadBindingConfig: () => ({}), resolveBinding: () => ({ apiConfigId: 'api-a', presetId: 'preset-a', worldBookIds: ['wb-a'] }),
        loadApiConfigs: () => [boundConfig], loadPresets: () => [preset], loadWorldBooks: () => [{ id: 'wb-a', name: '关系设定' }], loadRegexes: () => [],
        resolveUserIdentity: () => ({ name: '用户' }), buildCharacterTimeContext: () => ({}), getPromptTimestampOptionsForTimeContext: () => ({}),
        loadMemoryConfig: () => ({ vectorRecallEnabled: true }), mergeAppTags: tags => tags || ['chat', 'text'],
        getEnabledTools: () => { toolReads++; return []; }, nativeToolProtocolForConfig: () => false,
        selectChatRequestTools: tools => tools, listeningCapabilityPrompt: () => '', presetIncludesToolsMacro: () => false,
        prepareShortTermContext: () => ({ recentBlocks: ['近期上下文'], truncatedHistory: history, wbActivationContext: '当前对话', unifiedRecentItems: [] }),
        applyVisionImagePromptLimit: messages => messages, getAvatarVisionPromptLimit: () => 0,
        prepareVisionPromptImageMessage: async () => { imagePreparations++; }, buildAvatarActionPrompt: empty,
        retrieveMemoriesForPrompt: async (_id, _context, config) => { recallConfig = config; return []; }, retrieveCoreMemoriesForPrompt: async () => [],
        buildMusicLocalMacro: async () => '', buildMusicCloudMacro: async () => '', formatLongTermMemories: () => '已有记忆', formatCoreMemories: () => '核心记忆',
        buildCalendarScheduleMarker: empty, getWeekStartIso: empty, getCurrentCalendarScheduleForPrompt: empty, isNeteaseConfigured: () => false,
        runChatPluginTransform: async () => ({}), buildChatPluginPromptFragments: empty, formatCustomAppChatDirectivesForPrompt: empty, buildScreenEffectPromptHint: empty,
        buildChatBilingualInstruction: empty, getStatusRegionConfig: () => ({}), buildOfflineBilingualInstruction: empty,
        assemblePromptPayload: input => { assembled = input; return [{ role: 'system', content: '角色及世界书' }]; },
        getLatestCharacterStateValues: () => [], getCustomStickerNames: empty, getCustomStickerExample: empty, loadChatAppSettings: () => ({}),
        resolveStatusRegionSection: empty, resolveStatusRegionExampleLine: empty, resolveStatusRegionComposition: empty, resolveStatusRegionFullExample: empty,
        buildCurrentAvatarSnapshot: () => [], appendCurrentAvatarContext: async (_messages, _subjects, vision) => { if (vision) imagePreparations++; },
        appendCurrentChatBackgroundContext: async (_messages, _session, vision) => { if (vision) imagePreparations++; },
        buildIMessageTapbackPromptInstruction: empty, buildPokeUsagePrompt: empty, buildEchoPrompt: empty, buildLovePrompt: empty, buildFireworksPrompt: empty,
        buildImageDeliveryChatPrompt: empty, ONLINE_CHAT_CADENCE_INSTRUCTION: '', SCENE_GAP_RULE: '', appendEmptyGenerateGuardMessage() {}, lifePrompt: empty,
    };
    vm.createContext(builder);
    vm.runInContext(ts.transpileModule(extract('lib/chat-engine.ts', 'buildChatPromptMessages'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, builder);
    const prompt = await builder.buildChatPromptMessages(session, history);
    assert.equal(prompt.config.enableImageRecognition, false); assert.equal(boundConfig.enableImageRecognition, true);
    assert.equal(recallConfig.vectorRecallEnabled, false); assert.equal(imagePreparations, 0); assert.equal(toolReads, 0);
    assert.equal(assembled.character.description, '必要人设'); assert.equal(assembled.worldBooks[0].id, 'wb-a');
    assert.equal(assembled.coreMemories, '核心记忆'); assert.equal(assembled.longTermMemories, '已有记忆');
    assert.equal(prompt.preset, preset); assert.match(prompt.llmMessages.at(-1).content, /先输出/);
    room = null; await builder.buildChatPromptMessages(session, history);
    assert.equal(recallConfig.vectorRecallEnabled, true); assert.ok(imagePreparations > 0); assert.equal(toolReads, 1);

    // Actual builder with a macro-free role preset still offers only the built-in
    // listening actions; unrelated configured tools keep their existing gate.
    const toolPrompt = load('lib/tool-prompt.ts');
    const visiblePlaylists=[];
    const playlistContext=load('lib/listening-playlist-context.ts',{
        './chat-storage':{loadChatSessions:()=>[{id:session.id,contactId:'char-a'}]},
        './identity-access':{canCurrentIdentityInteract:()=>true},
        './identity-runtime':{assertIdentityActive(){}},
        './listening-library':{loadListeningLibrary:()=>({playlists:visiblePlaylists})},
    });
    const capability = load('lib/listening-capability.ts', { './tool-prompt': toolPrompt, './listening-playlist-context':playlistContext });
    const builtins = load('lib/listening-tool-definitions.ts').LISTENING_TOOL_DEFINITIONS.map(tool => ({ ...tool, source: 'internal', sourceId: 'listening_shared_' + tool.name }));
    Object.assign(builder, capability, { formatToolsForPrompt: toolPrompt.formatToolsForPrompt,
        getEnabledTools: () => [...builtins, { name: '外部工具', source: 'rest', sourceId: 'external', description: '', parameterSchema: '{}' }] });
    const ordinary = await builder.buildChatPromptMessages(session, [{ role: 'user', sessionId: session.id, content: '你去塞一点歌到我们的一起听歌单里去' }]);
    assert.equal(ordinary.toolsEnabled, true); assert.equal(ordinary.enabledTools.length, 2);
    assert(ordinary.llmMessages.some(message => message.content.includes('add_song')));
    assert(!ordinary.llmMessages.some(message => message.content.includes('外部工具')));
    visiblePlaylists.push({id:'new-ui-playlist',sessionId:session.id,name:'用户刚建的',songs:[]});
    const afterCreate=await builder.buildChatPromptMessages(session,[],{});
    assert(afterCreate.llmMessages.some(message=>message._debugMeta?.marker==='listening_capability'&&message.content.includes('new-ui-playlist')&&message.content.includes('用户刚建的')));
    assert(!ordinary.llmMessages.some(message=>message.content.includes('new-ui-playlist')));
    const disabled = await builder.buildChatPromptMessages(session, [], { toolsAllowed: false });
    assert.equal(disabled.enabledTools.length, 0); assert(!disabled.llmMessages.some(message => message._debugMeta?.marker === 'listening_capability'));

    // The public generator overrides stream mode on a copy, even for sessions
    // whose normal messages deliberately use non-streaming output.
    history = reset();
    const wrapper = { pendingListeningInvite: fast.pendingListeningInvite,
        generateChatCompletionCore: async s => { assert.equal(s.streamOnline, true); return { parts: [] }; },
    };
    vm.createContext(wrapper);
    vm.runInContext(ts.transpileModule(extract('lib/chat-engine.ts', 'generateChatCompletion'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, wrapper);
    await wrapper.generateChatCompletion(session, history);
    assert.equal(session.streamOnline, false, 'persistent session settings remain unchanged');

    // Exercise the production background entry/collector while transport is open.
    history = reset();
    const events = [], saved = [];
    let releaseBackground, backgroundFirstChunk;
    let firstChunk = new Promise(resolve => { backgroundFirstChunk = resolve; });
    let backgroundTail = new Promise(resolve => { releaseBackground = resolve; });
    const background = {
        console, AbortController,
        CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
        window: { dispatchEvent: event => events.push(event) },
        backgroundReplyFiringSet: new Set(), backgroundReplyControllers: new Map(), backgroundReplyStreams: new Map(),
        backgroundGeneratingSessions: new Set(), cancelledBackgroundSessions: new Set(), firingSet: new Set(), cancelledWhileFiring: new Set(),
        loadChatSessions: () => [session], loadChatMessages: () => history, pendingListeningInvite: fast.pendingListeningInvite,
        isBackgroundGenerationCancelled: id => background.cancelledBackgroundSessions.has(id), cancelFollowUpBailout() {},
        generateChatCompletion: async (_session, _messages, options, callbacks) => {
            callbacks.onStreamDelta('[一起听:room-a:接受]'); backgroundFirstChunk();
            await Promise.race([backgroundTail, new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }))]);
            callbacks.onStreamDelta('\n你好。'); callbacks.onTextPart('[一起听:room-a:接受]\n你好。');
            return { parts: [] };
        },
        flattenCompletionResult: () => '', scheduleFollowUp() {},
        saveBackgroundCompletionRounds: async rounds => { saved.push(...rounds); return { hasVisible: true, stateValues: [] }; },
        pushChatMessage() { throw Error('unexpected background error message'); },
    };
    vm.createContext(background);
    for (const name of ['getBackgroundReplyStream', 'generateBackgroundCompletionRounds', 'cancelBackgroundGeneration', 'requestBackgroundChatReply']) vm.runInContext(ts.transpileModule(extract('lib/follow-up-service.ts', name), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, background);
    let reply = background.requestBackgroundChatReply(session.id);
    await firstChunk;
    assert.equal(saved.length, 0); assert.equal(background.getBackgroundReplyStream(session.id), '[一起听:room-a:接受]');
    assert.equal(events.filter(event => event.type === 'followup-stream').length, 1);
    assert.equal((await background.requestBackgroundChatReply(session.id)).skipped, 'already_running');
    releaseBackground(); assert.equal((await reply).ok, true); assert.equal(saved.length, 1);
    assert.equal(events.filter(event => event.type === 'followup-fired').length, 1);
    assert.equal(background.getBackgroundReplyStream(session.id), '');
    events.length = 0; saved.length = 0;
    firstChunk = new Promise(resolve => { backgroundFirstChunk = resolve; });
    backgroundTail = new Promise(resolve => { releaseBackground = resolve; });
    reply = background.requestBackgroundChatReply(session.id); await firstChunk;
    background.cancelBackgroundGeneration(session.id);
    assert.equal((await reply).skipped, 'cancelled'); assert.equal(saved.length, 0);
    assert.equal(background.backgroundReplyControllers.size, 0); assert.equal(background.backgroundReplyFiringSet.size, 0);
    assert.equal(events.filter(event => event.type === 'followup-fired').length, 1);

    // Group entry uses the same single streaming request, including when a model
    // ignores instructions and prints a text tool directive after consent.
    history = reset({ isGroup: true, userJoined: true, members: [{ characterId: 'char-a', status: 'invited' }, { characterId: 'char-b', status: 'invited' }] });
    const groupSession = { ...session, isGroup: true, participantIds: ['char-a', 'char-b'] };
    let groupCalls = 0;
    const groupText = '[甲]: [一起听:room-a:接受]\n你好。\n[乙]: [一起听:room-a:拒绝]\n[执行动作:不应执行({})]';
    const group = {
        console, pendingListeningInvite: fast.pendingListeningInvite, createListeningInviteStreamObserver: fast.createListeningInviteStreamObserver,
        buildGroupChatPromptMessages: async s => {
            assert.equal(s.streamOnline, true);
            return { llmMessages: [], config: {}, preset: null, regexes: [], enabledTools: [], nameToId: new Map([['甲', 'char-a'], ['乙', 'char-b']]), memberNames: ['甲', '乙'], userName: '用户', appTags: ['group_chat', 'text'] };
        },
        loadCharacters: () => [], nativeToolProtocolForConfig: () => false, isSessionStreamingEnabled: s => s.streamOnline,
        sendLLMStreamRequest: async (_config, _preset, _messages, _regexes, _meta, options, callbacks) => {
            groupCalls++; assert.equal(options.immediateContent, true); callbacks.onDelta(groupText);
            assert.equal(applied.length, 2, 'both members decide before stream completion');
            return { content: groupText };
        },
        throwIfAborted() {}, stripPresetTexts: text => text, stripStateAndInnerForPrompt: text => text,
        parseToolFetches() { throw Error('must not fetch tools during invitation'); }, parseToolCalls() { throw Error('must not execute tools during invitation'); },
        parseActionTags: text => ({ cleanText: text, actions: [] }),
    };
    vm.createContext(group);
    for (const name of ['parseGroupChatResponse', 'generateGroupChatCompletion']) vm.runInContext(ts.transpileModule(extract('lib/group-chat-engine.ts', name), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, group);
    const groupResult = await group.generateGroupChatCompletion(groupSession, history, {}, { skipMemorySummarization: true });
    assert.equal(groupResult.length, 2); assert.equal(groupCalls, 1); assert.equal(groupSession.streamOnline, false);
    console.log('PASS: consent before response tail; chunk/refusal/cancellation/identity/group boundaries; hidden markers; real prompt builder preserves persona/worldbooks/memories and bypasses images/vector network/tools only for invitations');
})().catch(error => { console.error(error); process.exitCode = 1; });
