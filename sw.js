const C='coffee-lab-v4';
const TMF='https://br-curly-unit-awvgmofa-coffeetimer.compute.c-12.us-east-1.aws.neon.tech';
const tmp=(p,b)=>fetch(TMF+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).catch(()=>{});
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.indexOf('/api/')===0)return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(ch=>ch.put(e.request,c));return r;}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./'))));});
// timer alarms sent while the app is closed
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
const R=self.registration;
if(d.type==='prog'){e.waitUntil(R.showNotification(d.title||'מעבדת קפה',{body:d.body||'',tag:d.tag,silent:true,renotify:false,requireInteraction:true,timestamp:d.end||Date.now(),icon:'icon-192.png',badge:'badge-96.png',data:{url:d.url||'./',id:d.id||''}}));return;}
const opt={body:d.body||'',tag:d.tag||'cl',renotify:true,requireInteraction:true,icon:'icon-192.png',badge:'badge-96.png',vibrate:[900,250,900,250,900,250,900,250,900,250,900],data:{url:d.url||'./',id:d.id||'',owner:d.owner||'',alarm:!!d.alarm,title:d.title||'',body:d.body||''}};
if(d.alarm)opt.actions=[{action:'stop',title:'⏹ עצירה'},{action:'snooze',title:'💤 עוד 5 דק׳'}];
e.waitUntil((d.id?R.getNotifications({tag:'run-'+d.id}).then(ns=>ns.forEach(n=>n.close())).catch(()=>{}):Promise.resolve()).then(()=>R.showNotification(d.title||'מעבדת קפה',opt)));});
self.addEventListener('notificationclick',e=>{e.notification.close();const d=e.notification.data||{};const url=new URL(d.url||'./',self.registration.scope).href;
const acts=[];
if(d.alarm&&d.owner&&d.id){
 if(e.action==='snooze'){acts.push(tmp('/at',{owner:d.owner,id:d.id,at:Date.now()+5*60000,title:d.title,body:(d.body||'').replace(/ · עדיין מצלצל.*$/,''),tag:d.id,url:d.url}));e.waitUntil(Promise.all(acts));return;}
 acts.push(tmp('/cancel',{owner:d.owner,id:d.id}));
 if(e.action==='stop'){e.waitUntil(Promise.all(acts).then(()=>self.clients.matchAll({type:'window',includeUncontrolled:true})).then(cs=>cs.forEach(c=>c.postMessage({type:'tm-stop',id:d.id}))));return;}}
acts.push(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.postMessage({type:'tm-open',id:d.id,stop:!!d.alarm});return c.focus();}}return self.clients.openWindow(url);}));
e.waitUntil(Promise.all(acts));});
