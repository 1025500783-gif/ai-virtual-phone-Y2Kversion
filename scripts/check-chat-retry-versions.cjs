const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const clone=x=>JSON.parse(JSON.stringify(x));
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const persisted=new Map();let messages=[],turns=[],failSave=false,failRestore=false,restoreCalls=0;
const service={exports:{},require:id=>{
 if(id==='./chat-retry-version-store')return{CHAT_RETRY_VERSIONS_PREFIX:'ai_phone_chat_retry_versions:'};
 if(id==='./kv-db')return{registerDynamicPrefix(){},kvGet:k=>persisted.get(k)||null,kvSetAsync:async(k,v)=>{if(failSave)throw Error('quota');persisted.set(k,v);}};
 if(id==='./chat-storage')return{loadChatMessages:()=>clone(messages),restoreChatRetryMessages:async(s,ids,rows)=>{if(failRestore)throw Error('db failed');restoreCalls++;const removed=new Set([...ids,...rows.map(r=>r.id)]);messages=messages.filter(m=>!removed.has(m.id)).concat(clone(rows)).sort((a,b)=>a.order-b.order);}};
 if(id==='./chat-offline-storage')return{loadChatOfflineTurns:()=>clone(turns),restoreChatRetryOfflineTurns:async(s,rows)=>{if(failRestore)throw Error('db failed');turns=clone(rows);}};
 throw Error(id);
},console,Date,Math,Set,Map};
vm.runInNewContext(compile(fs.readFileSync('lib/chat-retry-versions.ts','utf8')),service);const api=service.exports;
const msg=(id,role,order,content=id,sessionId='s')=>({id,role,order,content,sessionId,status:'read',createdAt:new Date(order*1000).toISOString()});
const eq=(a,b)=>assert.deepEqual(clone(a),clone(b));
(async()=>{
 messages=[msg('u','user',1),msg('a','assistant',2),msg('later','user',3)];
 let s=await api.beginRetryVersion('s','a','tail');assert.equal(s.versions.length,1);assert(persisted.size>0);
 messages=[messages[0],msg('b','assistant',2,'retry one')];s=await api.finishRetryVersion(s,['u','a','later']);assert.equal(s.active,1);assert.equal(s.versions.length,2);
 s=await api.selectRetryVersion(s,0);eq(messages.map(m=>m.id),['u','a','later']);
 messages.push(msg('new-following','user',4));s=await api.selectRetryVersion(s,1);eq(messages.map(m=>m.id),['u','b']);
 s=await api.selectRetryVersion(s,0);eq(messages.map(m=>m.id),['u','a','later','new-following']);
 s=await api.beginRetryVersion('s','a','tail',s);messages=[messages[0],msg('c','assistant',2,'branch from original')];s=await api.finishRetryVersion(s,['u','a','later','new-following']);
 assert.equal(s.versions.length,3);assert.equal(s.versions[2].parent,0);eq(s.versions[1].memberIds,['b']);
 s=await api.selectRetryVersion(s,1);eq(messages.map(m=>m.id),['u','b']);assert.equal(api.findRetrySeries('s','b').active,1);
 const source=api.retrySourceText(s,'b');assert.equal(source,'retry one');
 const before=clone(messages);failSave=true;await assert.rejects(()=>api.selectRetryVersion(s,0),/quota/);eq(messages,before);failSave=false;
 failRestore=true;await assert.rejects(()=>api.selectRetryVersion(s,0),/db failed/);eq(messages,before);assert.equal(api.findRetrySeries('s','b').active,1);failRestore=false;
 const current=clone(messages);messages=messages.filter(m=>m.id!=='u');await assert.rejects(()=>api.selectRetryVersion(s,0),/前文/);messages=current;
 // A restart between generation and final metadata write can recover the new IDs.
 s=await api.beginRetryVersion('s','b','tail',s);messages=[messages[0],msg('recovered','assistant',2)];const recovered=api.findRetrySeries('s','recovered');assert.equal(recovered.versions.length,4);assert.equal(recovered.active,3);
 // Failed generation retains the chosen source and concurrent user records.
 s=await api.beginRetryVersion('s','recovered','tail',recovered);messages=[messages[0],msg('failure','system',3),msg('typed-while-waiting','user',4)];s=await api.finishRetryVersion(s,['u','recovered']);
 eq(messages.map(m=>m.id),['u','recovered','failure','typed-while-waiting']);assert.equal(s.versions.length,4);
 // Notice retries preserve later unrelated chat in both directions.
 messages=[msg('nu','user',1,'nu','n'),msg('notice','system',2,'notice','n'),msg('following','user',3,'following','n'),msg('following-reply','assistant',4,'following-reply','n')];
 let n=await api.beginRetryVersion('n','notice','notice');messages=messages.filter(m=>m.id!=='notice').concat(msg('notice-retry','assistant',5,'notice-retry','n'));n=await api.finishRetryVersion(n,['nu','notice','following','following-reply']);
 n=await api.selectRetryVersion(n,0);eq(messages.map(m=>m.id),['nu','notice','following','following-reply']);n=await api.selectRetryVersion(n,1);eq(messages.map(m=>m.id),['nu','following','following-reply','notice-retry']);
 turns=[{id:'off-u',sessionId:'o',userContent:'前轮',assistantContent:'前轮正文',summary:'前轮摘要',summaryTag:'summary',createdAt:'2026-01-01T00:00:00Z'},{id:'off-a',sessionId:'o',userContent:'问题',assistantContent:'旧正文',summary:'旧摘要',summaryTag:'summary',thinkingText:'旧思维',createdAt:'2026-01-01T00:01:00Z'}];
 let o=await api.beginRetryVersion('o','off-a','offline');turns=[turns[0],{...turns[1],id:'off-b',assistantContent:'新正文',summary:'新摘要'}];o=await api.finishRetryVersion(o,['off-u','off-a']);o=await api.selectRetryVersion(o,0);assert.equal(turns[1].assistantContent,'旧正文');assert.equal(turns[1].thinkingText,'旧思维');assert.equal(turns[1].summary,'旧摘要');
 // Preserve media references and metadata without executing playback, tools or TTS.
 messages=[msg('media-user','user',1,'media user','media'),{...msg('media-original','assistant',2,'media reply','media'),imageUrl:'data:image/png;base64,fixture',audioUrl:'blob:synthetic-audio',voiceText:'原语音',quote:{content:'原引文'},toolCalls:[{id:'stored-tool-call'}]}];
 const mediaOriginal=clone(messages);let media=await api.beginRetryVersion('media','media-original','tail');messages=[messages[0],msg('media-retry','assistant',2,'new media reply','media')];media=await api.finishRetryVersion(media,mediaOriginal.map(row=>row.id));await api.selectRetryVersion(media,0);eq(messages,mediaOriginal);
 assert(restoreCalls>0);console.log('PASS original/previous/next, branching, following records, restart recovery, media metadata, notices, offline summaries, save/DB failures, deleted anchors');
 // Split bubbles / group rounds and linked tool protocol share one boundary.
 const group=[msg('g-user','user',1),{...msg('tool-call','assistant',2),toolExecutionId:'exec'}, {...msg('g1','assistant',3),responseRoundId:'round',toolExecutionId:'exec'}, {...msg('g2','assistant',4),responseRoundId:'round'}];
 assert.equal(api.retryMessageStart(group,'g2'),1);
 messages=group.map(row=>({...row,sessionId:'g'}));const grouped=await api.beginRetryVersion('g','g2','tail');eq(grouped.versions[0].memberIds,['g1','g2']);eq(grouped.versions[0].rows.map(row=>row.id),['tool-call','g1','g2']);
 assert.equal(api.retrySourceText(grouped,'g1'),'g1\ng2');
 persisted.delete('ai_phone_chat_retry_versions:g');await assert.rejects(()=>api.selectRetryVersion({...grouped,versions:[...grouped.versions,grouped.versions[0]]},1),/已清除/);
 await api.finishRetryVersion(grouped,[]);assert.equal(persisted.has('ai_phone_chat_retry_versions:g'),false);
 messages=[msg('r-user','user',1,'user','recover'),msg('r-source','assistant',2,'source','recover')];
 await api.beginRetryVersion('recover','r-source','tail');messages=messages.slice(0,1);await api.recoverPendingRetryVersions('recover');eq(messages.map(row=>row.id),['r-user','r-source']);assert.equal(JSON.parse(persisted.get('ai_phone_chat_retry_versions:recover'))[0].pending,undefined);
 // Exercise the actual atomic storage function with transactional mocks.
 const storageSource=fs.readFileSync('lib/chat-storage.ts','utf8');const tree=ts.createSourceFile('s.ts',storageSource,ts.ScriptTarget.Latest,true);const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='restoreChatRetryMessages').getText(tree);
 let dbFail=false;const original=[msg('stored','assistant',1)];const box={exports:{},_messagesCache:clone(original),Set,Map,assertIdentityActive(){},getCurrentIdentityId:()=> 'fixture-user',loadChatSessions:()=>[{id:'s'}],saveChatSessions(){},getChatMessagePreview:m=>m.content,getLastVisibleSessionMessage:()=>null,chatDb:{messages:{bulkDelete:async()=>{},bulkPut:async()=>{}},transaction:async(a,b,work)=>{if(dbFail)throw Error('atomic fail');await work();}}};
 vm.runInNewContext(compile(fn+'\nexports.read=()=>_messagesCache;'),box);
 dbFail=true;await assert.rejects(()=>box.exports.restoreChatRetryMessages('s',['stored'],[msg('new','assistant',1)]),/atomic fail/);eq(box.exports.read(),original);
 dbFail=false;await box.exports.restoreChatRetryMessages('s',['stored'],[msg('new','assistant',1)]);eq(box.exports.read().map(m=>m.id),['new']);
 await assert.rejects(()=>box.exports.restoreChatRetryMessages('s',[],[msg('cross','assistant',1,'cross','other')]),/当前会话/);
 console.log('PASS actual storage transaction failure leaves memory unchanged; cross-session rows rejected; no model/tool/plugin execution');
 const key='ai_phone_chat_retry_versions:cleanup';persisted.set(key,JSON.stringify([{kind:'tail'},{kind:'offline'},{kind:'notice'}]));
 const cleanup={exports:{},require:()=>({registerDynamicPrefix(){},kvGet:k=>persisted.get(k),kvSet:(k,v)=>persisted.set(k,v),kvRemove:k=>persisted.delete(k)})};
 vm.runInNewContext(compile(fs.readFileSync('lib/chat-retry-version-store.ts','utf8')),cleanup);
 cleanup.exports.clearChatRetryVersions('cleanup','online');eq(JSON.parse(persisted.get(key)),[{kind:'offline'}]);cleanup.exports.clearChatRetryVersions('cleanup','offline');assert.equal(persisted.has(key),false);
 console.log('PASS group multi-bubble/tool boundary and clear lifecycle; cleared drafts cannot reappear from pending retries');
})().catch(e=>{console.error(e);process.exitCode=1;});
