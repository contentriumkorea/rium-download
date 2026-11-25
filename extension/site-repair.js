'use strict';
let repairChain=Promise.resolve();
function repairSiteRegistrations(){const op=repairChain.catch(()=>{}).then(async()=>{
 const registered=await chrome.scripting.getRegisteredContentScripts();
 // These legacy entries duplicate the now-manifested top-level site scripts.
 const legacy=registered.filter(x=>x.id.startsWith('site_')).map(x=>x.id);
 if(legacy.length)await chrome.scripting.unregisterContentScripts({ids:legacy});
 const ids=new Set(registered.filter(x=>!legacy.includes(x.id)).map(x=>x.id));
 const matches=['http://*/*','https://*/*'];
 const configs=[{id:'generic_authorized_frames',matches,js:['generic-frame.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true},{id:'generic_authorized_watch',matches,js:['media-watch.js'],world:'MAIN',allFrames:true,runAt:'document_start',persistAcrossSessions:true},{id:'party_external_player',matches:['https://api.ydydapi.com/v1/Yl/player/*'],js:['shortcuts.js','party-frame.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true}];
 for(const conf of configs){if(ids.has(conf.id))await chrome.scripting.updateContentScripts([conf]);else await chrome.scripting.registerContentScripts([conf]);}
});repairChain=op;return op;}
