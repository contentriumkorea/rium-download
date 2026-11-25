const fs=require('fs'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto'),path=require('path');
const root=path.join(__dirname,'../extension');
let links=['https://www.instagram.com/reel/first/','https://www.instagram.com/p/second/'];
let blocked=false,downloads=[],removed=[],permissions=true,currentURL='',phase='complete',photoMode=false;
const chrome={permissions:{contains:async()=>permissions},storage:{local:{get:async()=>({saveMode:'ask'})}},tabs:{
 get:async id=>({id,url:id===7?'https://www.instagram.com/example/':currentURL,status:'complete'}),
 query:async()=>[{id:7,url:'https://www.instagram.com/example/'}],create:async()=>({id:8}),
 update:async(id,{url})=>{currentURL=url;},remove:async id=>removed.push(id)},scripting:{executeScript:async options=>{
 if(options.files)return [];
 if(options.args)return [{result:{blocked,urls:links,href:currentURL||'https://www.instagram.com/example/'}}];
 return [{result:{items:photoMode?[{kind:'direct',mediaType:'image',url:'https://test.cdninstagram.com/image.jpg',filename:'Instagram_post_123.jpg',photoScope:'post'}]:[{kind:'instagram-dash',url:'https://test.cdninstagram.com/v.mp4',audioUrl:'https://test.cdninstagram.com/a.mp4',expectedDuration:1}]}}];
}}};
const c=vm.createContext({chrome,console,URL,crypto:webcrypto,setTimeout:fn=>setImmediate(fn),clearTimeout,
 queueReady:Promise.resolve(),updatingExtension:false,queueStates:async()=>[{id:'old'},{id:'new'}],terminalPhases:new Set(['complete','error','cancelled']),
 enqueueDownload:async job=>{downloads.push(job);return {id:'job'+downloads.length};},currentRow:async()=>({phase}),cancelQueueItem:async()=>{phase='cancelled';}});
vm.runInContext(fs.readFileSync(path.join(root,'mcp-background.js'),'utf8'),c);
vm.runInContext('mcpPort={disconnect(){}}',c);
async function tool(name,args={}){c.request={method:'tools/call',params:{name,arguments:args}};return vm.runInContext('mcpDispatch(request)',c);}
async function settle(){for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));if(!vm.runInContext('mcpBatch?.running',c))return;}throw Error('batch did not settle');}
(async()=>{
 assert.equal((await tool('instagram_tabs')).tabs[0].username,'example');
 await assert.rejects(tool('instagram_collect',{tabId:7,username:'other'}));
 const collected=await tool('instagram_collect',{tabId:7,username:'example',limit:2});
 assert.equal(collected.count,2);assert.equal(collected.complete,false);
 assert.deepEqual((await tool('download_status')).states.map(x=>x.id),['new','old']);
 await tool('instagram_download',{collectionId:collected.collectionId,mode:'audio'});await settle();
 assert.equal(downloads.length,2);assert(downloads.every(d=>d.outputMode==='audio'&&d.saveAs===false));assert.deepEqual(removed,[8]);
 await assert.rejects(tool('instagram_download',{collectionId:collected.collectionId}));
 blocked=true;await assert.rejects(tool('instagram_collect',{tabId:7,username:'example'}));blocked=false;
 phase='running';const next=await tool('instagram_collect',{tabId:7,username:'example',limit:2});
 await tool('instagram_download',{collectionId:next.collectionId});
 for(let i=0;i<30&&!vm.runInContext('mcpBatch.activeId',c);i++)await new Promise(r=>setImmediate(r));
 await tool('download_cancel');await settle();assert.equal(downloads.length,3);assert.equal(phase,'cancelled');
 phase='complete';photoMode=true;const photos=await tool('instagram_collect',{tabId:7,username:'example',limit:2});await tool('instagram_download',{collectionId:photos.collectionId,mode:'photo'});await settle();assert(downloads.slice(-2).every(d=>d.mediaType==='image'&&d.outputMode==='photo'&&d.saveAs===false));
 permissions=false;await assert.rejects(tool('instagram_tabs'));
 await assert.rejects(tool('instagram_download',{collectionId:'x',path:'arbitrary'}));
 console.log('MCP tools: collection/account guards, batch FIFO, audio/save settings, duplicate rejection, cancellation and permission guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
