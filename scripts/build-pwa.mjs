import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// Generate small PNG icons without a runtime dependency or external request.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([size, t, data, crc]);
}
function icon(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const ellipses = [[.5,.61,.18,.14],[.30,.43,.065,.085],[.43,.32,.065,.085],[.58,.32,.065,.085],[.71,.43,.065,.085]];
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const paw=ellipses.some(([cx,cy,rx,ry])=>((x/size-cx)/rx)**2+((y/size-cy)/ry)**2<=1);
    const color=paw?[249,247,239]:[52,89,65];
    const offset=y*(size*3+1)+1+x*3;
    color.forEach((v,i)=>raw[offset+i]=v);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
for(const size of [192,512]) writeFileSync(`dist/icon-${size}.png`,icon(size));
writeFileSync('dist/apple-touch-icon.png',icon(180));
writeFileSync('dist/manifest.webmanifest',JSON.stringify({
  id:'/ryadom-app/',name:'Рядом — забота о питомце',short_name:'Рядом',lang:'ru',
  start_url:'/ryadom-app/',scope:'/ryadom-app/',display:'standalone',
  background_color:'#f9f7ef',theme_color:'#345941',
  icons:[192,512].map(size=>({src:`icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'}))
},null,2));
const files=readdirSync('dist',{recursive:true,withFileTypes:true}).filter(f=>f.isFile())
  .map(f=>(`${f.parentPath}/${f.name}`).replaceAll('\\','/').replace(/^dist\//,''))
  .filter(f=>f!=='sw.js');
const version=createHash('sha256');
for(const f of files.sort()) version.update(readFileSync(`dist/${f}`));
const cache=`ryadom-shell-${version.digest('hex').slice(0,16)}`;
writeFileSync('dist/sw.js',`
const CACHE=${JSON.stringify(cache)};
const BASE='/ryadom-app/';
const FILES=${JSON.stringify(files.map(f=>'/ryadom-app/'+f))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ryadom-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
  if(event.request.mode==='navigate') {
    event.respondWith(caches.open(CACHE).then(c=>c.match(BASE+'index.html')).then(r=>r||fetch(event.request)));
  } else if(FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(c=>c.match(event.request)).then(r=>r||fetch(event.request)));
  }
});
`);
console.log(`PWA: ${files.length} files, ${cache}`);
