const fs=require('fs'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto'),path=require('path');
let state='queued',removed=[],error='',enabled=true,save='default',activeRemoved=false,createdUrl='';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},permissions:{contains:async()=>true},
 tabs:{get:async()=>({id:42,url:'https://example.com/watch',title:'Fixture'}),query:async()=>[{id:42,url:'https://example.com/watch'}],
 create:async x=>{createdUrl=x.url;assert.equal(x.active,false);return {id:100}},remove:async x=>removed.push(x)},
 storage:{local:{get:async()=>({saveMode:save}),set:async x=>{save=x.saveMode}}}};
const c=vm.createContext({chrome,URL,crypto:webcrypto,console,setTimeout:fn=>setImmediate(fn),clearTimeout,
 queueReady:Promise.resolve(),updatingExtension:false,terminalPhases:new Set(['complete','error','cancelled']),
 parentEnabled:async()=>enabled,prepareDownload:async()=>({id}),currentRow:async()=>({id,phase:state,status:state==='preparing'?'권한 허용 필요':'',detail:'blocked'}),
 finishJob:async(a,b,c,d)=>{error=d},removeQueueItem:async()=>{activeRemoved=true;return {ok:true}},showQueueFolder:async()=>({ok:true})});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/mcp-background.js'),'utf8'),c);
async function call(name,args={}){c.req={method:'tools/call',params:{name,arguments:args}};return vm.runInContext('mcpDispatch(req)',c);}
(async()=>{
 assert.equal((await call('media_tabs')).tabs[0].tabId,42);
 const r=await call('media_download',{tabId:42,frameId:5,mode:'audio'});assert.equal(r.id,id);assert(/&frame=5&prepare=[a-f0-9-]+&audio&autoSave=[a-f0-9-]+&quick$/.test(createdUrl));assert.deepEqual(removed,[100]);
 c.authId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';c.authMsg={id:c.authId,prepareId:id,tabId:42};vm.runInContext('mcpAutomaticSaves.set(authId,{tabId:42,prepareId:"'+id+'",used:false})',c);
 c.authSender={frameId:1,url:'chrome-extension://test/player-menu.html?request='+c.authId};assert.throws(()=>vm.runInContext('mcpAuthorizeSave(authMsg,authSender)',c));
 c.authSender.frameId=0;assert(vm.runInContext('mcpAuthorizeSave(authMsg,authSender)',c).ok);assert.throws(()=>vm.runInContext('mcpAuthorizeSave(authMsg,authSender)',c));
 state='preparing';await assert.rejects(call('media_download',{tabId:42}));assert(error.includes('권한'));assert.deepEqual(removed,[100,100]);
 await assert.rejects(call('queue_item_remove',{id}));assert.equal(activeRemoved,false);
 state='complete';await call('queue_item_remove',{id});assert.equal(activeRemoved,true);
 assert.equal((await call('save_mode',{mode:'ask'})).mode,'ask');await assert.rejects(call('save_mode',{mode:'invalid'}));
 enabled=false;await assert.rejects(call('media_download',{tabId:42}));
 console.log('Media MCP quick-player routing, frame/audio, permission failure, cleanup, queue protection and save mode PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
