// Full app fixture: no real account, model, TTS or user storage.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {launch,setup}=require('./bilingual-browser-helper.cjs');
const base=process.env.CHAT_TEST_BASE_URL||'http://127.0.0.1:3033';
(async()=>{for(const engine of (process.env.CHAT_TEST_ENGINE?[process.env.CHAT_TEST_ENGINE]:['chromium','webkit'])){const browser=await launch(engine);try{
let calls=0;
const q=await setup(browser,base,{messages:2,onModel:r=>{
calls++;const content='Synthetic reply '+calls,payload=r.request().postDataJSON();
return payload.stream?r.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'}):r.fulfill({status:200,json:{choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}})
}});
const count=async(expected,timeout=6000)=>{for(let t=0;t<timeout&&calls!==expected;t+=50)await q.page.waitForTimeout(50);if(calls!==expected)console.log('idle diagnostics',await q.page.evaluate(()=>({draft:document.querySelector('.chat-room-layer .chat-input-textarea')?.value,trace:window.idleTrace,users:[...document.querySelectorAll('.chat-room-layer .chat-msg-wrapper[data-role="user"]')].map(e=>e.innerText),visible:document.visibilityState,focus:document.hasFocus()})));assert.equal(calls,expected)};
const settings=async()=>{await q.page.getByRole('button',{name:'联系人详情',exact:true}).click();const toggle=q.page.getByRole('switch',{name:'自动回复',exact:true});await toggle.scrollIntoViewIfNeeded();return toggle};
const closeSettings=()=>q.page.locator('.imessage-settings-page .page-back-btn').click();
for(const preset of ['classic','glass']){
await q.page.evaluate(async preset=>{const all=await indexedDB.databases();const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(all.find(x=>x.name.includes('AiPhoneChatDB')).name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite'),s=tx.objectStore('sessions'),r=s.get('public-qa-session');r.onsuccess=()=>s.put({...r.result,beautyPreset:preset});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()},preset);
await q.page.reload({waitUntil:'domcontentloaded'});await q.enter();await q.openChat();
const input=q.page.locator('.chat-room-layer:visible .chat-input-textarea');
const toggle=await settings();if(await toggle.getAttribute('aria-checked')==='false')await toggle.click();
assert.equal(await toggle.getAttribute('aria-checked'),'true');
const seconds=q.page.getByRole('spinbutton',{name:'自动回复等待秒数'});await seconds.fill('1');
await q.page.getByText('发送消息后TA自动回复，无需收起键盘才触发，仅对本聊天生效',{exact:true}).waitFor();
await q.page.getByText('发送后让模型等待确认多久开始恢复',{exact:true}).waitFor();
await closeSettings();
let before=calls;await input.fill('send only waits');
await q.page.evaluate(()=>{window.idleTrace=[];for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,e=>{if(e.target.closest?.('[aria-label="仅发送"]'))window.idleTrace.push({type,pointerType:e.pointerType})},true)});
await q.page.getByRole('button',{name:'仅发送',exact:true}).tap();
await q.page.waitForTimeout(200);assert.equal(calls,before);await count(before+1);await q.page.waitForTimeout(1300);assert.equal(calls,before+1,'one reply per turn');
await settings();await seconds.fill('3');await closeSettings();
before=calls;await input.fill('explicit reply now');await q.page.getByRole('button',{name:'发送并让TA回复',exact:true}).tap();await count(before+1,900);await q.page.waitForTimeout(3300);assert.equal(calls,before+1,'explicit reply must not be duplicated by idle timer');
await settings();await seconds.fill('1');await closeSettings();
before=calls;await input.fill('foreground return');await input.press('Enter');await q.page.evaluate(()=>window.dispatchEvent(new Event('blur')));await q.page.waitForTimeout(1300);assert.equal(calls,before);await input.tap();await count(before+1);
before=calls;await input.fill('draft pause');await input.press('Enter');await input.fill('draft in progress');await q.page.waitForTimeout(1300);assert.equal(calls,before);await input.fill('');await count(before+1);
before=calls;await input.fill('panel pause');await input.press('Enter');await q.page.locator('.chat-room-layer:visible .chat-plus-toggle').tap();await q.page.waitForTimeout(1300);assert.equal(calls,before);await q.page.locator('.chat-room-layer:visible .chat-plus-toggle').tap();await count(before+1);
console.log('PASS',engine,preset,'full app: only-send delay, immediate explicit reply without duplicate, foreground recovery, draft and panel pause, no retry');
await settings();fs.mkdirSync('qa/idle-reply-controls',{recursive:true});
for(const width of [390,320])for(const scheme of ['light','dark']){await q.page.setViewportSize({width,height:844});await q.page.emulateMedia({colorScheme:scheme});await q.page.locator('.imessage-settings-page > .page-body').evaluate(e=>e.scrollTop=0);const avatar=await q.page.locator('.chat-settings-avatar').boundingBox(),back=await q.page.locator('.imessage-settings-page .page-back-btn').boundingBox();assert.ok(Math.abs(avatar.y-back.y)<=1,`avatar/back top alignment: ${avatar.y}, ${back.y}`);await q.page.screenshot({path:`qa/idle-reply-controls/${engine}-${preset}-${width}-${scheme}-top.png`});await toggle.scrollIntoViewIfNeeded();assert.equal(await seconds.locator('xpath=ancestor::label').locator('.menu-label-group').evaluate(e=>getComputedStyle(e).paddingLeft),'0px');await q.page.screenshot({path:`qa/idle-reply-controls/${engine}-${preset}-${width}-${scheme}.png`})}
await closeSettings();await q.page.setViewportSize({width:390,height:844});
}
q.assertClean();await q.context.close();
}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
