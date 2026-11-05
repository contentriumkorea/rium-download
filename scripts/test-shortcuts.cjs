const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('extension/shortcuts.js', 'utf8');
async function fixture(hostname, platform = "Win32") {
  let listener;
  class Element { closest(){return null;} }
  class HTMLVideoElement extends Element {}
  const video = new HTMLVideoElement();
  Object.assign(video,{duration:100,currentTime:10,paused:false,isConnected:true,volume:0.5,
    getBoundingClientRect:()=>({width:640,height:360}),pause(){this.paused=true;},
    addEventListener(){},removeEventListener(){},play(){this.paused=false;return Promise.resolve();}});
  const document = {querySelectorAll:s=>s==='video'?[video]:[],addEventListener:(s,f)=>{if(s==='keydown')listener=f;},removeEventListener(){}};
  const chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage:()=>Promise.resolve({})},storage:{local:{get:()=>Promise.resolve({sites:{['https://'+hostname]:true}})},onChanged:{addListener(){},removeListener(){}}}};
  const window={};window.top=window;
  const ctx={navigator:{platform},document,window,location:{protocol:'https:',hostname},chrome,Element,HTMLVideoElement,getComputedStyle:()=>({visibility:'visible',display:'block'}),setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,console};
  vm.runInNewContext(source,ctx);await new Promise(r=>setImmediate(r));
  function press(key,opts={}) {const e={key,code:key===' '?'Space':key,ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,isComposing:false,repeat:false,defaultPrevented:false,target:video,composedPath:()=>[video],preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...opts};listener(e);return e;}
  return {press,video};
}
(async()=>{
 for(const host of ['www.youtube.com','m.youtube.com','youtube.com']) {
  const {press,video}=await fixture(host);
  for(const key of [' ','k','j','l','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','m','f','t']) assert.equal(press(key).defaultPrevented,false,host+' '+key);
  assert.equal(press('ArrowRight',{shiftKey:true}).defaultPrevented,false);
  const ctrl=press('ArrowRight',{ctrlKey:true});assert.equal(ctrl.defaultPrevented,true);assert.equal(video.paused,true);assert(video.currentTime>10);
 }
 const mac=await fixture('www.youtube.com', 'MacIntel');const opt=mac.press('ArrowLeft',{altKey:true});assert.equal(opt.defaultPrevented,true);assert.equal(mac.video.paused,true);assert(mac.video.currentTime<10);assert.equal(mac.press('ArrowRight',{altKey:true,shiftKey:true}).defaultPrevented,false);assert.equal(mac.press('ArrowRight',{metaKey:true}).defaultPrevented,false);
 const win=await fixture('www.youtube.com');assert.equal(win.press('ArrowRight',{altKey:true}).defaultPrevented,false);
 const other=await fixture('example.com');assert.equal(other.press('ArrowRight').defaultPrevented,true);assert.equal(other.video.currentTime,15);
 console.log('YouTube Ctrl+arrow only; native keys pass through; other sites unchanged: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
