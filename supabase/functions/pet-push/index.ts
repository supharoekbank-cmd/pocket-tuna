import webpush from "npm:web-push@3.6.7";
// Pocket Tuna web push
//  {kind:'wt'|'call', user, token, to, call?}  -> แจ้งเตือนผู้รับ (ต้องเป็นรายชื่อกันทั้งสองฝั่ง)
//  {kind:'test', user, token}                  -> แจ้งเตือนทดสอบหาตัวเอง
//  {kind:'tick', secret}                       -> เรียกทุกนาทีจาก pg_cron: ปลุก นัด งาน
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, authorization, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const URL0=Deno.env.get('SUPABASE_URL')!,SK=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SH={apikey:SK,Authorization:'Bearer '+SK,'Content-Type':'application/json'};
const db=(p:string,init:RequestInit={})=>fetch(URL0+'/rest/v1/'+p,{...init,headers:{...SH,...(init.headers||{})}}).then(r=>r.ok?r.json().catch(()=>null):null);
let CFG:any=null;
async function cfg(){if(!CFG){const rows=await db('tama_cfg?select=k,v');CFG={};(rows||[]).forEach((r:any)=>CFG[r.k]=r.v);
  webpush.setVapidDetails('https://supharoekbank-cmd.github.io/pocket-tuna/',CFG.vapid_pub,CFG.vapid_priv)}return CFG}
async function auth(user:string,token:string){const r=await fetch(URL0+'/rest/v1/rpc/tama_auth',{method:'POST',headers:SH,body:JSON.stringify({p_user:user,p_token:token})});return r.ok?await r.json():null}
async function subsOf(users:string[]){if(!users.length)return[];return await db('tama_push?select=endpoint,username,p256dh,auth&username=in.('+users.map(u=>encodeURIComponent('"'+u+'"')).join(',')+')')||[]}
async function send(subs:any[],payload:any,opt:any={}){
  let n=0;await Promise.all(subs.map(async s=>{try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:opt.ttl||3600,urgency:opt.urgency||'normal',topic:opt.topic});n++}
    catch(e:any){const c=e?.statusCode;console.log('push fail',c,String(e?.body||e).slice(0,120));if(c===404||c===410)await db('tama_push?endpoint=eq.'+encodeURIComponent(s.endpoint),{method:'DELETE'})}}));return n}
async function once(k:string){const r=await fetch(URL0+'/rest/v1/tama_push_sent',{method:'POST',headers:{...SH,Prefer:'return=minimal'},body:JSON.stringify({k})});return r.ok}
const pad=(n:number)=>(n<10?'0':'')+n;
function mins(tm:string){const p=String(tm||'').split(':');return +p[0]*60+ +p[1]}
async function tick(){
  const subs=await subsOf((await db('tama_push?select=username')||[]).map((r:any)=>r.username).filter((u:string,i:number,a:string[])=>a.indexOf(u)===i));
  if(!subs.length)return{users:0};
  const users=[...new Set(subs.map((s:any)=>s.username))] as string[];
  const rows=await db('tama_accounts?select=username,apps&username=in.('+users.map(u=>encodeURIComponent('"'+u+'"')).join(',')+')')||[];
  const L=new Date(Date.now()+7*36e5),today=L.getUTCFullYear()+'-'+pad(L.getUTCMonth()+1)+'-'+pad(L.getUTCDate()),now=L.getUTCHours()*60+L.getUTCMinutes(),wd=L.getUTCDay();
  const due=(t:number)=>now>=t&&now<t+3;let sent=0;
  for(const row of rows){
    const U=row.apps||{},mine=subs.filter((s:any)=>s.username===row.username),out:any[]=[];
    for(const a of (U.alarms||[]))if(a&&a.on&&Array.isArray(a.days)&&a.days.includes(wd)&&due(mins(a.tm)))out.push({k:'a:'+a.id+':'+today+a.tm,p:{t:'⏰ '+a.tm,b:a.l||'นาฬิกาปลุก',tag:'alarm',url:'#alarm',kind:'alarm'},u:'high'});
    for(const e of (U.ev||[])){if(!e||e.d!==today||!e.tm)continue;const t=mins(e.tm);
      if(now>=t-10&&now<t)out.push({k:'p:'+e.id,p:{t:'📅 อีก '+(t-now)+' นาที',b:e.t+' · '+e.tm,tag:'ev-'+e.id,url:'#sched',kind:'ev'}});
      else if(due(t))out.push({k:'e:'+e.id,p:{t:'📅 ถึงเวลานัด '+e.tm,b:e.t,tag:'ev-'+e.id,url:'#sched',kind:'ev'},u:'high'})}
    const open=(U.todo||[]).filter((x:any)=>x&&!x.done&&x.due===today);
    for(const x of open)if(x.tm&&due(mins(x.tm)))out.push({k:'t:'+x.id+':'+today,p:{t:'✓ ถึงเวลาทำงาน',b:x.t+' · '+x.tm,tag:'todo-'+x.id,url:'#todo',kind:'todo'}});
    const ad=open.filter((x:any)=>!x.tm);if(ad.length&&due(8*60))out.push({k:'td:'+row.username+':'+today,p:{t:'✓ วันนี้มีงาน '+ad.length+' อย่าง',b:ad.slice(0,3).map((x:any)=>x.t).join(' · '),tag:'todo-day',url:'#todo',kind:'todo'}});
    for(const o of out){if(await once(row.username+'|'+o.k))sent+=await send(mine,o.p,{urgency:o.u||'normal',ttl:600})}
  }
  if(Math.random()<0.05)await db('tama_push_sent?at=lt.'+new Date(Date.now()-3*864e5).toISOString(),{method:'DELETE'});
  return{users:users.length,sent};
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  let b:any;try{b=await req.json()}catch{return J({ok:false,err:'bad'},400)}
  const c=await cfg();
  if(b?.kind==='tick'){if(!c.tick||b.secret!==c.tick)return J({ok:false},403);return J({ok:true,...await tick()})}
  const me=await auth(String(b?.user||''),String(b?.token||''));if(!me)return J({ok:false,err:'auth'});
  if(b.kind==='test'){const n=await send(await subsOf([me]),{t:'🐟 Pocket Tuna',b:'เปิดแจ้งเตือนเรียบร้อย!',tag:'test',url:'#',kind:'test'});return J({ok:true,sent:n})}
  const to=String(b?.to||'');
  const ok=await db('tama_contacts?select=owner&or=(and(owner.eq.'+encodeURIComponent(me)+',other.eq.'+encodeURIComponent(to)+'),and(owner.eq.'+encodeURIComponent(to)+',other.eq.'+encodeURIComponent(me)+'))');
  if(!ok||ok.length<2)return J({ok:false,err:'not_contact'});
  const acc=(await db('tama_accounts?select=display&username=eq.'+encodeURIComponent(me)))?.[0];const name=acc?.display||me;
  if(b.kind==='wt'){const n=await send(await subsOf([to]),{t:'📻 '+name,b:'ส่งเสียงมาหา แตะเพื่อฟัง',tag:'wt-'+me,url:'#wt',kind:'wt'},{ttl:86400});return J({ok:true,sent:n})}
  if(b.kind==='call'){const n=await send(await subsOf([to]),{t:'📞 '+name+' โทรมา',b:'แตะเพื่อรับสาย',tag:'call',url:'#call',kind:'call'},{ttl:35,urgency:'high'});return J({ok:true,sent:n})}
  return J({ok:false,err:'kind'},400);
});
