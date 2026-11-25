const fs=require('fs'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto'),path=require('path');
let enabled=true, found=true, saveMode='ask', queued=[], cancelled=[];
const url='https://www.youtube.com/watch?v=abcdefghijk';
const chrome={tabs:{query:async()=>[{id:4,url,title:'Test'}],get:async()=>({id:4,url,title:'Test'})},
 storage:{local:{get:async()=>({saveMode})}}, scripting:{executeScript:async opts=>opts.files?[]:[{result:found?{items:[{kind:'youtube-native',url,title:'Test',mediaType:'video'}]}:{items:[],reason:'광고 또는 라이브'}}]}};
const c=vm.createContext({chrome,URL,crypto:webcrypto,console,setTimeout,clearTimeout,queueReady:Promise.resolve(),updatingExtension:false,
 youtubeId:u=>u===url?'abcdefghijk':null,parentEnabled:async()=>enabled,
 enqueueDownload:async job=>{queued.push(job);return {ok:true,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};},
 currentRow:async()=>({phase:'running'}),cancelQueueItem:async id=>{cancelled.push(id);return {ok:true};}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/mcp-background.js'),'utf8'),c);
async function call(name,args={}){c.req={method:'tools/call',params:{name,arguments:args}};return vm.runInContext('mcpDispatch(req)',c);}
(async()=>{
 assert.equal((await call('youtube_tabs')).tabs[0].tabId,4);
 await call('youtube_download',{tabId:4,mode:'audio'});
 assert.equal(queued[0].kind,'youtube-native');assert.equal(queued[0].outputMode,'audio');assert.equal(queued[0].saveAs,false);
 saveMode='default';await call('youtube_download',{tabId:4,mode:'video'});assert.equal(queued[1].saveAs,false);
 enabled=false;await assert.rejects(call('youtube_download',{tabId:4}));enabled=true;
 found=false;await assert.rejects(call('youtube_download',{tabId:4}));found=true;
 await assert.rejects(call('youtube_download',{tabId:4,mode:'shell'}));
 await call('queue_item_cancel',{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});assert.equal(cancelled.length,1);
 await assert.rejects(call('queue_item_cancel',{id:'not-an-id'}));
 console.log('YouTube MCP selected player, audio/video, save setting, blocked player and item cancellation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
