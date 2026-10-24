const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict'),{performance}=require('perf_hooks');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clone=v=>JSON.parse(JSON.stringify(v));
let rows=[],store=new Map(),writes=[];
const box={exports:{},require:id=>id==='./chat-retry-version-store'?{CHAT_RETRY_VERSIONS_PREFIX:'ai_phone_chat_retry_versions:'}:id==='./kv-db'?{kvGet:k=>store.get(k)||null,kvSetAsync:async(k,v)=>{writes.push(v.length);store.set(k,v);}}:id==='./chat-storage'?{loadChatMessages:()=>rows.slice(),restoreChatRetryMessages:async(s,ids,next)=>{const removed=new Set([...ids,...next.map(r=>r.id)]);rows=rows.filter(r=>!removed.has(r.id)).concat(next).sort((a,b)=>a.order-b.order);}}:{loadChatOfflineTurns:()=>[],restoreChatRetryOfflineTurns:async()=>{}},performance};
vm.runInNewContext(compile(fs.readFileSync('lib/chat-retry-versions.ts','utf8')),box);const api=box.exports;
(async()=>{const report=[];for(const count of [100,1000,10000]){
 rows=Array.from({length:count},(_,i)=>({id:'m'+i,sessionId:'s',role:i%2?'assistant':'user',content:'合成聊天文本。'.repeat(55),order:i,createdAt:new Date(1700000000000+i*1000).toISOString(),status:'sent'}));store=new Map();writes=[];const original=clone(rows);let t=performance.now();let series=await api.beginRetryVersion('s','m1','tail');const prepare=performance.now()-t;
 const switches=[];for(let version=1;version<=30;version++){
  const before=rows.map(r=>r.id);rows=[rows[0],{...original[1],id:'r'+version,content:'模拟重试'+version}];series=await api.finishRetryVersion(series,before);
  t=performance.now();series=await api.selectRetryVersion(series,0);switches.push(performance.now()-t);series=await api.selectRetryVersion(series,series.versions.length-1);if(version<30)series=await api.beginRetryVersion('s','r'+version,'tail',series);
 }
 assert.equal(series.versions.length,31);series=await api.selectRetryVersion(series,0);assert.deepEqual(clone(rows),original);
 report.push({messages:count,versions:series.versions.length,prepareMs:+prepare.toFixed(1),switchMedianMs:+switches.sort((a,b)=>a-b)[15].toFixed(1),switchMaxMs:+Math.max(...switches).toFixed(1),archiveMiB:+(Math.max(...writes)*2/1048576).toFixed(2)});
 }fs.mkdirSync('tmp/qa',{recursive:true});fs.writeFileSync('tmp/qa/retry-performance.json',JSON.stringify(report,null,2));console.table(report);console.log('PASS 100/1k/10k histories, 30 retries and original restoration; timing is Node service work, not browser/phone latency.');})().catch(e=>{console.error(e);process.exitCode=1;});
