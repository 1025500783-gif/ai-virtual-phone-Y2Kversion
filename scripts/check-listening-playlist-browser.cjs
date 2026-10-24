const assert=require('node:assert/strict');
const {launch,setup}=require('./helpers/listening-app-fixture.cjs');
const base=new URL(process.env.LISTENING_QA_BASE_URL||'http://127.0.0.1:3003').origin;
(async()=>{
for(const engine of (process.env.PLAYLIST_QA_ENGINE?[process.env.PLAYLIST_QA_ENGINE]:['chromium','webkit'])){
 const browser=await launch(engine);let round=0,targetId='';console.log('START',engine);
 try{
  const q=await setup(browser,base,{messages:2,onModel:async route=>{
   const raw=route.request().postDataJSON(),body=new URL(route.request().url()).pathname==='/api/llm-proxy'?JSON.parse(raw.body):raw;
   const tools=body.tools||[],tool=tools.find(t=>t.function?.description?.includes('动作：管理一起听歌单'));
   assert(tool,'actual request offers playlist management');
   assert(tool.function.parameters.properties.action.enum.includes('add_song'));
   assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes('音乐分享卡不会入单')));
   const snapshot=body.messages.find(m=>typeof m.content==='string'&&m.content.includes('[当前聊天共同歌单目录]'));
   assert(snapshot,'actual request includes the current persisted playlist directory');
   const directory=JSON.parse(snapshot.content.split('\n').find(line=>line.startsWith('{"playlists":'))).playlists;
   assert(directory.some(p=>p.id===targetId&&p.name==='用户刚建的歌单'));
   assert(!directory.some(p=>p.name==='新建歌单'||p.name==='创建歌单'),'creation buttons are not playlist records');
   const actions=[{action:'list'},{action:'add_song',playlistId:targetId,title:'合成晴天',artist:'验收歌手'},{action:'add_song',playlistId:targetId,title:'合成月光',artist:'验收歌手'},{action:'rename',playlistId:targetId,name:'我们的验收歌单'}];
   if(round>0){const last=body.messages.filter(m=>m.role==='tool').at(-1);assert(last,'previous action has a tool result');assert(!String(last.content).includes('未找到匹配'));}
   const args=actions[round++];console.log(engine,'synthetic native round',round,args?.action||'reply');
   const message=args?{role:'assistant',content:'',tool_calls:[{id:'qa-call-'+round,type:'function',function:{name:tool.function.name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'歌单已经整理好，放进了两首歌。'};
   assert(!body.stream,'fixture uses normal JSON requests');
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'qa-response-'+round,choices:[{index:0,message,finish_reason:args?'tool_calls':'stop'}]})});
  }});
  await q.page.evaluate(async()=>{
   const open=name=>new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   const kv=await open('AiPhoneKvDB');
   const rows=await new Promise(resolve=>{const r=kv.transaction('entries').objectStore('entries').getAll();r.onsuccess=()=>resolve(r.result)});
   const sessionDb=(await indexedDB.databases()).find(d=>d.name.includes('AiPhoneChatDB')).name,chat=await open(sessionDb);
   await new Promise(resolve=>{const tx=chat.transaction('sessions','readwrite'),s=tx.objectStore('sessions'),r=s.get('public-qa-session');r.onsuccess=()=>s.put({...r.result,streamOnline:false});tx.oncomplete=resolve});chat.close();
   const charKey=rows.find(r=>r.key.endsWith('ai_phone_characters_v1')).key,prefix=charKey.slice(0,-'ai_phone_characters_v1'.length);
   await new Promise(resolve=>{const tx=kv.transaction('entries','readwrite');tx.objectStore('entries').put({key:prefix+'listening-library-v1',value:JSON.stringify({version:1,totals:{'public-qa-char':1000},playlists:[{id:'qa-together',sessionId:'public-qa-session',name:'一起听',songs:[],updatedBy:'self',updatedAt:1}],sampled:[],facts:[],history:[]})});tx.oncomplete=resolve});kv.close();
   const music=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai_phone_music_db_v1',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('tracks'))r.result.createObjectStore('tracks',{keyPath:'id'});if(!r.result.objectStoreNames.contains('audio_blobs'))r.result.createObjectStore('audio_blobs')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   await new Promise(resolve=>{const tx=music.transaction('tracks','readwrite');for(const [i,title]of ['合成晴天','合成月光'].entries())tx.objectStore('tracks').put({id:'qa-track-'+i,title,artist:'验收歌手',duration:180,liked:false,addedAt:'2026-01-01T00:00:00.000Z'});tx.oncomplete=resolve});music.close();
  });
  await q.page.reload({waitUntil:'domcontentloaded'});await q.enter();
  await q.app('music');await q.page.getByRole('button',{name:'一起听',exact:true}).click();
  await q.page.getByRole('button').filter({hasText:'一起听过的时光'}).first().click();
  await q.page.getByRole('button',{name:'创建歌单',exact:true}).first().click();
  const draft=q.page.getByRole('textbox',{name:'新歌单名称'});await draft.fill('用户刚建的歌单');await draft.press('Enter');await draft.waitFor({state:'hidden'});
  targetId=await q.page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('AiPhoneKvDB');r.onsuccess=()=>resolve(r.result)});const rows=await new Promise(resolve=>{const r=db.transaction('entries').objectStore('entries').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return JSON.parse(rows.find(r=>r.key.endsWith('listening-library-v1')).value).playlists.find(p=>p.name==='用户刚建的歌单').id});
  assert(targetId&&targetId!=='qa-together');await q.openChat();
  const input=q.page.locator('.chat-room-layer:visible .chat-input-textarea');await input.fill('你去塞一点歌到我们的一起听歌单里去');
  await q.page.locator('.chat-room-layer:visible .chat-send-btn').click();
  await q.page.getByText('歌单已经整理好，放进了两首歌。',{exact:true}).first().waitFor({timeout:90000});
  assert.equal(round,5);
  const saved=await q.page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('AiPhoneKvDB');r.onsuccess=()=>resolve(r.result)});const rows=await new Promise(resolve=>{const r=db.transaction('entries').objectStore('entries').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return JSON.parse(rows.find(r=>r.key.endsWith('listening-library-v1')).value)});
  const updated=saved.playlists.find(p=>p.id===targetId),old=saved.playlists.find(p=>p.id==='qa-together');
  assert.equal(updated.name,'我们的验收歌单');assert.equal(updated.songs.length,2);assert.equal(updated.updatedBy,'public-qa-char');
  assert.deepEqual(updated.songs.map(s=>s.title),['合成晴天','合成月光']);assert.equal(old.name,'一起听');assert.equal(old.songs.length,0,'newly created target receives the songs, not the old playlist');
  console.log(engine,'native pipeline and persistence passed');
  await q.app('music');await q.page.getByRole('button',{name:'一起听',exact:true}).click();
  await q.page.getByRole('button').filter({hasText:'一起听过的时光'}).first().click();
  await q.page.getByText('我们的验收歌单',{exact:true}).first().waitFor();
  const albumButton=q.page.getByRole('button').filter({hasText:'我们的验收歌单'}).last();
  await albumButton.click();
  await albumButton.click(); // Coverflow first selects the card, then opens it.
  await q.page.getByRole('dialog',{name:'我们的验收歌单'}).waitFor();
  await q.page.getByText('合成晴天',{exact:true}).first().waitFor();await q.page.getByText('合成月光',{exact:true}).first().waitFor();
  q.assertClean();console.log('PASS',engine,'UI creates new playlist -> fresh request directory -> real ID list/add/rename -> UI readback; old playlist untouched; synthetic model only');
  await q.context.close();
 }finally{await browser.close()}
}
})().catch(error=>{console.error(error);process.exitCode=1});
