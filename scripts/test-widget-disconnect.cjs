const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
class Node { constructor(){this.children=[];this.dataset={};this.style={setProperty(){}};this.removed=false;} append(...n){this.children.push(...n)} replaceChildren(...n){this.children=n} setAttribute(){} addEventListener(){} remove(){this.removed=true} attachShadow(){return this.shadow=new Node()} }
let check,cleared=false;
const document={getElementById:()=>null,createElement:()=>new Node(),documentElement:new Node()};
const chrome={storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},runtime:{id:'valid',onMessage:{addListener(){},removeListener(){throw Error('Extension context invalidated.')}},sendMessage(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/download-widget.js'),'utf8'),{document,chrome,innerWidth:1000,innerHeight:800,addEventListener(){},removeEventListener(){},setInterval(fn){check=fn;return 1},clearInterval(){cleared=true},console});
chrome.runtime.id=undefined;check();assert(document.documentElement.children[0].removed);assert(cleared);
console.log('Invalidated extension context removes stale widget and stops timer PASS');
