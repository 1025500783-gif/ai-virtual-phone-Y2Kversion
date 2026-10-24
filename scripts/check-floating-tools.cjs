// Synthetic settings and the actual binding resolver; no browser data or network.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const plain=v=>JSON.parse(JSON.stringify(v));
function load(file,requireFn=()=>({})){
 const box={exports:{},require:requireFn,window:undefined};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,box);
 return box.exports;
}
const tools=load('lib/floating-tools.ts');
for(const old of [{},{promptViewerEnabled:true},{quickActionEnabled:true},{promptViewerEnabled:true,quickActionEnabled:true}]){
 assert.equal(tools.isCombinedToolsEnabled(old),false);
 const settings={...old,timeAware:true};
 const next=tools.changeFloatingTool(settings,'floatingToolsEnabled',true);
 assert(tools.isCombinedToolsEnabled(next));
 assert.equal(next.promptViewerEnabled,false);assert.equal(next.quickActionEnabled,false);
 assert.equal(next.timeAware,true);
 for(const key of ['promptViewerEnabled','quickActionEnabled']){
  const legacy=tools.changeFloatingTool(next,key,true);
  assert.equal(legacy[key],true);assert.equal(legacy.floatingToolsEnabled,false);
 }
 const off=tools.changeFloatingTool(next,'floatingToolsEnabled',false);
 assert.equal(off.promptViewerEnabled,false);assert.equal(off.quickActionEnabled,false);
}
assert(tools.changeFloatingTool({promptViewerEnabled:true},'quickActionEnabled',true).quickActionEnabled);
const storage=load('lib/settings-storage.ts',id=>new Proxy({}, {get:(_,key)=>key==='getCharacterWorldGroup'?()=>({worldBookIds:['inherited-world']}):key==='isIdentityInitialized'?()=>false:()=>undefined}));
const original={globalDefaults:{apiConfigId:'global-api',worldBookIds:['global-book']},appDefaults:{story:{apiConfigId:'story-api'}},characterBindings:[{characterId:'a',defaults:{presetId:'persona',worldBookIds:['character-book']},appOverrides:{chat:{regexIds:['keep-regex']}}}]};
assert.deepEqual(plain(storage.resolveBinding(original,'a','chat').worldBookIds),['character-book']);
const updated=tools.updateFloatingBinding(original,{appId:'chat',characterId:'a'},{apiConfigId:'chat-api',worldBookIds:[],worldBookMode:'replace'});
assert.equal(storage.resolveBinding(updated,'a','chat').apiConfigId,'chat-api');
assert.deepEqual(plain(storage.resolveBinding(updated,'a','chat').worldBookIds),[]);
assert.equal(storage.resolveBinding(updated,'a','chat').presetId,'persona');
assert.deepEqual(plain(storage.resolveBinding(updated,'a','chat').regexIds),['keep-regex']);
assert.deepEqual(plain(storage.resolveBinding(updated,'a','story')),plain(storage.resolveBinding(original,'a','story')));
assert.deepEqual(plain(storage.resolveBinding(updated,'b','chat')),plain(storage.resolveBinding(original,'b','chat')));
assert.equal(original.characterBindings[0].appOverrides.chat.apiConfigId,undefined);
const selected=tools.updateFloatingBinding(updated,{appId:'chat',characterId:'a'},{worldBookIds:['chosen']});
assert.deepEqual(plain(storage.resolveBinding(selected,'a','chat').worldBookIds),['chosen']);
const reset=tools.updateFloatingBinding(updated,{appId:'chat',characterId:'a'},{worldBookIds:undefined,worldBookMode:undefined,apiConfigId:undefined});
assert.deepEqual(plain(storage.resolveBinding(reset,'a','chat')),plain(storage.resolveBinding(original,'a','chat')));
const legacyEmpty=tools.updateFloatingBinding(original,{appId:'chat',characterId:'a'},{worldBookIds:[]});
assert.deepEqual(plain(storage.resolveBinding(legacyEmpty,'a','chat').worldBookIds),['character-book']);
const appDefault=tools.updateFloatingBinding(original,{appId:'calendar'},{worldBookIds:[],worldBookMode:'replace'});
assert.deepEqual(plain(storage.resolveBinding(appDefault,'a','calendar').worldBookIds),[]);
const charOverride=tools.updateFloatingBinding(appDefault,{appId:'calendar',characterId:'a'},{worldBookIds:['override-book']});
assert.deepEqual(plain(storage.resolveBinding(charOverride,'a','calendar').worldBookIds),['override-book']);
// The scene request path consumes the same resolver, including explicit empty books.
const storySource=fs.readFileSync('lib/story-engine.ts','utf8');
const storyAst=ts.createSourceFile('story.ts',storySource,ts.ScriptTarget.Latest,true);
const storyFunction=storyAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='resolveStoryConfigs');
let storyBindings=tools.updateFloatingBinding(original,{appId:'story',characterId:'a'},{apiConfigId:'scene-api',worldBookIds:[],worldBookMode:'replace'});
const storyBox={exports:{},loadCharacters:()=>[{id:'a',name:'QA'}],loadBindingConfig:()=>storyBindings,resolveBinding:storage.resolveBinding,loadApiConfigs:()=>[{id:'scene-api'},{id:'story-api'}],loadPresets:()=>[],loadRegexes:()=>[],loadWorldBooks:()=>[{id:'chosen'},{id:'inherited-world'}],ChatEngineError:Error};
vm.runInNewContext(ts.transpileModule(storyFunction.getText(storyAst),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nexports.resolveStoryConfigs=resolveStoryConfigs;',storyBox);
assert.equal(storyBox.exports.resolveStoryConfigs('a').apiConfig.id,'scene-api');
assert.equal(storyBox.exports.resolveStoryConfigs('a').worldBooks.length,0);
storyBindings=tools.updateFloatingBinding(storyBindings,{appId:'story',characterId:'a'},{worldBookIds:['chosen']});
assert.deepEqual(plain(storyBox.exports.resolveStoryConfigs('a').worldBooks),[{id:'chosen'}]);
console.log('PASS floating tools: opt-in/default preservation, mutual exclusion, legacy pair allowed, scoped API and books, explicit empty vs legacy inheritance, reset, app/character isolation, unrelated binding fields retained.');
console.log('PASS actual public Story configuration resolver: selected API and books, explicit no-book selection. No model calls.');
const context=load('lib/floating-tools-context.ts');
const releaseOld=context.registerFloatingPageContext({ownerApp:'chat',appId:'chat',characterId:'a',sessionId:'old',label:'old'});
const releaseNew=context.registerFloatingPageContext({ownerApp:'chat',appId:'chat',characterId:'b',sessionId:'new',label:'new'});
releaseOld();assert.equal(context.getFloatingPageContext().sessionId,'new');
const ui=ts.createSourceFile('floating.tsx',fs.readFileSync('components/floating-tools.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let override;
function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ui)==='override')override=node.initializer.getText(ui);ts.forEachChild(node,find);}find(ui);
const current=context.getFloatingPageContext();assert.equal(vm.runInNewContext(override,{nested:current,activeApp:'chat',chatSession:{id:'old'}}),null,'Cached other session must not override current chat');
assert.equal(vm.runInNewContext(override,{nested:current,activeApp:'settings',chatSession:{id:'new'}}),null,'Cached chat must not override settings');
assert.equal(vm.runInNewContext(override,{nested:current,activeApp:'chat',chatSession:{id:'new'}}),current);releaseNew();assert.equal(context.getFloatingPageContext(),null);
console.log('PASS nested context lifecycle and actual UI scope: old unmount, cached other session, settings navigation and current session.');
