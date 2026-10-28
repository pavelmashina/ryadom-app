import * as webpush from "jsr:@negrel/webpush@0.5.0";
type Job={id:string;user_id:string;stock_item_id:string;pet_id:string;
  occurrence_at:string;title:string;comment:string;timezone:string;};
type Subscription={id:string;endpoint:string;p256dh:string;auth:string;};
const url=Deno.env.get("SUPABASE_URL");
const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}") as Record<string,string>;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||keys.default;
if(!url||!key)throw Error("Missing server configuration");
const headers:Record<string,string>={apikey:key,"Content-Type":"application/json","Cache-Control":"no-store"};
if(key.startsWith("eyJ"))headers.Authorization="Bearer "+key;
async function api(path:string,init:RequestInit={}){
 const response=await fetch(url+"/rest/v1"+path,{...init,headers:{...headers,...init.headers}});
 if(!response.ok)throw Error("Storage API error: "+response.status);
 if(response.status===204)return null;
 return response.json();
}
function rpc(method:string,body:object={}){return api("/rpc/"+method,{method:"POST",body:JSON.stringify(body)});}
const esc=encodeURIComponent;
function from64(s:string) {
 const norm=s.replace(/-/g,"+").replace(/_/g,"/");
 return Uint8Array.from(atob(norm+"=".repeat((4-norm.length%4)%4)),v=>v.charCodeAt(0));
}
function base64(bytes:Uint8Array) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function sender(){
 const config=await rpc("push_worker_vapid") as {publicKey:string;privateKey:string};
 const bytes=from64(config.publicKey);
 if(bytes.length!==65||bytes[0]!==4)throw Error("Invalid VAPID key");
 const pub={kty:"EC",crv:"P-256",x:base64(bytes.slice(1,33)),y:base64(bytes.slice(33,65))};
 const keys=await webpush.importVapidKeys({
  publicKey:{...pub,ext:true,key_ops:["verify"]},
  privateKey:{...pub,d:config.privateKey,ext:true,key_ops:["sign"]},
 });
 return webpush.ApplicationServer.new({
  contactInformation:"https://pavelmashina.github.io/ryadom-app/",vapidKeys:keys,
 });
}
async function update(job:Job,status:"sent"|"failed",attempts=1,error=""){
 await api("/stock_notification_deliveries?id=eq."+esc(job.id),{
  method:"PATCH",body:JSON.stringify({status,sent_at:status==="sent"?new Date().toISOString():null,
   next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**attempts)).toISOString(),
   last_error:error.slice(0,160)}),
 });
}
async function notificationText(job:Job):Promise<{title:string;body:string}>{
 const pets=await api("/pets?select=name&id=eq."+esc(job.pet_id)+"&deleted_at=is.null") as {name:string}[];
 const name=pets?.[0]?.name?.trim();
 if(!name)throw Error("Notification pet is missing");
 return {
  title:name.slice(0,120),
  body:[job.title?.trim(),job.comment?.trim()].filter(Boolean).join(" · ").slice(0,240),
 };
}
async function deliver(job:Job,server:webpush.ApplicationServer){
 const display=await notificationText(job);
 const subs=await api("/push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq."+esc(job.user_id)) as Subscription[];
 if(!subs?.length){await update(job,"failed",1,"No subscribed devices");return false;}
 const table="/stock_notification_device_deliveries";
 const previous=await api(table+"?select=subscription_id&delivery_id=eq."+esc(job.id)+"&sent_at=not.is.null") as {subscription_id:string}[];
 const done=new Set(previous.map(s=>s.subscription_id));
 let failed=false;
 for(const sub of subs){
  if(done.has(sub.id))continue;
  try{
   const message=JSON.stringify({
    title:display.title,body:display.body,
    stockItemId:job.stock_item_id,at:job.occurrence_at,icon:"/ryadom-app/icon-192.png",
    url:"/ryadom-app/?stockPet="+esc(job.pet_id)+"&stock="+esc(job.stock_item_id),
   });
   await server.subscribe({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}})
    .pushTextMessage(message,{ttl:3600});
   await api(table+"?on_conflict=delivery_id,subscription_id",{
    method:"POST",headers:{Prefer:"resolution=merge-duplicates"},
    body:JSON.stringify({delivery_id:job.id,subscription_id:sub.id,attempts:1,
     sent_at:new Date().toISOString(),last_error:null}),
   });
  }catch(e){
   const gone=e instanceof webpush.PushMessageError &&
    (e.response.status===404||e.response.status===410);
   if(gone){await api("/push_subscriptions?id=eq."+esc(sub.id),{method:"DELETE"});continue;}
   failed=true;
   await api(table+"?on_conflict=delivery_id,subscription_id",{
    method:"POST",headers:{Prefer:"resolution=merge-duplicates"},
    body:JSON.stringify({delivery_id:job.id,subscription_id:sub.id,attempts:1,
      last_error:"Push provider unavailable"}),
   });
  }
 }
 await update(job,failed?"failed":"sent",1,failed?"Some devices failed":"");
 return !failed;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 const token=req.headers.get("x-cron-token")||"";
 if(token.length<24)return new Response("Unauthorized",{status:401});
 try{
  if(await rpc("push_worker_verify",{token})!==true)
   return new Response("Unauthorized",{status:401});
  const queued=await rpc("enqueue_due_stock_push");
  const jobs=await rpc("claim_due_stock_push",{max_jobs:25}) as Job[];
  if(!jobs.length)return Response.json({queued,processed:0});
  const server=await sender();
  let sent=0;
  for(const job of jobs){
   try{if(await deliver(job,server))sent++;}
   catch{await update(job,"failed",2,"Delivery failure");}
  }
  return Response.json({queued,processed:jobs.length,sent});
 }catch{return Response.json({error:"Stock push worker unavailable"},{status:503});}
});
