const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
let identity = 'A', allowed = true, nextId = 0, active = true, playOk = true;
const exportsObject = {};
const sharingProtocol = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/music-sharing-protocol.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:sharingProtocol});
const cryptoMock = { randomUUID:()=> 'invite-' + (++nextId), getRandomValues: bytes => require('node:crypto').webcrypto.getRandomValues(bytes) };
const notices = [];
const mocks = {
    './music-sharing-protocol': sharingProtocol,
    "./listening-library": {addListeningTime(){},sampleListeningRank(){},takeListeningRankFacts:()=>"",finishListeningHistory(){}},
    "./character-storage": {loadCharacters:()=>[]},
    "./chat-storage": { pushChatMessage: msg => { const saved={...msg,id:"msg-"+notices.length}; notices.push(saved); return saved; }, loadChatSessions:()=>[{id:"chat-A",contactId:"char-C"},{id:"group",isGroup:true,contactId:"char-C"}], loadChatMessages:()=>notices, updateMessageMediaData:(id,data)=>{notices.find(m=>m.id===id).mediaData=data;}, CHAT_REQUEST_REPLY_EVENT:"chat-request-reply" },
    './identity-runtime': { getCurrentIdentityId: () => identity, assertIdentityActive: () => { if (!active) throw Error('retired'); } },
    './identity-access': { canCurrentIdentityInteract: () => allowed, assertCharacterIdentityAccess: () => { if (!allowed) throw Error('denied'); } },
    './music-control-bridge': { getMusicControlBridge: () => ({ getState: () => ({identityId: identity, currentTrack: {title:'Song',artist:'Singer'},currentTime:45,isPlaying:true}), resume(){}, playByQuery:async()=>({ok:playOk,message:playOk?"ok":"unavailable"}) }) },
    './music-listening': { lyricTimestamp: () => '00:45' },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/listen-together.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports: exportsObject, require: name => mocks[name], setInterval:()=>1,clearInterval(){}, crypto:cryptoMock, Date, CustomEvent: class { constructor(type,options) { this.type=type; this.detail=options.detail; } },
    window:{addEventListener(){},removeEventListener(){},dispatchEvent(){}},
});
const api=exportsObject;
const first=api.inviteListeningRoom('chat-A','char-C');
assert.equal(first.status,'invited');
assert.match(api.listeningRoomPrompt('char-C','chat-A'),/接受.*拒绝/);
assert.equal(api.listeningRoomPrompt('char-C','chat-B'),'');
assert.throws(()=>api.inviteListeningRoom('chat-B','char-D'));
api.leaveListeningRoom('chat-B'); assert.equal(api.getListeningRoom().id,first.id);
api.leaveListeningRoom('chat-A');
api.applyListeningRoomReply(`[一起听:${first.id}:接受]`,'chat-A'); assert.equal(api.getListeningRoom(),null);
const second=api.inviteListeningRoom('chat-A','char-C');
api.applyListeningRoomReply(`[一起听:${first.id}:接受]`,'chat-A'); assert.equal(api.getListeningRoom().status,'invited');
assert.equal(api.applyListeningRoomReply(`好呀。[一起听:${second.id}:接受]`,'chat-A'),'好呀。');
assert.equal(api.getListeningRoom().status,'joined'); assert.match(api.listeningRoomPrompt('char-C','chat-A'),/Song.*Singer/);
assert.doesNotMatch(api.listeningRoomPrompt('char-C','chat-A'), /00:45/);
assert.match(api.listeningRoomPrompt('char-C','chat-A'), /仅出现一次约3\.5秒.*从左侧写入、右侧退去.*不必每轮提及/);
api.recordListeningGlow('wrong-room'); assert.equal(api.getListeningRoom().lastGlowAt,undefined);
api.recordListeningGlow(second.id); assert.match(api.listeningRoomPrompt('char-C','chat-A'), /本次加入特效已出现/);
identity='B'; assert.equal(api.getListeningRoom(),null); identity='A';
allowed=false; assert.equal(api.getListeningRoom(),null); allowed=true; assert.equal(api.getListeningRoom(),null,'revoked room must not revive');
const third=api.inviteListeningRoom('chat-A','char-C'); api.applyListeningRoomReply(`[一起听:${third.id}:拒绝]`,'chat-A'); assert.equal(api.getListeningRoom().status,'declined');
assert.equal(api.listeningRoomPrompt('char-C','chat-A'),'');
active=false; assert.throws(()=>api.inviteListeningRoom('chat-A','char-C'));
console.log('PASS: invitation/accept/reject/leave, stale replies, session & identity boundaries, revoked access and live music prompt; no model calls.');

active=true;
delete cryptoMock.randomUUID;
const lan=api.inviteListeningRoom('chat-A','char-C');
assert.match(lan.id,/^[a-f0-9]{32}$/);
api.applyListeningRoomReply('[一起听:'+lan.id+':接受]','chat-A');
assert.equal(api.getListeningRoom().status,'joined');
api.leaveListeningRoom('chat-A');
const next=api.inviteListeningRoom('chat-A','char-C');
assert.notEqual(next.id,lan.id);
console.log('PASS: LAN HTTP without crypto.randomUUID creates unique invitation IDs and accepts matching replies.');

assert.ok(notices.some(m => m.content.includes("加入")));
const noticeCount=notices.length; api.applyListeningRoomReply("[一起听:"+lan.id+":接受]","chat-A"); assert.equal(notices.length,noticeCount,"duplicate acceptance must not repeat notice");

(async()=>{
api.leaveListeningRoom('chat-A');
const before=notices.length;
assert.equal(api.applyListeningRoomReply('一起听吧。[一起听邀请:Song|Singer]','chat-A'),'一起听吧。');
const invitation=api.getListeningRoom();assert.equal(invitation.initiator,'character');
assert.equal(notices.at(-1).mediaType,'listening_invite');
api.applyListeningRoomReply('[一起听邀请:Song|Singer]','chat-A');assert.equal(notices.length,before+1);
api.applyListeningRoomReply('[一起听:'+invitation.id+':接受]','chat-A');assert.equal(api.getListeningRoom().status,'invited','character cannot accept for user');
await api.respondToListeningInvitation(invitation.id,'chat-A',true);assert.equal(api.getListeningRoom().status,'joined');
assert.equal(notices.at(-1).role,'system');assert.equal(notices.at(-1).content,'用户已接受一起听邀请。');
assert.equal(notices.find(m=>m.id===invitation.invitationMessageId).mediaData.listeningInvite.response,'accepted');
await assert.rejects(()=>api.respondToListeningInvitation(invitation.id,'chat-A',true));
api.leaveListeningRoom('chat-A');api.applyListeningRoomReply('[一起听邀请]','group');assert.equal(api.getListeningRoom(),null);
api.applyListeningRoomReply('[一起听邀请]','chat-A');const decline=api.getListeningRoom();
await api.respondToListeningInvitation(decline.id,'chat-A',false);assert.equal(api.getListeningRoom().status,'declined');
assert.equal(notices.at(-1).role,'system');assert.equal(notices.at(-1).content,'用户暂未接受一起听邀请。');
assert.equal(notices.find(m=>m.id===decline.invitationMessageId).mediaData.listeningInvite.response,'declined');
api.leaveListeningRoom('chat-A');
const ordinaryCard='[音乐分享:Song|Singer]',beforeShare=notices.length;
assert.equal(api.applyListeningRoomReply(ordinaryCard,'chat-A'),ordinaryCard,'ordinary card stays with the music message parser');
assert.equal(api.getListeningRoom(),null,'ordinary sharing is not an invitation');assert.equal(notices.length,beforeShare);
assert.match(api.CHARACTER_LISTENING_INVITE_PROTOCOL,/若你想此刻与用户共同听一首歌，必须发一起听邀请/);
assert.match(api.CHARACTER_LISTENING_INVITE_PROTOCOL,/无需等待用户索要/);
api.applyListeningRoomReply('[一起听邀请:Other song|Singer]','chat-A');const failed=api.getListeningRoom();playOk=false;
await assert.rejects(()=>api.respondToListeningInvitation(failed.id,'chat-A',true),/unavailable/);assert.equal(api.getListeningRoom().status,'invited');
identity='B';await assert.rejects(()=>api.respondToListeningInvitation(failed.id,'chat-A',true));identity='A';playOk=true;
assert.equal(api.getListeningRoom(),null,'identity switch does not revive old invitation');api.applyListeningRoomReply('[一起听邀请:Other song|Singer]','chat-A');const retry=api.getListeningRoom();await api.respondToListeningInvitation(retry.id,'chat-A',true);assert.equal(api.getListeningRoom().status,'joined');
const previous=api.getListeningRoom().id;
api.applyListeningRoomReply('[一起听邀请:Song|Singer]','chat-A');assert.notEqual(api.getListeningRoom().id,previous);assert.equal(api.getListeningRoom().status,'invited');assert.equal(api.getListeningRoom().initiator,'character');
api.leaveListeningRoom('chat-A');api.inviteListeningRoom('chat-A','char-C');api.applyListeningRoomReply('[一起听邀请]','chat-A');assert.equal(api.getListeningRoom().initiator,'character','character can replace an earlier user invitation');
console.log('PASS: same-chat re-invitation creates a fresh pending card rather than silently discarding the marker.');
console.log('PASS: playback failure stays pending, identity mismatch refuses and retry can succeed.');
console.log('PASS: character creates invite, duplicate guard, cannot self-accept, user accepts/rejects, persisted outcome, group exclusion, ordinary sharing stays separate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
