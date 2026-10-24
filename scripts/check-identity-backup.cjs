// Real production backup modules + real IndexedDB. Disposable browser, synthetic saves, mock cloud only.
const fs = require('node:fs');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require('playwright');
const files = ['identity-space', 'identity-runtime', 'phone-session-protocol', 'identity-db-guard', 'identity-recovery', 'identity-media-cleanup', 'identity-lifecycle', 'kv-db', 'sha256-stream',
  'data-management/types', 'data-management/modules', 'data-management/serializers', 'data-management/identity-backup', 'data-management/idb', 'data-management/operation-lock', 'data-management/backup', 'cloud-backup/config', 'cloud-backup/engine'];
const sources = Object.fromEntries(files.map(path => [path.split('/').at(-1), ts.transpileModule(fs.readFileSync(`lib/${path}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText]));
(async () => {
  const server = http.createServer((_, res) => res.end('<!doctype html><title>Isolated backup regression</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHAT_TEST_BROWSER, headless: true });
  try {
    const initializePage = async page => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ path: require.resolve('dexie') });
    await page.addScriptTag({ path: require.resolve('jszip/dist/jszip.min.js') });
    await page.evaluate(sources => {
      const mods = {}; const objects = new Map(); window.cloudObjects = objects;
      window.module = name => {
        name = name.split('/').at(-1);
        if (name === 'dexie') return window.Dexie;
        if (name === 'jszip') return window.JSZip;
        if (name === 'download-utils') return {};
        if (name === 'storage-client') return {
          ensureBucket: async () => {}, putObject: async (_, key, value) => objects.set(key, value instanceof Blob ? value : new Blob([value])),
          getObject: async (_, key) => objects.get(key) ?? null, removeObject: async (_, key) => objects.delete(key),
          listObjects: async (_, prefix) => [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ name: key.slice(prefix.length), updatedAt: new Date().toISOString() })),
        };
        if (mods[name]) return mods[name];
        if (!sources[name]) throw Error('Missing dependency ' + name);
        const exports = mods[name] = {};
        new Function('exports', 'require', sources[name])(exports, window.module); return exports;
      };
      window.check = (value, message) => { if (!value) throw Error(message); };
      window.makeDb = async (name, rows) => { const db = new Dexie(name); db.version(1).stores({ rows: 'id' }); await db.table('rows').bulkPut(rows); db.close(); };
      window.rows = async name => { const db = new Dexie(name); db.version(1).stores({ rows: 'id' }); try { return await db.table('rows').toArray(); } finally { db.close(); } };
      window.rawKv = async key => { const db = new Dexie('AiPhoneKvDB'); db.version(1).stores({ entries: 'key' }); try { return (await db.table('entries').get(key))?.value; } finally { db.close(); } };
    }, sources);
    };
    const page = await browser.newPage();
    await initializePage(page);
    const result = await page.evaluate(async () => {
      const directory = [{ id: 'A', name: 'Alice', bio: 'A profile' }, { id: 'B', name: 'Bob', bio: 'B profile' }];
      localStorage.setItem('float_identity_runtime_v1', JSON.stringify({ version: 1, activeUserId: 'A', legacyOwnerId: 'A', userIds: ['A', 'B'], deletingUserIds: [], revision: 1 }));
      const db = new Dexie('AiPhoneKvDB'); db.version(1).stores({ entries: 'key' });
      await db.table('entries').bulkPut([
        { key: 'ai_phone_user_identities_v1', value: JSON.stringify(directory) },
        { key: 'ai_phone_characters_v1', value: JSON.stringify([{ id: 'C', name: 'Shared character' }]) },
        { key: 'ai_phone_photo_album_v1', value: JSON.stringify([{ id: 'photo', caption: 'A photo' }]) },
        { key: 'identity:B:ai_phone_photo_album_v1', value: JSON.stringify([{ id: 'photo', caption: 'B photo' }]) },
        { key: 'identity:B:wallet', value: '200' }, { key: 'wallet', value: '100' },
        { key: 'ai_phone_chat_retry_versions:qa', value: JSON.stringify([{ id: 'retry-fixture', versions: ['original', 'retry'] }]) },
      ]); db.close();
      localStorage.setItem('private-note', 'A note'); localStorage.setItem('identity:B:private-note', 'B note');
      await makeDb('AiPhoneChatDB', [{ id: 'same', text: 'A chat', file: new Blob(['A image'], { type: 'image/png' }) }]);
      await makeDb('AiPhoneChatDB::identity:B', [{ id: 'same', text: 'B chat', file: new Blob(['B image']) }]);
      await module('kv-db').hydrateKvDb();
      const backup = module('backup');
      const chatModule = module('modules').DATA_MODULES.find(item => item.id === 'chat');
      check(chatModule.sources.some(source => source.type === 'kv' && source.prefixes?.includes('ai_phone_chat_retry_versions:')), 'Chat module must own retry archives');
      const chatOnly = await backup.readBackupBlob((await backup.createBackupBlob(['chat'], { scope: 'current' })).blob);
      check(JSON.stringify(chatOnly).includes('retry-fixture'), 'Chat-only backup omitted retry versions');
      const current = await backup.createBackupBlob(undefined, { scope: 'current' });
      const currentPayload = await backup.readBackupBlob(current.blob);
      const currentJson = JSON.stringify(currentPayload);
      check(current.manifest.identities.users.length === 1, 'Current export has other identity cards');
      check(!currentJson.includes('B chat') && !currentJson.includes('B photo') && !currentJson.includes('Bob') && !currentJson.includes('B note'), 'Current export leaked B');
      const all = await backup.createBackupBlob(undefined, { scope: 'all' });
      const allJson = JSON.stringify(await backup.readBackupBlob(all.blob));
      check(allJson.includes('A chat') && allJson.includes('B chat') && allJson.includes('B photo') && allJson.includes('B note'), 'All export lost inactive user data');
      check(module('identity-runtime').getCurrentIdentityId() === 'A', 'Export switched identity');
      // Existing same IDs must survive default import. Explicit overwrite only affects archived owners.
      await makeDb('AiPhoneChatDB', [{ id: 'same', text: 'A newer' }]);
      await makeDb('AiPhoneChatDB::identity:B', [{ id: 'same', text: 'B newer' }]);
      await module('kv-db').kvSetAsync('ai_phone_characters_v1', JSON.stringify([{ id: 'C', name: 'Newer shared' }]));
      let restored = await backup.importBackupBlob(all.blob);
      check(!restored.errors.length, restored.errors.join(';'));
      check((await rows('AiPhoneChatDB'))[0].text === 'A newer', 'Default import overwrote A');
      check((await rows('AiPhoneChatDB::identity:B'))[0].text === 'B newer', 'Default import overwrote B');
      restored = await backup.importBackupBlob(current.blob, undefined, { overwrite: true });
      check(!restored.errors.length, restored.errors.join(';'));
      check((await rows('AiPhoneChatDB'))[0].text === 'A chat', 'Explicit restore missed A');
      check((await rows('AiPhoneChatDB'))[0].file instanceof Blob, 'Binary media lost');
      check((await rawKv('ai_phone_chat_retry_versions:qa')).includes('retry-fixture'), 'Retry archive lost during restore');
      check((await rows('AiPhoneChatDB::identity:B'))[0].text === 'B newer', 'Current restore touched B');
      check(module('kv-db').kvGet('ai_phone_characters_v1').includes('Newer shared'), 'Private overwrite replaced shared data');
      const broken = await module('idb').importSource({type:'kv',owner:{kind:'user',userId:'B'},records:[{key:'ai_phone_photo_album_v1',value:JSON.stringify([{__aiPhoneMediaRef:true,ref:'f'.repeat(64),encoding:'dataurl',mimeType:'image/png'}])}]},true,async()=>{throw Error('Synthetic interrupted media download')});
      check(broken.errors.length === 1 && (await rawKv('identity:B:ai_phone_photo_album_v1')).includes('B photo'),'Interrupted media restore overwrote the existing album');
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value,...args) { if(value?.key === 'identity:B:wallet') throw new DOMException('Synthetic quota limit','QuotaExceededError'); return originalPut.call(this,value,...args); };
      const quota = await module('idb').importSource({type:'kv',owner:{kind:'user',userId:'B'},records:[{key:'wallet',value:'999'}]},true);
      IDBObjectStore.prototype.put = originalPut;
      check(quota.errors.length === 1 && await rawKv('identity:B:wallet') === '200','Quota failure lost existing wallet');
      // Remove a source file and a media file separately: neither may write even one record.
      for (const kind of ['module', 'media']) {
        const zip = await JSZip.loadAsync(all.blob);
        const path = kind === 'module' ? all.manifest.files[0].path : Object.keys(zip.files).find(path => path.startsWith('media/') && path.endsWith('.bin'));
        zip.remove(path);
        await makeDb('AiPhoneChatDB', [{ id: 'same', text: 'untouched' }]);
        let failed = false; try { await backup.importBackupBlob(await zip.generateAsync({ type: 'blob' }), undefined, { overwrite: true }); } catch { failed = true; }
        check(failed && (await rows('AiPhoneChatDB'))[0].text === 'untouched', 'Corrupt ' + kind + ' wrote partial data');
      }
      // Original-style archive imports into one NEW owner, not the live A/B save.
      const legacyZip = new JSZip(); const legacyManifest = { format: 'ai-phone-backup', version: 1, createdAt: new Date().toISOString(), origin: '', totalBytes: 1, totalRecords: 1, modules: [{ id: 'chat', label: 'Chat', bytes: 1, records: 1 }] };
      legacyZip.file('manifest.json', JSON.stringify(legacyManifest));
      legacyZip.file('modules/chat.json', JSON.stringify({ moduleId: 'chat', sources: [
        { type: 'kv', records: [{ key: 'ai_phone_user_identities_v1', value: JSON.stringify([{id:'old1',name:'Other persona'},{id:'old2',name:'Migrated persona',bio:'Keep this profile'}]) }, {key:'ai_phone_bindings_v1',value:JSON.stringify({globalDefaults:{userIdentityId:'old2'}})}] },
        { type: 'indexeddb', dbName: 'AiPhoneChatDB', stores: [{ name: 'rows', keyPath: 'id', autoIncrement: false, records: [{ key: 'same', value: { id: 'same', text: 'legacy chat' } }] }] }] }));
      restored = await backup.importBackupBlob(await legacyZip.generateAsync({ type: 'blob' }));
      check(!restored.errors.length, restored.errors.join(';'));
      const imported = module('identity-runtime').readIdentityRuntime().userIds.find(id => !['A','B'].includes(id));
      check(imported && (await rows('AiPhoneChatDB::identity:' + encodeURIComponent(imported)))[0].text === 'legacy chat', 'Legacy migration lost ownership');
      check(JSON.parse(module('kv-db').kvGet('ai_phone_user_identities_v1')).find(user => user.id === imported)?.bio === 'Keep this profile', 'Legacy migration lost the active profile');
      check(JSON.parse(await rawKv('identity:' + imported + ':ai_phone_bindings_v1')).globalDefaults.userIdentityId === imported, 'Legacy binding points at old persona');
      check((await rows('AiPhoneChatDB'))[0].text === 'untouched', 'Legacy import overwrote active user');
      // Mock storage transport exercises actual incremental cloud writer/reader.
      const config = { url: 'https://test.invalid', key: 'synthetic', enabled: false, intervalHours: 6, keepCount: 3, excludeMedia: false, backupScope: 'all' };
      const cloud = module('engine'); const uploaded = await cloud.runCloudBackup(config, { force: true });
      const manifest = JSON.parse(await cloudObjects.get(uploaded.manifestName).text());
      check(manifest.version === 3 && manifest.identities.users.length === 3, 'Cloud backup lost users');
      restored = await cloud.restoreFromCloudManifest(config, uploaded.manifestName);
      check(!restored.errors.length, restored.errors.join(';'));
      // A run for current user cannot rotate away the complete multi-user backup.
      for (let index = 0; index < 3; index++) await cloud.runCloudBackup({...config,backupScope:'current'}, {force:true});
      check(cloudObjects.has(uploaded.manifestName), 'Current-user retention removed all-user backup');
      const sourcePath = manifest.modules[0].sources[0].parts[0]; cloudObjects.delete(sourcePath);
      let failed = false; try { await cloud.restoreFromCloudManifest(config, uploaded.manifestName, {overwrite:true}); } catch { failed = true; }
      check(failed, 'Cloud restore accepted missing object');
      return { archiveBytes: Array.from(new Uint8Array(await all.blob.arrayBuffer())), currentUsers: current.manifest.identities.users.length, allUsers: all.manifest.identities.users.length, cloudUsers: manifest.identities.users.length, checks: 'isolation, media round-trip, merge/overwrite, corrupt archive preflight, legacy profile/binding migration, cloud round-trip, scope retention' };
    });
    const fresh = await browser.newPage();
    await initializePage(fresh);
    await fresh.evaluate(async bytes => {
      localStorage.setItem('float_identity_runtime_v1', JSON.stringify({version:1,activeUserId:'Z',legacyOwnerId:'Z',userIds:['Z'],deletingUserIds:[],revision:1}));
      const db = new Dexie('AiPhoneKvDB'); db.version(1).stores({entries:'key'}); await db.table('entries').put({key:'ai_phone_user_identities_v1',value:JSON.stringify([{id:'Z',name:'Fresh user'}])}); db.close();
      await module('kv-db').hydrateKvDb();
      const restored = await module('backup').importBackupBlob(new Blob([new Uint8Array(bytes)]));
      check(!restored.errors.length,restored.errors.join(';'));
      check((await rows('AiPhoneChatDB::identity:A'))[0].text === 'A chat','Legacy owner A was not relocated on a fresh browser');
      check((await rows('AiPhoneChatDB::identity:B'))[0].text === 'B chat','B was not restored on fresh browser');
      check(await rawKv('identity:A:wallet') === '100' && await rawKv('identity:B:wallet') === '200','Private KV owners changed');
      check(module('kv-db').kvGet('wallet') === null,'New browser active user received another user wallet');
      check(localStorage.getItem('identity:A:private-note') === 'A note','Legacy localStorage namespace not relocated');
      check(JSON.parse(module('kv-db').kvGet('ai_phone_user_identities_v1')).find(user=>user.id==='B').bio==='B profile','Profile not restored');
    }, result.archiveBytes);
    delete result.archiveBytes;
    result.freshBrowser = 'passed, A/B restored alongside Z';
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
