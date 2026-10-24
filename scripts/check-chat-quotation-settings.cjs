// Execute the real settings handler and updater against synthetic session storage.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const file='components/chat/chat-settings-panel.tsx';
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let updater,handler;
function visit(node) {
 if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='updateSession') updater=node.initializer.getText(source);
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='Toggle') {
  const attrs=node.attributes.properties;
  const label=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(source)==='ariaLabel');
  if(label?.initializer?.text==='引文翻译') handler=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(source)==='onChange').initializer.expression.getText(source);
 }
 ts.forEachChild(node,visit);
}
visit(source); assert.ok(updater&&handler,'actual quotation toggle and session updater');
let stored=[{id:'a',quoteTranslationEnabled:true,backgroundImage:'keep'},{id:'b',quoteTranslationEnabled:true}],checked=true,writes=0;
const context={exports:{},session:structuredClone(stored[0]),loadChatSessions:()=>structuredClone(stored),saveChatSessions:value=>{stored=structuredClone(value);writes++;},setQuoteTranslationEnabled:value=>{checked=value;}};
vm.runInNewContext(ts.transpileModule(`const updateSession=${updater}; exports.change=${handler};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
context.exports.change(false);
assert.equal(checked,false);assert.equal(stored[0].quoteTranslationEnabled,false);assert.equal(context.session.quoteTranslationEnabled,false);
assert.equal(stored[0].backgroundImage,'keep');assert.equal(stored[1].quoteTranslationEnabled,true);
context.session=structuredClone(stored[0]);assert.equal(context.session.quoteTranslationEnabled!==false,false,'saved session reopens off');
context.exports.change(true);assert.equal(stored[0].quoteTranslationEnabled,true);
context.session={id:'unsaved-preview'};const before=writes;context.exports.change(false);
assert.equal(writes,before);assert.equal(context.session.quoteTranslationEnabled,false);assert.equal(stored.length,2);
console.log('PASS: actual quotation setting callback, session persistence/reload, other-session isolation and unsaved preview; synthetic storage only.');
