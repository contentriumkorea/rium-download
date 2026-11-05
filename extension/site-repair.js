'use strict';
let repairChain=Promise.resolve();
function repairSiteRegistrations(){const op=repairChain.catch(()=>{}).then(async()=>{
 const sites=(await chrome.storage.local.get('sites')).sites||{};
 const registered=await chrome.scripting.getRegisteredContentScripts(),ids=new Set(registered.map(x=>x.id));
 for(const [site,on] of Object.entries(sites)){
  if(!on||site==='https://redko5.com')continue;
  let u;try{u=new URL(site);}catch(_){continue;}
  if(!['https:','http:'].includes(u.protocol)||u.origin!==site)continue;
  const pattern=site+'/*';if(!await chrome.permissions.contains({origins:[pattern]}))continue;
  const id='site_'+btoa(site).replace(/[^a-zA-Z0-9]/g,'_');
  const configs=[{id,matches:[pattern],js:['x-support.js','instagram-support.js','shortcuts.js','download-widget.js','player-download.js'],runAt:'document_start',persistAcrossSessions:true},{id:id+'_watch',matches:[pattern],js:['media-watch.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true}];
  for(const conf of configs)if(!ids.has(conf.id)){await chrome.scripting.registerContentScripts([conf]);ids.add(conf.id);}
 }
 if(sites['https://yadongparty10.com']&&await chrome.permissions.contains({origins:['https://api.ydydapi.com/*']})){
  const conf={id:'party_external_player',matches:['https://api.ydydapi.com/v1/Yl/player/*'],js:['shortcuts.js','party-frame.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true};
  if(!ids.has(conf.id))await chrome.scripting.registerContentScripts([conf]);
 }
 // Bridge only origins the user has already granted; parent site enablement is checked on every report.
 const granted=(await chrome.permissions.getAll()).origins||[];
 const matches=granted.filter(p=>/^https?:\/\//.test(p));
 const genericIds=['generic_authorized_frames','generic_authorized_watch'];
 if(matches.length){
  const configs=[{id:genericIds[0],matches,js:['generic-frame.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true},{id:genericIds[1],matches,js:['media-watch.js'],world:'MAIN',allFrames:true,runAt:'document_start',persistAcrossSessions:true}];
  for(const conf of configs){if(ids.has(conf.id))await chrome.scripting.updateContentScripts([conf]);else await chrome.scripting.registerContentScripts([conf]);}
 }else{const remove=genericIds.filter(id=>ids.has(id));if(remove.length)await chrome.scripting.unregisterContentScripts({ids:remove});}
});repairChain=op;return op;}
