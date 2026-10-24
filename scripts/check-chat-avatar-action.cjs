const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
let history=[],chars=[{id:'c1',name:'A',avatar:'data:image/png;base64,PROFILE_A'},{id:'c2',name:'B',avatar:'data:image/png;base64,PROFILE_B'}],notices=[];
let sessions=[{id:'s1',contactId:'c1'},{id:'g1',isGroup:true,participantIds:['c1','c2']}];
const avatar={
 getChatCharacterAvatar:(s,c)=>Object.prototype.hasOwnProperty.call(s?.characterAvatars||{},c.id)?s.characterAvatars[c.id]:c.avatar,
 getChatCharacterAvatarHistory:(s,id)=>s?.characterAvatarHistories?.[id]||[],
 CHAT_SESSION_AVATARS_UPDATED_EVENT:'chat-session-avatars-updated',
};
let owner='A';const stores=new Map();
const shared={exports:{},require:id=>id==='./kv-db'?{kvGet:key=>stores.get(owner+key),kvSet:(key,value)=>stores.set(owner+key,value)}:id==='./chat-storage'?{getChatSessionMetadata:()=>sessions,loadChatSessions:()=>{throw new Error('Avatar reads must not refresh message previews');}}:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/chat-session-avatar.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,shared);
Object.assign(avatar,shared.exports);
const sandbox={exports:{},Date,Map,Set,require:id=>id==='./chat-storage'?{
 loadChatMessages:()=>history,loadChatSessions:()=>sessions,saveChatSessions:s=>{sessions=s;},pushChatMessage:m=>notices.push(m),
 normalizeVisionImagePromptLimit:v=>v==null?1:Math.max(0,Math.min(20,Math.floor(v))),MAX_VISION_IMAGE_PROMPT_LIMIT:20,
}:id==='./chat-session-avatar'?avatar:id==='./character-storage'?{loadCharacters:()=>chars,loadInteractableCharacters:()=>chars}:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/chat-avatar-action.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
const {buildAvatarActionPrompt:build,applyAvatarAction:apply}=sandbox.exports;
const photo=(id,sessionId='s1')=>({id,sessionId,role:'user',content:'换头像，用这张',mediaType:'image',mediaUrl:`data:image/png;base64,${id}==`});
history=[photo('p1')];build('s1','c1',history,history.map(x=>({...x})),true);
assert.equal(apply('s1','c1','p1'),true);
assert.equal(chars[0].avatar,'data:image/png;base64,PROFILE_A','profile avatar stays untouched');
assert.equal(sessions[0].characterAvatars.c1,history[0].mediaUrl,'private chat avatar changes');
assert.equal(sessions[0].characterAvatarHistories.c1.length,2,'chat-local avatar history remembers old and new');
assert.equal(apply('s1','c1','p1'),false,'duplicate action is rejected');
history=[photo('p2','g1')];build('g1','c2',history,history.map(x=>({...x})),true);
assert.equal(apply('g1','c2','p2'),true);
assert.equal(chars[1].avatar,'data:image/png;base64,PROFILE_B','group avatar action does not mutate profile');
assert.equal(sessions[1].characterAvatars.c2,history[0].mediaUrl,'group chat avatar changes independently');
assert.ok(notices.some(m=>m.content.includes('更换了头像')));
console.log('PASS: avatar actions update private/group chat state and history without mutating character profiles.');

assert.equal(avatar.getChatCharacterAvatar(sessions[1],chars[0]),sessions[0].characterAvatars.c1,'private avatar shared by group');
assert.equal(avatar.getChatCharacterAvatar(null,chars[1]),sessions[1].characterAvatars.c2,'group avatar shared by Moments');
const selected=avatar.getChatCharacterAvatar(null,chars[0]);sessions=[];
assert.equal(avatar.getChatCharacterAvatar(null,chars[0]),selected,'deleting conversation keeps app identity');
owner='B';assert.equal(avatar.getChatCharacterAvatar(null,chars[0]),chars[0].avatar,'identity isolated');owner='A';
avatar.saveChatAppCharacterAvatar('c1',null,[]);assert.equal(avatar.getChatCharacterAvatar(null,chars[0]),chars[0].avatar,'clearing chat avatar restores profile fallback');
console.log('PASS: real app avatar store, private/group/Moments consistency, profile independence, deletion and identity isolation.');
stores.clear();
sessions=[
 {id:'old',contactId:'c1',characterAvatars:{c1:'old'},characterAvatarHistories:{c1:[{avatar:'old',lastSelectedAt:'2026-10-01T00:00:00Z'}]}},
 {id:'new',isGroup:true,characterAvatars:{c1:'new'},characterAvatarHistories:{c1:[{avatar:'new',lastSelectedAt:'2026-10-10T00:00:00Z'}]}}
];
assert.equal(avatar.getChatCharacterAvatar(sessions[0],chars[0]),'new','latest selection wins even when older private chat opens first');
assert.equal(avatar.getChatCharacterAvatar(null,chars[0]),'new','migration persists globally');
assert.equal(avatar.getChatCharacterAvatarHistory(sessions[0],'c1')[0].avatar,'new','shared avatar history follows migrated selection');
console.log('PASS: deterministic legacy migration uses selection dates rather than conversation order.');
stores.clear();sessions=[{id:'s1',contactId:'c1'}];
avatar.saveChatAppCharacterAvatar('c1',null,[{id:'avh_fallback',avatar:null,label:'默认空头像',recordedAt:'2026-10-01T00:00:00Z',lastSelectedAt:'2026-10-01T00:00:00Z',selections:1}]);
history=[{id:'fallback-turn',sessionId:'s1',role:'user',content:'换回之前的头像'}];
const fallbackPrompt=build('s1','c1',history,[],true);
assert(fallbackPrompt.includes('使用档案头像'));assert(fallbackPrompt.includes('当前头像'));
assert(!fallbackPrompt.includes('上一个不同头像是'),'fallback to the current profile is not a different previous avatar');
assert.equal(apply('s1','c1','history:avh_fallback'),false,'selecting the already displayed profile is a no-op');
console.log('PASS: avatar history describes profile fallback and rejects redundant fallback actions.');
