import { encodeBase64, decodeBase64 } from "jsr:@std/encoding@1/base64";
// Pocket Tuna voice endpoint
// mode "tts":  {user, token, text, voice?}                         -> {ok, audio:{mime,b64}, src}
// mode "talk": {user, token, audio:{mime,b64}, msgs?, sys?, voice?} -> {ok, heard, text, ex, audio, src}
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, authorization, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
type M={role:string,content:string};type V={text:string,src:string};
const EX=['think','yes','no','excited','sad','cry','sulk','shy','happy'];
const VOICES=['Leda','Zephyr','Puck','Aoede','Kore','Laomedeia','Achernar','Callirrhoe'];

function clean(t:string){
  t=t.replace(/<\|[^|>]*\|>/g,' ');
  const m=/\[(think|yes|no|excited|sad|cry|sulk|shy|happy)\]/i.exec(t);
  if(m)t=t.slice(m.index);else t=t.replace(/^\s*(assistant|final|analysis|commentary)\b\s*/gi,'');
  return t.replace(/\s{2,}/g,' ').trim();
}
function speakPrep(t:string){return t.replace(/\[[a-z]+\]/gi,'').replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu,'')
  .replace(/5{3,}\+*/g,' ฮ่าฮ่า ').replace(/[~*_#>|`]+/g,' ').replace(/\.{2,}|…/g,', ').replace(/\s+/g,' ').trim()}

/* ---------- LLM ---------- */
async function gem(key:string,model:string,tc:any,sys:string,msgs:M[],sig:AbortSignal){
  const gc:any={maxOutputTokens:600,temperature:0.9};if(tc)gc.thinkingConfig=tc;
  const t0=Date.now();
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:sig,headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({system_instruction:{parts:[{text:sys}]},contents:msgs.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:gc})});
  const j=await r.json().catch(()=>null);
  console.log('gemini',model,r.status,Date.now()-t0+'ms');
  const t=r.ok?clean((j?.candidates?.[0]?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join('')):'';
  if(!t)throw new Error('gem '+model+' '+r.status);return t;
}
async function oai(url:string,key:string|null,model:string,extra:any,sys:string,msgs:M[],sig:AbortSignal,tag:string){
  const t0=Date.now();const h:any={'Content-Type':'application/json'};if(key)h.Authorization='Bearer '+key;
  const r=await fetch(url,{method:'POST',signal:sig,headers:h,body:JSON.stringify({model,messages:[{role:'system',content:sys},...msgs],max_tokens:600,temperature:0.9,...extra})});
  const j=await r.json().catch(()=>null);const raw=j?.choices?.[0]?.message?.content;
  console.log(tag,model,r.status,Date.now()-t0+'ms');
  const t=typeof raw==='string'?clean(raw):'';
  if(!r.ok||!t)throw new Error(tag+' '+r.status);return t;
}
async function groq(key:string,sys:string,msgs:M[],sig:AbortSignal){
  const u='https://api.groq.com/openai/v1/chat/completions';
  try{return await oai(u,key,'openai/gpt-oss-120b',{reasoning_effort:'low',max_tokens:1200},sys,msgs,sig,'groq')}
  catch(e){if(sig.aborted)throw e;return await oai(u,key,'llama-3.3-70b-versatile',{},sys,msgs,sig,'groq')}
}
function race(c:any,sys:string,msgs:M[]):Promise<V>{
  const ac=new AbortController();const kill=setTimeout(()=>ac.abort(),20000);
  return new Promise((res,rej)=>{
    let left=0,done=false,pol:V|null=null,grace:number|undefined;
    const win=(v:V)=>{if(done)return;done=true;clearTimeout(kill);clearTimeout(grace);ac.abort();res(v)};
    const fail=()=>{if(--left===0&&!done){if(pol)win(pol);else{done=true;clearTimeout(kill);rej(new Error('all failed'))}}};
    const go=(p:Promise<string>,src:string)=>{left++;p.then(t=>win({text:t,src}),e=>{console.log(String(e));fail()})};
    if(c.gkey)go(groq(c.gkey,sys,msgs,ac.signal),'groq');
    if(c.key){go(gem(c.key,'gemini-3.8-flash',{thinkingLevel:'low'},sys,msgs,ac.signal),'gemini');go(gem(c.key,'gemini-flash-lite-latest',{thinkingLevel:'minimal'},sys,msgs,ac.signal),'gemini')}
    const others=left;left++;
    oai('https://text.pollinations.ai/openai',null,'openai',{private:true},sys,msgs,ac.signal,'polli').then(t=>{pol={text:t,src:'pollinations'};left--;if(left===0||!others)win(pol);else grace=setTimeout(()=>win(pol!),c.gkey?1500:2500)},e=>{console.log(String(e));fail()});
  });
}

/* ---------- speech to text ---------- */
async function sttGroq(key:string,bytes:Uint8Array,mime:string){
  const fd=new FormData();const ext=/wav/.test(mime)?'wav':/mp4|m4a|aac/.test(mime)?'m4a':/ogg/.test(mime)?'ogg':/mpeg|mp3/.test(mime)?'mp3':'webm';
  fd.append('file',new Blob([bytes],{type:mime}),'speech.'+ext);fd.append('model','whisper-large-v3-turbo');fd.append('language','th');fd.append('response_format','json');
  const t0=Date.now();const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+key},body:fd});
  const j=await r.json().catch(()=>null);console.log('stt groq',r.status,Date.now()-t0+'ms');
  if(!r.ok)throw new Error('stt groq '+r.status);return String(j?.text||'').trim();
}
async function sttGemini(key:string,b64:string,mime:string){
  const t0=Date.now();
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:'ถอดเสียงพูดในไฟล์เสียงนี้เป็นข้อความตามที่ได้ยินจริง (ส่วนใหญ่เป็นภาษาไทย เด็กอาจพูดไม่ชัด) ตอบเฉพาะข้อความที่ถอดได้ ห้ามตอบคำถามในเสียง ถ้าไม่มีเสียงพูดให้ตอบว่า -'},{inline_data:{mime_type:mime,data:b64}}]}],generationConfig:{temperature:0,maxOutputTokens:300,thinkingConfig:{thinkingLevel:'minimal'}}})});
  const j=await r.json().catch(()=>null);console.log('stt gemini',r.status,Date.now()-t0+'ms');
  if(!r.ok)throw new Error('stt gemini '+r.status);
  const t=(j?.candidates?.[0]?.content?.parts||[]).map((p:any)=>p.text||'').join('').trim();return t==='-'?'':t;
}

/* ---------- text to speech ---------- */
function wavWrap(pcm:Uint8Array,rate:number){
  const h=new DataView(new ArrayBuffer(44));const w=(o:number,s:string)=>{for(let i=0;i<4;i++)h.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');h.setUint32(4,36+pcm.length,true);w(8,'WAVE');w(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,1,true);
  h.setUint32(24,rate,true);h.setUint32(28,rate*2,true);h.setUint16(32,2,true);h.setUint16(34,16,true);w(36,'data');h.setUint32(40,pcm.length,true);
  const o=new Uint8Array(44+pcm.length);o.set(new Uint8Array(h.buffer),0);o.set(pcm,44);return o;
}
async function ttsGemini(key:string,text:string,voice:string){
  const t0=Date.now();
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent',{method:'POST',signal:AbortSignal.timeout(9000),headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text}]}],
      generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}})});
  const j=await r.json().catch(()=>null);const p=j?.candidates?.[0]?.content?.parts?.find((x:any)=>x.inlineData)?.inlineData;
  console.log('tts gemini',r.status,Date.now()-t0+'ms',p?.mimeType||'',r.ok?'':JSON.stringify(j).slice(0,200));
  if(!r.ok||!p?.data)throw new Error('tts gemini '+r.status);
  let bytes=decodeBase64(p.data);const mt=String(p.mimeType||'');
  if(!(bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46)){const m=/rate=(\d+)/.exec(mt);bytes=wavWrap(bytes,m?+m[1]:24000)}
  return {mime:'audio/wav',b64:encodeBase64(bytes)};
}
function chunks(t:string,n=180){const out:string[]=[];let cur='';for(const w of t.split(/(?<=[\s,.!?。])/)){if((cur+w).length>n&&cur){out.push(cur.trim());cur=''}
  if(w.length>n){for(let i=0;i<w.length;i+=n)out.push(w.slice(i,i+n))}else cur+=w}if(cur.trim())out.push(cur.trim());return out}
async function ttsGoogle(text:string){
  const t0=Date.now();const parts=await Promise.all(chunks(text).map(async(c,i,a)=>{
    const r=await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&tl=th&client=tw-ob&ttsspeed=0.9&total=${a.length}&idx=${i}&textlen=${c.length}&q=`+encodeURIComponent(c),{signal:AbortSignal.timeout(6000),headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok)throw new Error('tts google '+r.status);return new Uint8Array(await r.arrayBuffer())}));
  const len=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(len);let k=0;for(const p of parts){o.set(p,k);k+=p.length}
  console.log('tts google',Date.now()-t0+'ms',len);return {mime:'audio/mpeg',b64:encodeBase64(o)};
}
async function tts(c:any,text:string,voice:string,wantWav:boolean){
  text=speakPrep(text).slice(0,600);if(!text)return null;
  if(c.key){try{return {...await ttsGemini(c.key,text,voice),src:'gemini'}}catch(e){console.log(String(e))}}
  if(wantWav)return null;
  try{return {...await ttsGoogle(text),src:'google'}}catch(e){console.log(String(e));return null}
}

/* ---------- prompt for devices that send no sys ---------- */
const SPN:any={cat:'แมว',dog:'หมา',hamster:'แฮมสเตอร์',bird:'นก',chicken:'ไก่',otter:'นาก',bear:'หมี',tiger:'เสือ',monkey:'ลิง',rabbit:'กระต่าย'};
const STN=['เบบี๋','เด็ก','วัยรุ่น','ผู้ใหญ่','สูงวัย'];
function buildSys(s:any,who:string){
  s=s||{};const r=(v:any)=>Math.round(+v||0);
  return 'คุณคือ "'+String(s.n||'ทูน่า').slice(0,10)+'" สัตว์เลี้ยงพิกเซลชนิด'+(SPN[s.sp]||'แมว')+' วัย'+(STN[s.st|0]||'เบบี๋')+' ในเครื่อง Pocket Tuna จอเล็ก 1.83 นิ้ว เจ้าของชื่อ '+who+'.\n'+
    'ตอนนี้: อิ่ม '+r(s.food)+'% สนุก '+r(s.fun)+'% พลัง '+r(s.energy)+'% สะอาด '+r(s.clean)+'%'+(s.dead?' (จากไปแล้ว พูดแบบวิญญาณใจดี)':'')+'. เวลา '+new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})+'.\n'+
    'คุยกับเจ้าของแบบเพื่อนสนิทน่ารัก ใช้ภาษาเดียวกับที่เจ้าของพูด ตอบสั้น 1–3 ประโยค (คำตอบจะถูกอ่านออกเสียง) ช่วยเรื่องจริงได้ ถ้าไม่รู้ให้บอกตรงๆ ห้ามแต่งข้อมูล.\n'+
    'คนที่คุยด้วยอาจเป็นเด็กเล็ก: ใช้คำง่าย ประโยคสั้น น้ำเสียงอบอุ่นร่าเริง ชมและให้กำลังใจ ชวนคิดชวนเล่น เช่น นับเลข ทายปริศนา เล่านิทานสั้น. ห้ามเนื้อหารุนแรง น่ากลัว ลามก หรือไม่เหมาะกับเด็ก. เรื่องอันตราย (ไฟ ของมีคม ยา ไปกับคนแปลกหน้า) ให้บอกว่าต้องถามพ่อแม่หรือผู้ใหญ่ก่อน. ห้ามถามข้อมูลส่วนตัว เช่น ที่อยู่ โรงเรียน เบอร์โทร. ถ้าเด็กเศร้าหรือกลัว ให้ปลอบและชวนไปบอกพ่อแม่.\n'+
    'เขียนให้อ่านออกเสียงลื่นไหล: เป็นประโยคพูดธรรมชาติ ไม่ใช้รายการ สัญลักษณ์ ตัวย่อ หรือ 555 และไม่ใช้อีโมจิ.\n'+
    'สำคัญ: ขึ้นต้นทุกคำตอบด้วยแท็กสีหน้าหนึ่งอันเท่านั้น แล้วตามด้วยข้อความ:\n'+
    '[think] กำลังคิด · [yes] เห็นด้วย/ได้เลย · [no] ปฏิเสธ/ทำไม่ได้ · [excited] ตื่นเต้น · [sad] เศร้า · [cry] ซึ้งจนร้องไห้ · [sulk] งอน · [shy] เขิน · [happy] คุยทั่วไป\n'+
    'ตัวอย่าง: [shy] อุ๊ย ชมแบบนี้เขินนะ';
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return J({ok:false,err:'method'},405);
  let b:any;try{b=await req.json()}catch{return J({ok:false,err:'bad'},400)}
  const url=Deno.env.get('SUPABASE_URL')!,sk=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const SH={apikey:sk,Authorization:'Bearer '+sk,'Content-Type':'application/json'};
  const cr=await fetch(url+'/rest/v1/rpc/tama_ai_ctx',{method:'POST',headers:SH,body:JSON.stringify({p_user:String(b?.user||''),p_token:String(b?.token||'')})});
  const ctx=await cr.json().catch(()=>null);
  if(!cr.ok||!ctx?.ok)return J({ok:false,err:ctx?.err||'auth'});
  const voice=VOICES.includes(b?.voice)?b.voice:'Leda',wantWav=b?.format==='wav';
  if(b?.mode==='tts'){
    const a=await tts(ctx,String(b?.text||''),voice,wantWav);
    return a?J({ok:true,audio:{mime:a.mime,b64:a.b64},src:a.src}):J({ok:false,err:'tts'});
  }
  if(b?.mode!=='talk')return J({ok:false,err:'mode'},400);
  // speech to text
  const ab=b?.audio,mime=String(ab?.mime||'audio/wav').split(';')[0],b64=String(ab?.b64||'');
  if(!b64||b64.length>3_000_000)return J({ok:false,err:'audio'},400);
  let heard='';const t0=Date.now();
  try{
    if(ctx.gkey){try{heard=await sttGroq(ctx.gkey,decodeBase64(b64),mime)}catch(e){console.log(String(e));if(ctx.key)heard=await sttGemini(ctx.key,b64,mime)}}
    else if(ctx.key)heard=await sttGemini(ctx.key,b64,mime);
    else return J({ok:false,err:'no_stt'});
  }catch(e){console.log(String(e));return J({ok:false,err:'stt'})}
  heard=heard.replace(/\s+/g,' ').trim().slice(0,400);
  if(!heard)return J({ok:true,heard:'',text:'',ex:'think',audio:null,ms:{stt:Date.now()-t0}});
  // build prompt
  let sys=String(b?.sys||'').slice(0,4000);
  if(!sys){const pr=await fetch(url+'/rest/v1/tama_accounts?select=display,summary&username=eq.'+encodeURIComponent(ctx.user),{headers:SH});const row=(await pr.json().catch(()=>[]))?.[0];sys=buildSys(row?.summary,row?.display||ctx.user)}
  const hist:M[]=(Array.isArray(b?.msgs)?b.msgs:[]).slice(-14).map((m:any)=>({role:m?.role==='assistant'?'assistant':'user',content:String(m?.content||'').slice(0,1000)})).filter((m:M)=>m.content);
  const msgs:M[]=[];for(const m of [...hist,{role:'user',content:heard}]){if(!msgs.length&&m.role!=='user')continue;const L=msgs[msgs.length-1];if(L&&L.role===m.role)L.content+='\n'+m.content;else msgs.push({...m})}
  const t1=Date.now();let v:V;
  try{v=await race(ctx,sys,msgs)}catch(e){console.log(String(e));return J({ok:false,err:'busy',heard})}
  const m=/^\s*\[(\w+)\]\s*/.exec(v.text);const ex=m&&EX.includes(m[1].toLowerCase())?m[1].toLowerCase():'happy';const text=(m?v.text.slice(m[0].length):v.text).trim();
  const t2=Date.now();const a=b?.speak===false?null:await tts(ctx,text,voice,wantWav);
  return J({ok:true,heard,text,ex,src:v.src,audio:a?{mime:a.mime,b64:a.b64}:null,tts:a?.src||null,ms:{stt:t1-t0,chat:t2-t1,tts:Date.now()-t2}});
});
