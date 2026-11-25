const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const document={nodeType:9,baseURI:'https://page.example/watch',querySelectorAll:()=>[video]};
const win={innerWidth:1280,innerHeight:720,frameElement:null,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),performance:{getEntriesByType:()=>[{name:'https://cdn.example/old-a.m3u8'},{name:'https://cdn.example/old-b.m3u8'}]}};document.defaultView=win;
const video={tagName:'VIDEO',isConnected:true,ownerDocument:document,parentElement:null,shadowRoot:null,currentSrc:'blob:https://page.example/test',duration:8,videoHeight:720,videoWidth:1280,paused:false,mediaKeys:null,className:'',getBoundingClientRect:()=>({left:0,top:0,right:640,bottom:360,width:640,height:360}),getRootNode:()=>document,getAttribute:()=>null,querySelectorAll:()=>[],querySelector:()=>null};
const hls={media:video,url:'https://cdn.example/current.m3u8'};
const hook={memoizedState:{current:video},next:{memoizedState:{current:hls},next:null}};
video.__reactFiber$test={memoizedState:null,return:{memoizedState:hook,return:null}};
let playlist='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:4,\npart1.ts\n#EXTINF:4,\npart2.ts\n#EXT-X-ENDLIST\n',switchDuringFetch=false;
const context=vm.createContext({document,window:win,URL,console,Uint8Array,TextDecoder,Response,fetch:async()=>{if(switchDuringFetch)hls.url='https://cdn.example/other.m3u8';return new Response(playlist,{status:200})},videoShortcutAdaptive:{inspect:async()=>{throw Error('Adaptive manifest: encrypted HLS')}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/media-collect.js'),'utf8'),context);
(async()=>{
 let result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'hls');assert.equal(result.items[0].url,hls.url);
 switchDuringFetch=true;result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);assert(result.reason.includes('변경'));switchDuringFetch=false;hls.url='https://cdn.example/current.m3u8';
 hook.memoizedState.current={};result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);assert(result.reason.includes('여러 스트리밍'));
 hook.memoizedState.current=video;playlist=playlist.replace('URI="key"','URI="https://other.example/key"');result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);
 playlist=playlist.replace('URI="https://other.example/key"','URI="key"').replace('METHOD=AES-128','METHOD=SAMPLE-AES');result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);
 playlist=playlist.replace('METHOD=SAMPLE-AES','METHOD=AES-128').replace('#EXTINF:4,\npart2.ts','#EXTINF:8,\npart2.ts');result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);
 video.mediaKeys={};result=await context.videoShortcutMedia.collect();assert.equal(result.items.length,0);assert(result.reason.includes('DRM'));
 console.log('Bound React HLS identity, stale manifests, AES constraints, duration and DRM guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

