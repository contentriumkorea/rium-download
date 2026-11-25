const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.attrs={};this.className='';this.events={};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(name,handler){this.events[name]=handler} remove(){} attachShadow(){return this.shadow=new Node('shadow');}
}
let listener,removedId;const document={getElementById:()=>null,createElement:tag=>new Node(tag),documentElement:new Node('html')};
const chrome={storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},runtime:{onMessage:{addListener:fn=>{listener=fn},removeListener(){}},sendMessage(message,callback){if(message.type==='removeDownload'){removedId=message.id;callback({ok:true});listener({type:'downloadStatus',states:[{id:'new',title:'new',phase:'running'}]})}}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/download-widget.js'),'utf8'),{document,chrome,innerWidth:1000,innerHeight:800,addEventListener(){},removeEventListener(){},setInterval(){return 1},clearInterval(){},console});
const find=(node,cls)=>node.className===cls?node:node.children.map(n=>find(n,cls)).find(Boolean);
(async()=>{
 await new Promise(r=>setImmediate(r));
 const input=[{id:'old',title:'old',phase:'complete',progress:100},{id:'new',title:'new',phase:'running',progress:12}];
 listener({type:'downloadStatus',states:input});
 const list=find(document.documentElement.children[0].shadow,'jobs');
 assert.deepEqual(list.children.map(n=>find(n,'job-title').textContent),['new','old']);
 assert.deepEqual(input.map(x=>x.id),['old','new']);
 listener({type:'downloadStatus',states:[...input,{id:'latest',title:'latest',phase:'queued'}]});
 assert.deepEqual(list.children.map(n=>find(n,'job-title').textContent),['latest','new','old']);
 listener({type:'downloadStatus',states:[{...input[0],progress:90},input[1]]});
 assert.deepEqual(list.children.map(n=>find(n,'job-title').textContent),['new','old']);
 const remove=list.children[1].children[0].children[3].children.find(x=>x.attrs['aria-label']==='목록에서 제거');
 await remove.events.click({currentTarget:remove});assert.equal(removedId,'old');assert.deepEqual(list.children.map(n=>find(n,'job-title').textContent),['new']);
 console.log('Widget newest-first display, progress refresh and source queue preservation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
