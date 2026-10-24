// Actual resolvers and React activity components; synthetic data, no models/accounts.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const compile = (file, jsx = false) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined } }).outputText;
const run = (code, globals) => { const box = { exports: {}, ...globals }; vm.runInNewContext(code, box); return box.exports; };
let raw = JSON.stringify([{ id: 'A', name: 'User', avatarUrl: 'profile-user' }, { id: 'B', name: 'Other', avatarUrl: 'other-profile', chatAvatarUrl: 'other-chat' }]);
const tree = ts.createSourceFile('settings.ts', fs.readFileSync('lib/settings-storage.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['userIdentitiesRaw', 'userIdentitiesCache', 'loadUserIdentities', 'saveUserIdentities', 'resolveUserIdentity'];
const source = tree.statements.filter(n => ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(tree)))).map(n => n.getText(tree)).join('\n');
let owner = 'A';
const identityEvents = [];
const identity = run(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    window: { dispatchEvent: event => identityEvents.push(event.type) }, Event: class { constructor(type) { this.type = type; } }, USER_IDENTITIES_KEY: 'users', kvGet: () => raw, kvSet: (_key, value) => { raw = value; }, updateIdentityDirectory() {},
    isIdentityInitialized: () => true, getCurrentIdentityId: () => owner,
});
identity.saveUserIdentities(identity.loadUserIdentities().map(i => i.id === 'A' ? { ...i, avatarUrl: 'profile-new' } : i));
assert.equal(identity.loadUserIdentities()[0].chatAvatarUrl, undefined, 'Saving a profile must not create a chat override');
assert.equal(identity.resolveUserIdentity('c', 'story').avatarUrl, 'profile-new');
identity.saveUserIdentities(identity.loadUserIdentities().map(i => i.id === 'A' ? { ...i, chatAvatarUrl: 'chat-user' } : i));
for (const app of ['chat', 'group_chat', 'story', 'music', 'calendar', 'moments', 'adventure']) assert.equal(identity.resolveUserIdentity('c', app).avatarUrl, 'chat-user');
assert.equal(identity.loadUserIdentities()[0].avatarUrl, 'profile-new', 'Presentation must not overwrite the archive avatar');
identity.saveUserIdentities(identity.loadUserIdentities().map(i => i.id === 'A' ? { ...i, chatAvatarUrl: '', avatarUrl: 'profile-latest' } : i));
assert.equal(identity.resolveUserIdentity('c', 'story').avatarUrl, 'profile-latest');
assert.equal(identityEvents.filter(type => type === 'user-identities-updated').length, 3, 'Every saved identity update invalidates activity presentation');
owner = 'B'; assert.equal(identity.resolveUserIdentity().avatarUrl, 'other-chat'); owner = 'A';
let saved = null, reads = 0;
const avatars = run(compile('lib/chat-session-avatar.ts'), { require: id => id === './kv-db' ? { kvGet: () => saved, kvSet: (_k, value) => { saved = value; } } : { getChatSessionMetadata: () => [] } });
const char = { id: 'c', get avatar() { reads++; return 'profile-char'; } };
avatars.saveChatAppCharacterAvatar('c', 'chat-char', []);
assert.equal(avatars.getChatCharacterAvatar(null, char), 'chat-char'); assert.equal(reads, 0, 'Read archive avatar only as fallback');
avatars.saveChatAppCharacterAvatar('c', null, []); assert.equal(avatars.getChatCharacterAvatar(null, char), 'profile-char');
avatars.saveChatAppCharacterAvatar('c', '  ', []); assert.equal(avatars.getChatCharacterAvatar(null, char), 'profile-char');
const profileCharacter = { id: 'c', avatar: 'archive-char' };
const activity = run(compile('lib/chat-app-characters.ts'), { require: id => id === './character-storage' ? { loadInteractableCharacters: () => [profileCharacter] } : avatars });
avatars.saveChatAppCharacterAvatar('c', 'activity-chat', []);
assert.equal(activity.loadActivityCharacters()[0].avatar, 'activity-chat');
assert.equal(profileCharacter.avatar, 'archive-char', 'Activity projection must never mutate stored character cards');
avatars.saveChatAppCharacterAvatar('c', null, []); profileCharacter.avatar = 'archive-latest';
assert.equal(activity.loadActivityCharacters()[0].avatar, 'archive-latest');
console.log('PASS real identity/avatar resolvers: chat priority, clear/missing fallback, no implicit freezing, archive independence, identity isolation, lazy fallback');


// Public activity pages are exercised by production-browser tests. This probe verifies the real hook lifecycle.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const path=require('path');
const read=(pkg,file)=>fs.readFileSync(path.join(path.dirname(require.resolve(pkg)),file),'utf8');
const modules={react:read('react','cjs/react.production.js'),'react/jsx-runtime':read('react','cjs/react-jsx-runtime.production.js'),'react-dom':read('react-dom','cjs/react-dom.production.js'),'react-dom/client':read('react-dom','cjs/react-dom-client.production.js'),scheduler:read('scheduler','cjs/scheduler.production.js'),hook:compile('components/use-activity-avatar-updates.ts')};
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHAT_TEST_BROWSER});try{const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:'const modules='+JSON.stringify(modules)+',cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;new Function("module","exports","require",modules[id])(m,m.exports,require);return m.exports;}const R=require("react"),root=require("react-dom/client").createRoot(document.getElementById("root"));function Probe(){const revision=require("hook").useActivityAvatarUpdates();return R.createElement("span",{id:"revision"},String(revision));}root.render(R.createElement(Probe));window.unmount=()=>root.unmount();'});await page.waitForFunction(()=>Number(document.getElementById('revision')?.textContent)>0);const before=await page.locator('#revision').innerText();await page.evaluate(()=>dispatchEvent(new Event('user-identities-updated')));await page.waitForFunction(before=>Number(document.getElementById('revision').textContent)>Number(before),before);await page.evaluate(()=>unmount());assert.equal(await page.locator('#revision').count(),0);console.log('PASS real activity update hook responds to saved identity changes and unmounts; no private Scene/music implementation imported.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
