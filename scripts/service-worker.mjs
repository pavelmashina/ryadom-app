export function serviceWorkerSource(cache,files){return `
const CACHE=${JSON.stringify(cache)};
const BASE='/ryadom-app/';
const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(
 caches.open(CACHE).then(c=>c.addAll(FILES.map(url=>new Request(url,{cache:'reload'}))))
));
// Keep the current client on its complete version until it closes or explicitly updates.
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=(await caches.keys()).filter(k=>k.startsWith('ryadom-shell-'));
 const keep=new Set([CACHE,...keys.filter(k=>k!==CACHE).slice(-2)]);
 await Promise.all(keys.filter(k=>!keep.has(k)).map(k=>caches.delete(k)));
})()));
async function network(request){
 const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),10000);
 try{return await fetch(request,{signal:abort.signal});}finally{clearTimeout(timer);}
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
 if(event.request.mode==='navigate'){
  event.respondWith((async()=>{
   try{const cached=await (await caches.open(CACHE)).match(BASE+'index.html');if(cached)return cached;}catch{}
   try{const response=await network(event.request);if(response.ok)return response;}catch{}
   return new Response('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Рядом</title><body style="font:18px system-ui;padding:24px;background:#f7f6ee;color:#345941"><h1>Рядом</h1><p>Не удалось загрузить приложение. Проверьте интернет и повторите.</p><button style="font:inherit;padding:12px" onclick="location.reload()">Повторить</button></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
  })());
 }else if(FILES.includes(url.pathname)||url.pathname.startsWith(BASE+'assets/')){
  event.respondWith((async()=>{
   try{const current=await (await caches.open(CACHE)).match(event.request);if(current)return current;
   for(const key of (await caches.keys()).filter(k=>k.startsWith('ryadom-shell-')&&k!==CACHE).reverse()){
    const cached=await (await caches.open(key)).match(event.request);if(cached)return cached;
   }
   }catch{}
   return network(event.request);
  })());
 }
});
`;}
