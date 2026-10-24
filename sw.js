const C='coffee-lab-v3';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.indexOf('/api/')===0)return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(ch=>ch.put(e.request,c));return r;}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./'))));});
// timer alarms sent while the app is closed
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
const R=self.registration;
if(d.type==='prog'){e.waitUntil(R.showNotification(d.title||'מעבדת קפה',{body:d.body||'',tag:d.tag,silent:true,renotify:false,requireInteraction:true,timestamp:d.end||Date.now(),icon:'icon-192.png',badge:'badge-96.png',data:{url:d.url||'./',id:d.id||''}}));return;}
e.waitUntil((d.id?R.getNotifications({tag:'run-'+d.id}).then(ns=>ns.forEach(n=>n.close())).catch(()=>{}):Promise.resolve()).then(()=>R.showNotification(d.title||'מעבדת קפה',{body:d.body||'',tag:d.tag||'cl',renotify:true,requireInteraction:true,icon:'icon-192.png',badge:'badge-96.png',vibrate:[400,150,400,150,700],data:{url:d.url||'./',id:d.id||''}})));});
self.addEventListener('notificationclick',e=>{e.notification.close();const d=e.notification.data||{};const url=new URL(d.url||'./',self.registration.scope).href;
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.postMessage({type:'tm-open',id:d.id});return c.focus();}}return self.clients.openWindow(url);}));});
