// Production matchers, assembler, importers and provider builders; synthetic data, no network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const cache=new Map();
const real=new Set(['settings-types','content-tag-utils','checkphone-config','preset-scope','preset-order','generation-parameters',
 'builtin-preset','chat-cadence','chat-forward-protocol','llm-provider-adapter','api-helpers','preset-entry-import',
 'settings-storage','macro-engine','character-time','prompt-time','prompt-sanitizer','llm-prompt-assembler',
 'moments-bilingual','bilingual-prompt-defaults','music-listening','chat-quotation']);
const mocks={
 'kv-db':{registerKvMigration(){},kvGet(){return null;},kvSet(){}},
 'settings-db':{},'identity-runtime':{},'identity-lifecycle':{},
 'chat-storage':{loadChatAppSettings:()=>({timeAware:false})},
 'character-world-storage':{formatCharacterRelationsForPrompt:()=>''},
 'dwelling-storage':{readDwellingLayoutCache:()=>null},
 'listen-together':{listeningRoomPrompt:()=>''},
 'voice-expression':{voiceExpressionInstruction:()=>''},
 'currency-context':{walletCurrencyInstruction:()=>'',CHARACTER_CURRENCY_INSTRUCTION:''},
 'transfer-protocol':{TRANSFER_CURRENCY_GUIDANCE:''},
 'photo-album-discussion':{albumChatContext:()=>''},
 'memory-storage':{loadMemoryConfig:()=>({cognitionEnabled:false})},
 'moments-storage':{loadMomentsConfig:()=>({bilingualTranslationEnabled:false})},
};
function load(name){if(cache.has(name))return cache.get(name);if(mocks[name])return mocks[name];if(!real.has(name))return {};
 const exports={};cache.set(name,exports);
 const source=fs.readFileSync(path.join(__dirname,'../lib',name+'.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:id=>load(id.split('/').at(-1)),URL,Intl,console,window:undefined},{filename:name});return exports;}
const scope=load('preset-scope'),tags=load('content-tag-utils'),builtin=load('builtin-preset').createBuiltinPreset();
const roundtrip=value=>JSON.parse(JSON.stringify(value));
const plain={identifier:'qa',name:'QA',role:'system',content:'UNIQUE_SCOPE_SENTINEL',enabled:true,injection_depth:0,tags:['chat','text']};
const multi={...plain,...scope.togglePromptScope(plain,['group_chat','text'])};
for(const active of [['chat','text'],['group_chat','text']])assert(scope.matchesPromptScope(multi,active));
for(const active of [['chat','voice'],['group_chat'],['moments','text']])assert(!scope.matchesPromptScope(multi,active));
const universal={...multi,...scope.togglePromptScope(multi,[])};
assert.deepEqual(roundtrip(scope.getPromptScopes(universal)),[[]]);
for(const active of [[],['unknown'],['chat','voice']])assert(scope.matchesPromptScope(universal,active));
const fromUniversal={...universal,...scope.togglePromptScope(universal,['moments'])};
assert(!scope.matchesPromptScope(fromUniversal,['chat']));
assert(scope.matchesPromptScope(fromUniversal,['moments','reply']));
const chatSource=fs.readFileSync(path.join(__dirname,'../lib/chat-engine.ts'),'utf8');
const toolGateSource=chatSource.slice(chatSource.indexOf('function isPresetPromptEnabled('),chatSource.indexOf('const EMPTY_GENERATE_CONTINUATION_PROMPT'));
const toolGate={exports:{},matchesPromptScope:scope.matchesPromptScope};
vm.runInNewContext(ts.transpileModule(toolGateSource+'\nexports.includes=presetIncludesToolsMacro;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,toolGate);
const toolsPreset={prompts:[{...multi,content:'{{tools}}'}]};
assert(toolGate.exports.includes(toolsPreset,'group_chat',['group_chat','text']));
assert(!toolGate.exports.includes(toolsPreset,'moments',['moments']));
const overlap={...plain,scopeAlternatives:[['chat'],['chat','text'],['group_chat']]};
const before=JSON.stringify(builtin);
for(const p of builtin.prompts)for(const active of tags.CONTENT_SCOPE_TAG_PROFILES.map(p=>p.tags)){
 assert.equal(scope.matchesPromptScope(p,active),tags.getPromptTags(p).every(tag=>active.includes(tag)),p.identifier);
}
assert.equal(JSON.stringify(builtin),before,'default preset untouched');
const storage=load('settings-storage'),entry=load('preset-entry-import');
const custom={...builtin,id:'qa',builtIn:false,enabled_generation_parameters:[],prompts:[multi],prompt_order:[{identifier:'qa',enabled:true}]};
const imported=storage.parsePresetFromJson(JSON.stringify(custom));
assert.deepEqual(roundtrip(imported.prompts[0].scopeAlternatives),[['chat','text'],['group_chat','text']]);
assert.deepEqual(roundtrip(imported.enabled_generation_parameters),[]);
assert.deepEqual(roundtrip(entry.sanitizePromptEntry(multi,'fallback').scopeAlternatives),roundtrip(multi.scopeAlternatives));
assert.equal(scope.normalizeScopeAlternatives([['chat'],[42]]),undefined);
const assembler=load('llm-prompt-assembler');
const character={id:'qa-character',name:'QA',persona:'',avatar:''};
const base={character,history:[],worldBooks:[],regexes:[],timeAware:false,userIdentity:{id:'qa-user',name:'QA user'}};
for(const active of [['chat','text'],['group_chat','text'],['moments','post']]){
 const preset={...custom,prompts:[overlap,overlap],prompt_order:[{identifier:'qa',enabled:true},{identifier:'qa',enabled:true}]};
 const result=assembler.assemblePromptPayload({...base,preset,appId:active[0],appTags:active});
 const count=JSON.stringify(result).split('UNIQUE_SCOPE_SENTINEL').length-1;
 assert.equal(count,active[0]==='moments'?0:1,'one injection even with overlapping OR scopes');
 const noOrder=assembler.assemblePromptPayload({...base,preset:{...preset,prompt_order:undefined},appId:active[0],appTags:active});
 assert.equal(JSON.stringify(noOrder).split('UNIQUE_SCOPE_SENTINEL').length-1,count);
}
const order=load('preset-order');
const editorIdSource=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/preset-order.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const editorIds=crypto=>{
 const exports={};
 vm.runInNewContext(editorIdSource,{exports,require:()=>({}),crypto,Date:{now:()=>1700000000000},Math:{random:()=>.5}});
 return exports.createPresetEditorId;
};
assert.equal(editorIds({randomUUID:()=> 'secure-uuid'})('prompt'),'prompt-secure-uuid');
let randomCounter=0;
const lanId=editorIds({getRandomValues:words=>{words.fill(++randomCounter);return words;}});
assert.equal(new Set(Array.from({length:1000},()=>lanId('group'))).size,1000,'HTTP LAN path must produce distinct group IDs');
const fallbackId=editorIds(undefined);
assert.equal(new Set(Array.from({length:1000},()=>fallbackId('prompt'))).size,1000,'no-crypto fallback must remain distinct within one millisecond');
console.log('PASS editor IDs on secure origin, HTTP LAN without randomUUID, and no-crypto fallback.');
for(const active of [['group_chat','text'],['group_chat','voice']]){
 const result=assembler.assembleGroupPromptPayload({
   members:[{character,worldBooks:[]}],history:[],preset:{...custom,prompts:[multi]},
   regexes:[],appTags:active,userIdentity:base.userIdentity,timeAware:false,
 });
 assert.equal(JSON.stringify(result).split('UNIQUE_SCOPE_SENTINEL').length-1,active.includes('text')?1:0,'real group assembly respects scope OR');
}
const prompts=['a','b','c','d','e'].map(identifier=>({...plain,identifier}));
assert.deepEqual(roundtrip(order.movePresetPrompts(prompts,['b','c'],['e'],true).map(p=>p.identifier)),['a','d','e','b','c']);
assert.deepEqual(roundtrip(order.movePresetPrompts(prompts,['d','e'],['a','b'],false).map(p=>p.identifier)),['d','e','a','b','c']);
assert.equal(order.movePresetPrompts(prompts,['b','c'],['b'],true),prompts);
const scattered = [
 {...plain,identifier:'one'}, {...plain,identifier:'two',tags:['moments']},
 {...plain,identifier:'three',tags:['chat','voice']},
];
const scatteredSnapshot = JSON.stringify(scattered);
assert.deepEqual(roundtrip(order.groupPresetPrompts(scattered).map(g=>[g.key,g.prompts.map(p=>p.identifier)])),
 [['chat',['one','three']],['moments',['two']]]);
assert.equal(JSON.stringify(scattered),scatteredSnapshot,'grouping must not reorder or mutate stored prompts');
const regrouped=order.movePresetEntryToGroup(scattered,'three','moments',['two'],false);
assert.deepEqual(roundtrip(regrouped.map(p=>p.identifier)),['one','three','two']);
assert.equal(order.presetDisplayGroupKey(regrouped[1]),'moments');
assert(scope.matchesPromptScope(regrouped[1],['chat','voice']));
assert(!scope.matchesPromptScope(regrouped[1],['moments']));
const manualImport=storage.parsePresetFromJson(JSON.stringify({...custom,prompts:regrouped}));
assert.equal(manualImport.prompts.find(p=>p.identifier==='three').displayGroup,'moments');
assert.equal(entry.sanitizePromptEntry(regrouped[1],'fallback').displayGroup,'moments');
let clickOrder={...plain,scopeAlternatives:[['moments'],['chat','text']]};
clickOrder={...clickOrder,...scope.togglePromptScope(clickOrder,['moments'])};
clickOrder={...clickOrder,...scope.togglePromptScope(clickOrder,['moments'])};
assert.deepEqual(roundtrip(clickOrder.scopeAlternatives),[['chat','text'],['moments']]);
assert.equal(order.presetDisplayGroupKey(clickOrder),'chat');
const groupedPreset={...custom,prompts:scattered,prompt_order:scattered.map((p,i)=>({identifier:p.identifier,enabled:i!==1}))};
const renamedPreset={...groupedPreset,...order.renamePresetGroup(groupedPreset,'chat','EDITOR_ONLY_SENTINEL')};
assert.equal(renamedPreset.displayGroups[0].name,'EDITOR_ONLY_SENTINEL');
assert.equal(JSON.stringify(renamedPreset.prompts),JSON.stringify(groupedPreset.prompts));
const namedPayload=assembler.assemblePromptPayload({...base,preset:renamedPreset,appId:'chat',appTags:['chat','text']});
assert(!JSON.stringify(namedPayload).includes('EDITOR_ONLY_SENTINEL'),'group names are never injected');
const dissolved={...renamedPreset,...order.dissolvePresetGroup(renamedPreset,'chat')};
assert.deepEqual(roundtrip(dissolved.prompt_order),roundtrip(groupedPreset.prompt_order),'dissolving preserves injection order and enabled state');
assert.equal(order.groupPresetPrompts(dissolved.prompts).length,3,'dissolved entries cannot auto-regroup');
assert.equal(dissolved.prompts[0].displayGroup,null);
assert(scope.matchesPromptScope(dissolved.prompts[0],['chat','text']));
const dissolvedImport=storage.parsePresetFromJson(JSON.stringify(dissolved));
assert.equal(dissolvedImport.prompts[0].displayGroup,null);
assert.equal(entry.sanitizePromptEntry(dissolved.prompts[0],'fallback').displayGroup,null);
const namedImport=storage.parsePresetFromJson(JSON.stringify(renamedPreset));
assert.equal(namedImport.displayGroups[0].name,'EDITOR_ONLY_SENTINEL');
const frozen=order.preparePresetGroups({...groupedPreset,builtIn:true});
assert.equal(frozen.groupingVersion,1);
assert.equal(frozen.prompts[0].displayGroup,'chat');
assert.equal(frozen.prompts[1].displayGroup,null);
const changedScope={...frozen.prompts[0],tags:['moments'],scopeAlternatives:undefined};
assert.equal(order.presetDisplayGroupKey(changedScope),'chat','scope editing must never change manual group');
const freshImport=order.preparePresetGroups({...groupedPreset,builtIn:false});
assert(freshImport.prompts.every(prompt=>prompt.displayGroup===null),'custom presets never auto-group by App');
const frozenRoundtrip=storage.parsePresetFromJson(JSON.stringify(frozen));
assert.equal(frozenRoundtrip.groupingVersion,1);
const deleted={...renamedPreset,...order.deletePresetGroup(renamedPreset,'chat')};
assert.deepEqual(roundtrip(deleted.prompts.map(p=>p.identifier)),['two']);
assert.deepEqual(roundtrip(deleted.prompt_order),[{identifier:'two',enabled:false}]);
console.log('PASS: group names roundtrip independently, dissolve preserves scope/order and stays ungrouped, group deletion removes members and order entries.');
console.log('PASS: global display groups preserve injection order; cross-group moves preserve scope and import; selection click order.');
const adapter=load('llm-provider-adapter'),keys=load('generation-parameters').GENERATION_PARAMETER_KEYS;
const config=provider=>({provider,apiKey:'synthetic-not-a-key',defaultModel:'qa-model',enableImageRecognition:false});
const messages=[{role:'user',content:'synthetic'}];
const preset={...builtin,temperature:.45,top_p:.7,top_k:25,min_p:.1,top_a:.2,repetition_penalty:1.2,frequency_penalty:.3,presence_penalty:.4,openai_max_tokens:2048};
for(const provider of ['OpenAI','Anthropic','Google']){
 const cfg=config(provider),off=adapter.buildProviderRequest(cfg,{...preset,enabled_generation_parameters:[]},messages).body;
 const on=adapter.buildProviderRequest(cfg,{...preset,enabled_generation_parameters:[...keys]},messages).body;
 if(provider==='Google'){
   assert.deepEqual(roundtrip(off.generationConfig),{});
   assert.equal(on.generationConfig.temperature,.45);assert.equal(on.generationConfig.topP,.7);assert.equal(on.generationConfig.topK,25);assert.equal(on.generationConfig.maxOutputTokens,2048);
 }else{
   for(const key of keys.filter(k=>k!=='max_tokens'))assert(!(key in off),`${provider}: ${key} omitted`);
   assert.equal(on.temperature,.45);assert.equal(on.top_p,.7);assert.equal(on.max_tokens,2048);
   if(provider==='Anthropic'){assert(off.max_tokens>0);assert(!('presence_penalty'in on));}
   else {assert(!('max_tokens'in off));for(const key of keys)assert(key in on);}
 }
 const legacy=adapter.buildProviderRequest(cfg,preset,messages).body;
 assert.deepEqual(roundtrip(legacy),roundtrip(on),'legacy values remain effective');
 const budget=adapter.buildProviderRequest(cfg,{...preset,enabled_generation_parameters:[]},messages,{maxTokens:512}).body;
 assert.equal(provider==='Google'?budget.generationConfig.maxOutputTokens:budget.max_tokens,512,'per-task budget preserved');
}
console.log('PASS: default scope parity, OR/universal, once-only real assembly, import roundtrip, group moves, OpenAI/Anthropic/Gemini actual payloads and task budgets.');
for(const file of ['tools/weixin-local-assistant/assistant-core.mjs','public/weixin-local-assistant/assistant-core.mjs','public/weixin-local-assistant/cloud-function.mjs','supabase/functions/weixin-assistant/index.ts']){
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const start=source.indexOf('function buildChatCompletionRequest('),end=source.indexOf('\nfunction determineBaseUrl(',start);
 const sandbox={exports:{},determineBaseUrl:()=> 'https://synthetic.invalid/v1',buildChatCompletionsUrl:url=>url+'/chat/completions',
   numberOrDefault:(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback};
 vm.runInNewContext(source.slice(start,end)+'\nexports.build=buildChatCompletionRequest;',sandbox);
 const off=sandbox.exports.build(config('OpenAI'),{...preset,enabled_generation_parameters:[]},messages).body;
 assert.deepEqual(Object.keys(off).sort(),['messages','model']);
 const on=sandbox.exports.build(config('OpenAI'),{...preset,enabled_generation_parameters:[...keys]},messages).body;
 assert.equal(on.temperature,.45);assert.equal(on.max_tokens,2048);assert.equal(on.top_k,25);
}
console.log('PASS: local/cloud Weixin request controls and downloadable distribution copies.');

const bulkUpdates=order.assignPresetPromptsToGroup(groupedPreset,['one','two','unknown'],{id:'bulk-new',name:'  批量整理  '});
const bulkPreset={...groupedPreset,...bulkUpdates};
assert.equal(bulkUpdates.prompt_order,undefined,'bulk grouping cannot alter injection order');
assert.deepEqual(roundtrip(bulkPreset.prompt_order),roundtrip(groupedPreset.prompt_order));
for(const before of groupedPreset.prompts){
 const after=bulkPreset.prompts.find(p=>p.identifier===before.identifier);
 assert.deepEqual(roundtrip({...after,displayGroup:before.displayGroup}),roundtrip(before),'only membership changes');
}
assert.equal(bulkPreset.displayGroups.find(g=>g.id==='bulk-new').name,'批量整理');
const bulkExisting={...bulkPreset,...order.assignPresetPromptsToGroup(bulkPreset,['two'],{id:'bulk-new',name:'ignored'})};
assert.equal(bulkExisting.displayGroups.filter(g=>g.id==='bulk-new').length,1);
assert.equal(bulkExisting.displayGroups.find(g=>g.id==='bulk-new').name,'批量整理');
assert.deepEqual(roundtrip(order.assignPresetPromptsToGroup(groupedPreset,[],{id:'x',name:'X'})),{});
assert.deepEqual(roundtrip(order.assignPresetPromptsToGroup(groupedPreset,['one'],{id:'x',name:'  '})),{});
const bulkRoundtrip=storage.parsePresetFromJson(JSON.stringify(bulkPreset));
assert.deepEqual(roundtrip(bulkRoundtrip.displayGroups),roundtrip(bulkPreset.displayGroups));
assert.deepEqual(roundtrip(bulkRoundtrip.prompts.map(p=>p.displayGroup)),roundtrip(bulkPreset.prompts.map(p=>p.displayGroup)));
console.log('PASS: bulk group assignment preserves order, scope, content and enabled flags; existing/new groups roundtrip.');
