// Isolated helper/component/CSS regression; no models or real chat storage.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const compile=s=>ts.transpileModule(s,{fileName:'fixture.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const helpers={};for(const f of ['lib/bilingual-text.ts','lib/chat-text-layout.ts'])vm.runInNewContext(compile(read(f)),{exports:helpers});
const n=helpers.normalizeChatTextLayout;
for(const [text,expected] of [['乖，','乖'],['时间真不早了，','时间真不早了'],['小脾气再大,','小脾气再大'],['别胡思乱想，早点睡，','别胡思乱想，早点睡'],['今晚聊一会，  ','今晚聊一会  '],['Be good,','Be good,'],['乖～','乖～'],['乖……','乖……'],['乖！','乖！'],['乖？','乖？'],['他说“乖，”','他说“乖，”']])assert.equal(n(text),expected);
for(const text of ['长篇表达'.repeat(20)+'，','- 乖，\n- 好，','```\n乖，\n```','第一行，\n第二行，\n第三行，'])assert.equal(n(text),text);
assert.equal(n('凭你那\n点小心眼'),'凭你那点小心眼');assert.equal(n('tell me\nbaby'),'tell me baby');
assert.equal(n('a longer ordinary sentence\nx\nanother longer ordinary sentence'),'a longer ordinary sentence x another longer ordinary sentence');
assert.equal(n('刚练完。Cash全程盯着我\n，那眼神跟我欠他钱一样'),'刚练完。Cash全程盯着我，那眼神跟我欠他钱一样');
for(const text of ['one  \ntwo','one<br>two','- one\n- two','```js\nx\n```','第一行\n第二行\n第三行','one\n\ntwo'])assert.equal(n(text),text);
assert.equal(helpers.splitBilingualText('red | blue',{allowUnchangedTranslation:true}),null);
assert.equal(helpers.splitBilingualText('Bossy|Bossy'),null);
assert.equal(helpers.splitBilingualText('"bossy"? | “Bossy”?',{allowUnchangedTranslation:true}).translated,'“Bossy”?');
const source=read('components/chat/message-bubble.tsx'),chunk=source.slice(source.indexOf('export const BilingualTextBlock'),source.indexOf('\nfunction TextBubble'));
const component={};vm.runInNewContext(compile(`import React,{memo,useState,useEffect,useRef} from 'react';
function MarkdownTextContent({content}){return <div className="chat-markdown"><p>{content.split('\\n').map((line,i)=><React.Fragment key={i}>{i>0&&<br/>}{line}</React.Fragment>)}</p></div>}
const PlainTextContent=MarkdownTextContent;
${chunk}`),{exports:component,require, ...helpers});
const samples=[['knowing how petty you are|凭你那\n点小心眼',true],['tell me\nbaby',true],['"bossy"? | “Bossy”?',true],['user\nkeeps line',false],['poem  \nnext line|诗歌  \n下一行',true]];
const html=samples.map(([text,chatText],i)=>`<div class="chat-msg-wrapper" data-role="${chatText?'assistant':'user'}"><div class="chat-msg-content-wrap"><div id="sample-${i}" class="chat-bubble-role-${chatText?'assistant':'user'}" data-media-type="text">${renderToStaticMarkup(React.createElement(component.BilingualTextBlock,{text,chatText,defaultExpanded:true}))}</div></div></div>`).join('');
const render=(text,chatText)=>renderToStaticMarkup(React.createElement(component.BilingualTextBlock,{text,chatText,defaultExpanded:true}));
assert.ok(!render('Be good,|乖，',true).includes('乖，'));assert.ok(render('Be good,|乖，',true).includes('Be good,'));
assert.ok(render('乖，',false).includes('乖，'));assert.ok(!render('乖，',true).includes('乖，'));
assert.ok(!html.includes('凭你那<br'));assert.ok(html.includes('tell me baby'));assert.ok(!html.includes('未提供中文译文'));
for (const text of ['Lars|Lars','Lars','Lars|“Lars”','🙂|🙂']) {
 const output=render(text,true);
 assert.ok(!output.includes('未提供中文译文'));
 assert.ok(!output.includes('|'));
 assert.ok(!output.includes('chat-bilingual-divider'));
}
assert.equal(helpers.splitBilingualText('[exhales] Lars|Lars',{allowUnchangedTranslation:true}).original,'[exhales] Lars');
assert.equal(helpers.splitBilingualText('Lars|Lars\nHello|你好',{allowUnchangedTranslation:true}).original,'Lars\nHello');
assert.equal(helpers.splitBilingualText('Lars|Lars|Reed|Reed',{allowUnchangedTranslation:true}).translated,'Lars | Reed');
assert.match(read('lib/chat-engine.ts'),/instruction.*CHAT_TEXT_PAIRING_INSTRUCTION/);
if(process.argv.includes('--static-only')) { console.log('PASS: actual bilingual component static rendering, unchanged names/emoji, voice cues, segmented and multiline names; no browser/model/storage.'); process.exit(0); }
(async()=>{const browser=await require(process.env.PLAYWRIGHT_MODULE||'playwright').chromium.launch({headless:true,executablePath:process.env.CHAT_TEST_BROWSER});try{
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}.chat-room-wrapper{padding:18px;width:100vw}.chat-msg-wrapper{display:flex;margin-bottom:12px}.chat-markdown p{margin:0}.chat-bubble-role-assistant,.chat-bubble-role-user{padding:10px 13px;background:#e9e9eb}</style><div class="chat-room-wrapper" data-imessage-private>${html}</div>`);
for(const f of ['styles/chat.css','styles/imessage26.css'])await page.addStyleTag({content:read(f)});
for(const width of [320,390,430])for(const preset of ['classic','glass']){
 await page.setViewportSize({width,height:844});await page.evaluate(p=>{const node=document.querySelector('.chat-room-wrapper');node.dataset.beautyPreset=p;node.toggleAttribute('data-glass-bubbles',p==='glass')},preset);
 const result=await page.evaluate(()=>{const q=s=>document.querySelector(s),b=e=>e.getBoundingClientRect();return {orig:b(q('#sample-0 .chat-bilingual-section-original')).width,trans:b(q('#sample-0 .chat-bilingual-section-translation')).width,soft:q('#sample-1').querySelectorAll('br').length,user:q('#sample-3').querySelectorAll('br').length,poem:q('#sample-4').querySelectorAll('br').length,missing:q('#sample-2').textContent,overflow:[...document.querySelectorAll('[id^="sample-"]')].some(e=>b(e).right>innerWidth)}});
 assert.ok(result.orig>140,`${preset}/${width}: readable text width`);assert.ok(Math.abs(result.orig-result.trans)<1,`${preset}/${width}: equal columns`);assert.equal(result.soft,0);assert.equal(result.user,1);assert.equal(result.poem,2);assert.doesNotMatch(result.missing,/未提供中文译文/);assert.ok(!result.overflow);
}
await page.screenshot({path:path.join(root,'tmp/chat-text-layout-check.png')});
console.log('PASS: soft Chinese/English lines, preserved user/explicit layouts, unchanged names shown once, default bilingual compatibility, equal-width pairs across 320/390/430 and classic/glass. No API calls.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
