/* Pocket Tuna service worker: แสดงแจ้งเตือนจาก web push และเปิดแอปเมื่อแตะ */
self.addEventListener('install',function(){self.skipWaiting()});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});
self.addEventListener('push',function(e){
  var d={};try{d=e.data?e.data.json():{}}catch(x){d={t:'Pocket Tuna',b:e.data?e.data.text():''}}
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    var vis=cs.some(function(c){return c.visibilityState==='visible'});
    cs.forEach(function(c){c.postMessage({push:d})});
    if(vis&&!/iPhone|iPad/.test(self.navigator.userAgent)&&d.kind!=='test')return;
    return self.registration.showNotification(d.t||'Pocket Tuna',{body:d.b||'',tag:d.tag||'pt',renotify:true,icon:'icon-192.png',badge:'icon-192.png',
      requireInteraction:d.kind==='call'||d.kind==='alarm',vibrate:d.kind==='call'?[300,150,300,150,300]:[200,100,200],data:{url:d.url||'#'}});
  }));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();var h=(e.notification.data&&e.notification.data.url)||'#';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    for(var i=0;i<cs.length;i++){var c=cs[i];c.postMessage({open:h});if('focus' in c)return c.focus()}
    return self.clients.openWindow('./'+h);
  }));
});
