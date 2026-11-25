const fs=require('fs'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto'),path=require('path');
let tabUrl='https://example.com/watch',enabled=true,allowed=true,selected=[],removed=[],errorMode=false;
const sample=[{kind:'direct',url:'https://cdn.example/video.mp4?secret=testtoken',label:'720p',height:720},{kind:'direct',url:'https://cdn.example/video2.mp4?secret=testtoken',label:'1080p',height:1080}];
const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},permissions:{contains:async()=>allowed},
 tabs:{get:async()=>({id:42,url:tabUrl,title:'Fixture'}),create:async opts=>{assert.equal(opts.active,false);if(opts.url.startsWith('chrome-extension:')){const id=new URL(opts.url).searchParams.get('request');setImmediate(()=>{c.msg={id,...(errorMode?{error:'no video'}:{items:sample})};c.sender={url:opts.url};vm.runInContext('mcpInspectionResult(msg,sender)',c)})}return{id:100}},remove:async id=>removed.push(id)},
 storage:{local:{get:async()=>({saveMode:'ask'})}}};
const c=vm.createContext({chrome,URL,crypto:webcrypto,console,setTimeout,clearTimeout,queueReady:Promise.resolve(),updatingExtension:false,
 parentEnabled:async()=>enabled,enqueueDownload:async job=>{selected.push(job);return{ok:true,id:'job'}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/mcp-background.js'),'utf8'),c);
async function call(name,args={}){c.req={method:'tools/call',params:{name,arguments:args}};return vm.runInContext('mcpDispatch(req)',c)}
(async()=>{
 await assert.rejects(call('open_url',{url:'file:///secret'}));await assert.rejects(call('open_url',{url:'https://user:pass@example.com'}));assert((await call('open_url',{url:'https://example.com'})).ok);
 const scan=await call('media_inspect',{tabId:42});assert.equal(scan.items.length,2);assert(!JSON.stringify(scan).includes('testtoken'));assert.deepEqual(removed,[100]);
 await assert.rejects(call('media_select',{inspectionId:scan.inspectionId,index:99}));allowed=false;await assert.rejects(call('media_select',{inspectionId:scan.inspectionId,index:0}));allowed=true;
 await call('media_select',{inspectionId:scan.inspectionId,index:1});assert.equal(selected[0].height,1080);assert.equal(selected[0].saveAs,false);await assert.rejects(call('media_select',{inspectionId:scan.inspectionId,index:1}));
 const next=await call('media_inspect',{tabId:42,mode:'audio'});tabUrl='https://example.com/other';await assert.rejects(call('media_select',{inspectionId:next.inspectionId,index:0}));tabUrl='https://example.com/watch';
 const third=await call('media_inspect',{tabId:42});const concurrent=await Promise.allSettled([call('media_select',{inspectionId:third.inspectionId,index:0}),call('media_select',{inspectionId:third.inspectionId,index:0})]);assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
 errorMode=true;await assert.rejects(call('media_inspect',{tabId:42}));assert.equal(removed.length,4);
 enabled=false;await assert.rejects(call('media_inspect',{tabId:42}));
 console.log('Format inspection: private URLs, exact selection, one-time use, page/permission guards and cleanup PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
