const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
let state=0,effect,recordCount=0,cleanup;
const room={id:'one',status:'invited',startedAt:Date.now()};
const box={exports:{},Date,window:{setTimeout:()=>{throw Error("join-only glow must not schedule overlap timers");}},require:id=>id==='react'?{
 useId:()=>"test-glow",useState:()=>[state,v=>{state=typeof v==='function'?v(state):v;}],useEffect:f=>{effect=f;},
}:id==='./listening-presence'?{useListeningPresence:()=>({room})}:id==='@/lib/listen-together'?{
 getListeningRoom:()=>room,recordListeningGlow:id=>{assert.equal(id,room.id);room.lastGlowAt=Date.now();recordCount++;},
}:{jsx:()=>null,jsxs:()=>null}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/music/listening-glow.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,box);
const render=()=>{cleanup?.();box.exports.ListeningGlow();cleanup=effect();};
render();assert.equal(state,0);
room.status='joined';render();assert.equal(state,1);assert.equal(recordCount,1);
render();assert.equal(recordCount,1,'strict effect does not repeat glow');
state=0;render();assert.equal(state,0,'page remount does not replay room');
render();assert.equal(state,0,'continued listening does not replay effect');assert.equal(recordCount,1);
room.status='declined';render();assert.equal(state,0);
room.status='joined';render();assert.equal(recordCount,1,'same joined room is not replayed');
room.id='two';delete room.lastGlowAt;room.status='joined';render();assert.equal(state,1);assert.equal(recordCount,2);
console.log('PASS: join once, no overlap timers, remount deduplication, exit and new session.');
