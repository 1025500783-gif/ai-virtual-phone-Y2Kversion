// Real assembler and Moments engine, synthetic storage/model sinks; no paid requests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, expose = '') {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + expose, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, Intl, console, require: name => mocks[name] || {} }, { filename: file });
    return exports;
}
const defaults = load('lib/bilingual-prompt-defaults.ts');
const bilingual = load('lib/moments-bilingual.ts', { './bilingual-prompt-defaults': defaults });
const parser = load('lib/bilingual-text.ts');
const time = load('lib/character-time.ts');
const macro = load('lib/macro-engine.ts', { './character-time': time });
const promptTime = load('lib/prompt-time.ts', {
    './character-time': time, './chat-storage': { loadChatAppSettings: () => ({ timeAware: false }) },
});
const tags = load('lib/content-tag-utils.ts', {
    './settings-types': load('lib/settings-types.ts'), './checkphone-config': { CHECKPHONE_TAG_PROFILES: [] },
});
const builtIn = load('lib/builtin-preset.ts', {
    './chat-cadence': load('lib/chat-cadence.ts'),
    './checkphone-config': { getCheckPhonePromptTags: () => ['checkphone'] },
}).createBuiltinPreset();
let config = { bilingualTranslationEnabled: true, bilingualTranslationPrompt: '', npcReactionDelayMin: 1 };
const assembler = load('lib/llm-prompt-assembler.ts', {
    './listen-together': { listeningRoomPrompt: () => '' },
    './music-listening': load('lib/music-listening.ts'),
    './macro-engine': macro, './character-time': time, './prompt-time': promptTime,
    './content-tag-utils': tags,
    './preset-scope': load('lib/preset-scope.ts', { './content-tag-utils': tags }),
    './prompt-sanitizer': load('lib/prompt-sanitizer.ts'),
    './character-world-storage': { formatCharacterRelationsForPrompt: () => '' },
    './dwelling-storage': { readDwellingLayoutCache: () => null },
    './voice-expression': { voiceExpressionInstruction: () => '' },
    './chat-quotation': load('lib/chat-quotation.ts'),
    './currency-context': { walletCurrencyInstruction: () => '', CHARACTER_CURRENCY_INSTRUCTION: '' },
    './transfer-protocol': { TRANSFER_CURRENCY_GUIDANCE: '' },
    './photo-album-discussion': { albumChatContext: () => '' },
    './memory-storage': { loadMemoryConfig: () => ({ cognitionEnabled: false }) },
    './moments-storage': { loadMomentsConfig: () => config },
    './moments-bilingual': bilingual,
});
const char = { id: 'test-char', name: 'Test', persona: 'Speaks English.', avatar: '' };
const custom = { ...builtIn, builtIn: false, name: 'Custom without bilingual macro', prompt_order: undefined,
    prompts: [{ identifier: 'custom', role: 'system', enabled: true, content: 'Use [朋友圈]body[/朋友圈].' }] };
const input = (preset, task, enabled = true, customPrompt = '') => ({
    character: char, history: [], worldBooks: [], regexes: [], preset,
    appId: 'moments', appTags: ['moments', task], userIdentity: { id: 'user-a', name: 'User' },
    chatBilingualInstruction: bilingual.buildMomentsBilingualInstruction(enabled, customPrompt), timeAware: false,
});
const text = messages => messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
const countRule = messages => text(messages).split(defaults.DEFAULT_MOMENTS_BILINGUAL_PROMPT).length - 1;
for (const preset of [builtIn, custom, null]) {
    for (const task of ['post', 'comment', 'reply', 'npc', 'npc_reply']) {
        const messages = assembler.assemblePromptPayload(input(preset, task));
        assert.equal(countRule(messages), 1, `${preset?.name}/${task}: exactly one complete rule`);
        assert.equal(countRule(assembler.assemblePromptPayload(input(preset, task, false))), 0);
    }
}
const oldPrompt = '【仅非中文角色使用】正文原文|中文译文；译文保留口语。';
for (const preset of [builtIn, custom]) {
    const messages = assembler.assemblePromptPayload(input(preset, 'post', true, oldPrompt));
    assert.ok(text(messages).includes(oldPrompt), 'saved custom prompt retained');
    assert.equal(countRule(messages), 1, 'old prompt upgraded without duplicate guard');
}
// A user-role macro must not suppress the system protocol; previews and execution share the assembler.
const userMacro = { ...custom, prompts: [{ ...custom.prompts[0], role: 'user', content: '{{chatBilingualInstruction}}' }] };
assert.equal(countRule(assembler.assemblePromptPayload(input(userMacro, 'post'))), 1);
for (const appId of ['chat', 'group_chat']) {
    const online = assembler.assemblePromptPayload({ ...input(custom, 'post'), appId, appTags: [appId, 'text'], chatBilingualInstruction: '' });
    assert.equal(countRule(online), 1, 'cross-engine post gets independent Moments translation');
    config.bilingualTranslationEnabled = false;
    assert.equal(countRule(assembler.assemblePromptPayload({ ...input(custom, 'post'), appId, appTags: [appId, 'text'] })), 0);
    config.bilingualTranslationEnabled = true;
    assert.equal(countRule(assembler.assemblePromptPayload({ ...input(custom, 'post'), appId, appTags: [appId, 'offline'] })), 0);
}
const group = assembler.assembleGroupPromptPayload({
    members: [{ character: char, worldBooks: [], regexes: [], currentStateValues: [] }],
    history: [], preset: builtIn, regexes: [], appTags: ['group_chat', 'text'], timeAware: false,
});
assert.equal(countRule(group), 1, 'real group assembler covers member-attributed Moments actions');
const noActions = { ...custom, prompts: [{ ...custom.prompts[0], content: 'Reply in normal chat.' }] };
const quotation=load('lib/chat-quotation.ts');
function assertQuotation(messages, enabled) {
 const blocks=messages.filter(m=>m._debugMeta?.marker?.includes('chat_quotation'));
 assert.equal(blocks.length,1,'one independent quotation block');
 assert.ok(blocks[0].content.includes(quotation.CHAT_QUOTATION_STYLE_INSTRUCTION));
 assert.equal(text(messages).split(quotation.CHAT_QUOTATION_STYLE_INSTRUCTION).length-1,1);
 assert.equal(blocks[0].content.includes(quotation.CHAT_QUOTATION_TRANSLATION_INSTRUCTION),enabled!==false);
}
for(const enabled of [undefined,true,false]) for(const tags of [['chat','text'],['chat','voice'],['chat','offline']]) for(const preset of [builtIn,noActions,null]) {
 assertQuotation(assembler.assemblePromptPayload({...input(preset,'post',false),appId:'chat',appTags:tags,chatBilingualInstruction:'',quoteTranslationEnabled:enabled}),enabled);
 assertQuotation(assembler.assembleGroupPromptPayload({members:[{character:char,worldBooks:[],regexes:[],currentStateValues:[]}],history:[],preset,regexes:[],appTags:tags.map(t=>t==='chat'?'group_chat':t),timeAware:false,quoteTranslationEnabled:enabled}),enabled);
}
assert.equal(assembler.assemblePromptPayload(input(noActions,'post')).filter(m=>m._debugMeta?.marker==='chat_quotation').length,0,'no chat rule in Moments');
assert.equal(countRule(assembler.assemblePromptPayload({ ...input(noActions, 'post'), appId: 'chat', appTags: ['chat', 'text'] })), 0);
const rule = defaults.DEFAULT_MOMENTS_BILINGUAL_PROMPT;
assert.match(rule, /中文正文仅夹少量外语词或专名.*今天真的很chill.*无需译文/);
assert.match(rule, /独立的完整外文句子仍须翻译/);
assert.match(rule, /主要表达语言判断，不按角色国籍/);

const requests = [], posts = [], comments = [];
const seed = { id: 'post-1', authorType: 'character', authorId: char.id, content: 'Rain again.|又下雨了。', createdAt: new Date().toISOString(), likes: [] };
const trigger = { id: 'comment-1', postId: seed.id, authorType: 'user', authorId: 'user', content: '出门带伞。', createdAt: new Date().toISOString() };
let selectedPreset = custom;
let response = '[朋友圈]Today was really chill.|今天真的很轻松。[/朋友圈]';
const visibility = {
    formatCharacterRelationsForPrompt: () => '',
    getVisibleMomentCommentsForCharacter: (_post, _id, list) => list,
    getVisibleMomentLikesForCharacter: (_post, _id, list) => list,
    isMomentRealCharacterAllowedForPost: () => true, isMomentRealCharacterAllowedForViewer: () => true,
};
const engine = load('lib/moments-engine.ts', {
    './moments-bilingual': bilingual, './llm-prompt-assembler': assembler,
    './character-storage': { loadInteractableCharacters: () => [char] },
    './chat-storage': { loadChatContacts: () => [{ characterId: char.id }] },
    './moments-storage': {
        loadMomentsConfig: () => config, loadMomentPosts: () => [seed], loadMomentComments: () => [trigger],
        updateScheduleAfterPost: () => {}, findRecentDuplicateMomentPost: () => null,
        addMomentPost: post => { const saved = { ...post, id: 'created', createdAt: new Date().toISOString(), likes: [] }; posts.push(saved); return saved; },
        addMomentComment: comment => comments.push(comment), addPendingReaction: () => {},
    },
    './settings-storage': {
        loadBindingConfig: () => ({}), resolveBinding: () => ({ apiConfigId: 'fake', presetId: selectedPreset.id }),
        loadApiConfigs: () => [{ id: 'fake', defaultModel: 'fake' }], loadPresets: () => [selectedPreset],
        loadWorldBooks: () => [], loadRegexes: () => [], resolveUserIdentity: () => ({ id: 'user-a', name: 'User' }),
    },
    './memory-storage': { loadMemoryConfig: () => ({ cognitionEnabled: false }), incrementEventCounter: () => {} },
    './memory-service': { retrieveCoreMemoriesForPrompt: async () => [], retrieveMemoriesForPrompt: async () => [] },
    './memory-injector': { formatCoreMemories: () => '', formatLongTermMemories: () => '' },
    './memory-summarizer': { maybeRunSummarization: async () => {} },
    './short-term-assembler': { prepareShortTermContext: () => ({ recentBlocks: [], unifiedRecentItems: [], wbActivationContext: '' }) },
    './calendar-storage': { buildCalendarScheduleMarker: () => '' }, './calendar-utils': { getWeekStartIso: () => '' },
    './custom-sticker-storage': { getCustomStickerNames: () => '', getCustomStickerExample: () => '' },
    './action-parser': { parseActionTags: cleanText => ({ cleanText, actions: [] }) },
    './character-world-storage': visibility,
    './moments-comment-threading': load('lib/moments-comment-threading.ts'),
    './chat-engine': { previewMessagesForApi: (_api, _preset, messages) => messages,
        sendLLMRequest: async (_api, _preset, messages) => { requests.push(messages); return response; } },
}, '\nexport const testPaths = { triggerAIPost, generateAIComment, generateTargetedNPCReply, triggerCharacterReply, generateNPCReactionsViaLLM };');
(async () => {
    for (const preset of [custom, builtIn]) {
        selectedPreset = preset;
        const preview = await engine.previewMomentsPostPrompt(char.id);
        await engine.testPaths.triggerAIPost(char.id);
        assert.equal(text(requests.at(-1)), text(preview.messages), 'actual post and preview match');
        assert.equal(countRule(requests.at(-1)), 1);
    }
    selectedPreset = custom;
    response = '[评论]Bring an umbrella.|带把伞。[/评论]';
    const commentPreview = await engine.previewMomentsCommentPrompt(char.id, seed.id);
    await engine.testPaths.generateAIComment(seed, char);
    assert.equal(text(requests.at(-1)), text(commentPreview.messages));
    response = '[回复 User]I will.|我会的。[/回复]';
    const replyPreview = await engine.previewMomentsReplyPrompt(char.id, seed.id);
    await engine.testPaths.triggerCharacterReply(seed, char.id, [trigger]);
    assert.equal(text(requests.at(-1)), text(replyPreview.messages));
    response = '[不回复]';
    const npcPreview = await engine.previewMomentsNPCPrompt(char.id, seed.id);
    await engine.testPaths.generateNPCReactionsViaLLM(seed, char);
    assert.equal(text(requests.at(-1)), text(npcPreview.messages));
    await engine.testPaths.generateTargetedNPCReply(seed, char, trigger, 'NPC');
    assert.equal(countRule(requests.at(-1)), 1);
    assert.equal(posts.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(parser.splitBilingualText(posts[0].content))), { original: 'Today was really chill.', translated: '今天真的很轻松。' });
    assert.equal(parser.splitBilingualText('今天真的很chill'), null);
    for (const saved of comments) assert.ok(parser.splitBilingualText(saved.content), 'saved comment/reply retains its translation');
    for (const original of ['GOOD NIGHT.', '今日は静かな一日。', 'Rain again.\nStill heading out.']) {
        const parsed = engine.parseMomentPostResponse(`[朋友圈]${original}|今天很安静。\n还是出门了。\n[照片:不使用参考图:Rainy window.|下雨的窗户。][/朋友圈]`);
        assert.equal(parser.splitBilingualText(parsed.content).original, original);
        assert.equal(parser.splitBilingualText(parsed.photoDescription).original, 'Rainy window.');
    }
    const before = requests.length;
    config.bilingualTranslationEnabled = false;
    await engine.testPaths.generateAIComment(seed, char);
    assert.equal(countRule(requests.at(-1)), 0);
    assert.equal(requests.length, before + 1, 'no hidden translation call');
    console.log(`PASS: real assembler default/custom/no preset, five Moments tasks and previews, chat/group actions, saved bilingual text, Chinese with chill, protocol/photo parsing, disabled switch, no duplicate or extra requests (${requests.length} fake calls).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
