const fs=require('fs'),vm=require('vm'),assert=require('assert');
const script=fs.readFileSync('extension/update-check.js','utf8');
async function run(result){
 const elements=[];let reloads=0,sent=[];
 const doc={createElement(tag){const e={tag,hidden:false,disabled:false,events:{},setAttribute(){},append(...a){this.children=a},addEventListener(type,fn){this.events[type]=fn}};elements.push(e);return e;},querySelector(){return {append(){}}}};
 const chrome={runtime:{getManifest:()=>({version:'2.8.3'}),sendMessage:async m=>(sent.push(m),result),reload:()=>reloads++},storage:{local:{get:async()=>({}),set:async()=>{}}}};
 const ctx={document:doc,location:{pathname:'/popup.html'},chrome,fetch:async()=>({ok:true,json:async()=>({tag_name:'v2.8.4',draft:false,prerelease:false})}),AbortSignal,Date,console};
 vm.runInNewContext(script,ctx);await new Promise(r=>setImmediate(r));
 const [section,label,link,check,apply]=elements;
 assert.equal(apply.hidden,false);assert.equal(link.hidden,true);await apply.events.click();
 return {label,link,apply,sent,get reloads(){return reloads;}};
}
(async()=>{let x=await run({ok:true,version:'2.8.4'});assert.equal(x.reloads,1);assert.equal(x.sent[0].type,'applyUpdate');let y=await run({ok:false,error:'실패'});assert.equal(y.reloads,0);assert.equal(y.link.hidden,false);assert.equal(y.apply.disabled,false);console.log('Update button triggers installation, reloads on success, exposes fallback on error PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
