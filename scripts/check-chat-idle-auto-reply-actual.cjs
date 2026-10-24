const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
for(const engine of ['chromium','webkit']){
 const browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:process.env.CHAT_TEST_BROWSER}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  // Synthetic cookie lets the isolated development fixture reach its route; no real login/API use.
  await context.addCookies([{name:'ai_phone_account_session',value:'synthetic-idle-qa-not-a-session',url:process.env.CHAT_TEST_BASE_URL || 'http://127.0.0.1:3003'}]);
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')?r.continue():r.abort()});
  await context.addInitScript(()=>{if(localStorage.getItem('idle_fixture'))return;localStorage.setItem('idle_fixture','1');localStorage.setItem('float_identity_runtime_v1',JSON.stringify({version:1,activeUserId:'idle-fixture',legacyOwnerId:'idle-fixture',userIds:['idle-fixture'],deletingUserIds:[],revision:0}));localStorage.setItem('ai_phone_chat_settings_v1',JSON.stringify({enterToSendEnabled:true}));localStorage.setItem('float_keyboard_auto_send_v1',JSON.stringify({sessionEnabled:{dev_imessage26_private:true},sessionDebounceMs:{dev_imessage26_private:1000}}));});
  await page.goto((process.env.CHAT_TEST_BASE_URL || 'http://127.0.0.1:3003')+'/dev/imessage26',{timeout:120000});
  const input=page.locator('.chat-input-textarea');await input.waitFor({timeout:120000});
  const failures=page.locator('.chat-msg-wrapper').filter({hasText:'发送失败:'});
  const initial=await failures.count();
  await input.fill('idle reply first');await input.press('Enter');
  await page.waitForTimeout(150);assert.equal(await failures.count(),initial);
  assert(await input.evaluate(e=>document.activeElement===e));
  await input.fill('draft still being prepared');await page.waitForTimeout(1500);assert.equal(await failures.count(),initial);
  await input.fill('');await page.waitForFunction(n=>[...document.querySelectorAll('.chat-msg-wrapper')].filter(e=>e.textContent.includes('发送失败:')).length===n,initial+1);
  await page.waitForTimeout(1500);assert.equal(await failures.count(),initial+1,'no auto retry on local config failure');
  // The explicit send-and-reply arrow stays immediate when idle reply is enabled.
  await input.fill('arrow replies now');await page.locator('.chat-send-btn').click();
  await page.waitForFunction(n=>[...document.querySelectorAll('.chat-msg-wrapper')].filter(e=>e.textContent.includes('发送失败:')).length===n,initial+2);
  // Function picker remains a protected preparation state.
  await input.fill('panel preparation');await input.press('Enter');await page.getByRole('button',{name:'更多功能',exact:true}).click();
  await page.waitForTimeout(1500);assert.equal(await failures.count(),initial+2);
  await page.getByRole('button',{name:'更多功能',exact:true}).click();
  await page.waitForFunction(n=>[...document.querySelectorAll('.chat-msg-wrapper')].filter(e=>e.textContent.includes('发送失败:')).length===n,initial+3);
  await input.fill('voice preparation');await input.press('Enter');await input.blur();const voiceStart=Date.now();await page.getByRole('button',{name:'语音消息',exact:true})[engine==='webkit'?'tap':'click']();
  console.log('Voice open',engine,Date.now()-voiceStart,'ms',await failures.count(),await page.locator('.imessage-rich-input-overlay').count());
  await page.waitForTimeout(1500);assert.equal(await failures.count(),initial+3);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.waitForFunction(n=>[...document.querySelectorAll('.chat-msg-wrapper')].filter(e=>e.textContent.includes('发送失败:')).length===n,initial+4);
  await page.getByRole('button',{name:'联系人详情',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'自动回复',exact:true});await toggle.scrollIntoViewIfNeeded();
  assert.equal(await toggle.getAttribute('aria-checked'),'true');
  assert.equal(await page.getByRole('spinbutton',{name:'自动回复等待秒数'}).inputValue(),'1');
  require('node:fs').mkdirSync('qa/idle-reply',{recursive:true});
  for(const width of [390,320])for(const scheme of ['light','dark']){await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:scheme});await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:`qa/idle-reply/settings-${engine}-${width}-${scheme}.png`});}
  await toggle.click();assert.equal(await toggle.getAttribute('aria-checked'),'false');
  console.log('PASS actual ChatRoom '+engine+': opted-in Enter with focus retained, draft blocks, immediate explicit reply, function/voice panels pause and resume, one attempt on config failure, per-chat setting UI 390/320 day/night and switch. No microphone or API configured; requests blocked.');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
})().catch(e=>{console.error(e);process.exitCode=1});
