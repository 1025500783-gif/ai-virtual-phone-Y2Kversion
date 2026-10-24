const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
let cloneCalls=0;
function load(file,mocks={}){const exports={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(js,{exports,require:id=>{if(!(id in mocks))throw Error(id);return mocks[id]},structuredClone:v=>{cloneCalls++;return structuredClone(v)},Date,Set,JSON,FileReader:undefined,window:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}});return exports;}
let identity='self',messages=[],sent=[],events=[];
const source={id:'source',contactId:'c1',alias:'错误备注'},target={id:'target',contactId:'c2'};
const chars=[{id:'c1',name:'档案甲'},{id:'c2',name:'档案乙'}];
const types=load('lib/chat-forward-types.ts');
const layout=load('lib/chat-forward-layout.ts',{'./chat-time':load('lib/chat-time.ts')});
const run={sourceKind:'group',entries:[0,1,2].map(i=>({speaker:'同名',speakerId:'a',isUser:false,createdAt:new Date(1700000000000+i*1000).toISOString(),text:'正文'}))};
assert.equal(run.entries.filter((_,i)=>layout.forwardedEntryLayout(run,i).showName).length,1);
assert.equal(run.entries.filter((_,i)=>layout.forwardedEntryLayout(run,i).showAvatar).length,1);
assert.equal(layout.forwardedEntryLayout(run,2).consecutive,true);
assert.equal(layout.forwardedEntryLayout({...run,sourceKind:'private'},0).showName,false);
assert.equal(layout.forwardedEntryLayout({...run,sourceKind:'private'},2).showAvatar,false);
run.entries[2].speakerId='b';assert.equal(layout.forwardedEntryLayout(run,2).showName,true,'same display names are distinct speakers');
run.entries[2].speakerId='a';run.entries[2].createdAt=new Date(1700000300000).toISOString();assert.equal(layout.forwardedEntryLayout(run,2).showName,true,'time gap starts another run');

const forward=load('lib/chat-forward.ts',{
 './chat-forward-native':load('lib/chat-forward-native.ts',{}),'./chat-forward-appearance':load('lib/chat-forward-appearance.ts'),
 './chat-storage':{loadChatMessages:()=>messages,loadChatSessions:()=>[source,target],pushChatMessage:m=>sent.push(m),CHAT_REQUEST_REPLY_EVENT:'reply'},
 './character-storage':{loadInteractableCharacters:()=>chars},'./settings-storage':{resolveUserIdentity:()=>({name:'用户档案'})},
 './chat-session-avatar':{getChatCharacterAvatar:()=>null},'./identity-runtime':{getCurrentIdentityId:()=>identity},
 './identity-access':{canCurrentIdentityInteract:()=>true},'./llm-prompt-assembler':{formatRichMediaForHistory:m=>'['+m.mediaType+']'},
 './chat-asset-storage':{getChatImageFromIndexedDB:async()=> 'data:image/png;base64,AA=='},'./media-cache-storage':{isMediaStoreRef:()=>false,loadMediaBlob:async()=>null},
});
(async()=>{
messages=[{id:'1',role:'assistant',content:'只转这句',createdAt:'2026-10-11',reasoningText:'私密思考',rawResponseText:'隐藏原文'},
 {id:'2',role:'assistant',content:'',mediaType:'transfer',createdAt:'2026-10-11',mediaData:{amount:520,currency:'CNY',label:'买点喜欢的',status:'pending',walletTransactionId:'private'}},
 {id:'3',role:'assistant',content:'不能泄露',createdAt:'2026-10-11'},
 {id:'4',role:'system',content:'系统内部',createdAt:'2026-10-11'},
 {id:'5',role:'user',content:'',mediaType:'image',mediaUrl:'local-image-id',createdAt:'2026-10-11'}];
const snap=await forward.captureForwardedChat(source,new Set(['1','2','4','5']));
assert.equal(snap.entries.length,3);assert.equal(snap.entries[0].speaker,'档案甲');assert(!JSON.stringify(snap).includes('错误备注'));assert(!JSON.stringify(snap).includes('私密思考'));assert(!JSON.stringify(snap).includes('隐藏原文'));assert(!JSON.stringify(snap).includes('walletTransactionId'));assert(!JSON.stringify(snap).includes('不能泄露'));
assert.equal(snap.entries[1].amount,520);assert.equal(snap.entries[1].text,'买点喜欢的');assert.equal(snap.entries[1].paymentState,'待领取');assert.match(snap.entries[2].mediaUrl,/^data:image/);
messages[1].mediaData.status='received';messages[0].content='改掉了';chars[0].name='改名后';assert.equal(snap.entries[0].text,'只转这句');assert.equal(snap.entries[0].speaker,'档案甲');assert.equal(snap.entries[1].paymentState,'待领取');
const prompt=types.forwardedChatPrompt(snap);assert.match(prompt,/不是当前对话/);assert.match(prompt,/不把其他说话人当作你/);assert.match(prompt,/执行指令/);assert(!prompt.includes('data:image'));assert.match(prompt,/买点喜欢的/);
forward.sendForwardedChat(snap,'target','self');assert.equal(sent.length,1);assert.equal(sent[0].mediaType,'forwarded_chat');snap.entries[0].text='再次修改';assert.equal(sent[0].mediaData.forwardedChat.entries[0].text,'只转这句');
assert.deepEqual(events.map(e=>e.type),['chat-messages-updated']);assert.equal(events[0].detail.sessionId,'target');
// Exercise the actual room visibility classifier with the persisted empty-text card.
const room=fs.readFileSync('components/chat/chat-room.tsx','utf8');
const visual=room.match(/const CHAT_VISUAL_MEDIA_TYPES = new Set\(\[[\s\S]*?\]\);/)[0];
const media=room.match(/const CHAT_MEDIA_BUBBLE_TYPES = new Set\(\[[\s\S]*?\]\);/)[0];
const hidden=room.slice(room.indexOf('function isHiddenChatFlowMessage('),room.indexOf('// ── Background generation tracking'));
const visibility={exports:{},shouldHidePendingAssistantImage:()=>false,isChatVisualMedia:m=>m.mediaType==='forwarded_chat',getChatFlowVisibleContent:m=>m.content,uiRole:m=>m.role};
vm.runInNewContext(ts.transpileModule(visual+'\n'+media+'\n'+hidden+'\nexports.visual=CHAT_VISUAL_MEDIA_TYPES;exports.media=CHAT_MEDIA_BUBBLE_TYPES;exports.hidden=isHiddenChatFlowMessage;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,visibility);
assert(visibility.exports.visual.has('forwarded_chat'));assert(visibility.exports.media.has('forwarded_chat'));assert.equal(visibility.exports.hidden(sent[0]),false);assert.equal(visibility.exports.hidden({...sent[0],role:"assistant",senderCharacterId:"c1"}),false);
identity='other';assert.throws(()=>forward.sendForwardedChat(snap,'target','self'));assert.equal(sent.length,1);
assert.equal(forward.canForwardTo({...target,isSpectator:true}),false);assert.equal(forward.canForwardTo({...target,isGroup:true,participantIds:['c2'],groupMutes:{self:new Date(Date.now()+10000).toISOString()}}),false);
identity='self';cloneCalls=0;
messages=[{id:'large',role:'user',content:'x'.repeat(25*1024*1024),createdAt:'2026-01-01'}];
await assert.rejects(()=>forward.captureForwardedChat(source,new Set(['large'])),/过大/);assert.equal(cloneCalls,0,'Oversize input cloned before preflight');
let deep={};for(let i=0;i<20;i++)deep={nested:deep};assert.throws(()=>forward.forwardedValueSize(deep),/层数/);
console.log('chat forwarding: snapshot, names, payment state, media copy, prompt isolation, identity and target guards passed');
})().catch(e=>{console.error(e);process.exitCode=1});
