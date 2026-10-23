const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
const ALLOWED_ORIGINS = ["https://pack3963.com","https://www.pack3963.com","https://pack3963.pages.dev"];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, service: "pack3963-treasury-email" });
    if (url.pathname !== "/api/treasurer/send-email") return Response.json({ error: "not_found" }, { status: 404 });
    if (request.method === "OPTIONS") return corsResponse(request, null, 204);
    if (request.method !== "POST") return corsResponse(request, { error: "method_not_allowed" }, 405);
    if (Number(request.headers.get("content-length") || 0) > 65536) return corsResponse(request, { error: "request_too_large" }, 413);
    return handleTreasurerEmail(request, env);
  }
};
function allowedOrigin(request) {
  const origin=request.headers.get("origin")||"";
  return ALLOWED_ORIGINS.includes(origin)||/^https:\/\/[a-z0-9-]+\.pack3963\.pages\.dev$/i.test(origin)?origin:"";
}
function corsResponse(request, body, status=200) {
  const origin=allowedOrigin(request);
  if(!origin) return Response.json({error:"origin_not_allowed"},{status:403});
  const headers={"access-control-allow-origin":origin,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type","access-control-max-age":"86400","vary":"Origin"};
  return body==null?new Response(null,{status,headers}):Response.json(body,{status,headers});
}
async function sbFetch(env,token,path,init={}) {
  const headers=new Headers(init.headers||{});
  headers.set("apikey",SUPABASE_PUBLISHABLE_KEY);
  headers.set("authorization","Bearer "+token);
  if(init.body) headers.set("content-type","application/json");
  const response=await fetch(env.SUPABASE_URL+"/rest/v1/"+path,{...init,headers,signal:AbortSignal.timeout(15000)});
  const text=await response.text();
  const data=text?JSON.parse(text):null;
  if(!response.ok) throw new Error(data?.message||"Database request failed");
  return data;
}
async function handleTreasurerEmail(request,env) {
  if(!allowedOrigin(request)) return corsResponse(request,{error:"origin_not_allowed"},403);
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return corsResponse(request,{error:"missing_session"},401);
  try {
    const ur=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token}});
    if(!ur.ok) return corsResponse(request,{error:"invalid_session"},401);
    const user=await ur.json();
    const access=await sbFetch(env,token,"authorized_users?select=email,role,active&email=eq."+encodeURIComponent(String(user.email||"").toLowerCase())+"&active=eq.true");
    if(!access.length||!["admin","treasurer"].includes(access[0].role)) return corsResponse(request,{error:"not_authorized"},403);
    const p=await request.json();
    const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    const ids=[...new Set(Array.isArray(p.household_ids)?p.household_ids:[])].filter(uuid).slice(0,100);
    const contactIds=[...new Set(Array.isArray(p.contact_ids)?p.contact_ids:[])].filter(uuid).slice(0,20);
    const entryIds=[...new Set(Array.isArray(p.ledger_entry_ids)?p.ledger_entry_ids:[])].filter(uuid).slice(0,100);
    const mode=p.delivery_mode==="ledger"?"ledger":"bulk";
    const type=p.message_type==="custom"?"custom":"invoice", subject=String(p.subject||"").trim().slice(0,180), body=String(p.body_text||"").trim().slice(0,8000);
    if(!ids.length||!subject||!body) return corsResponse(request,{error:"missing_required_fields"},400);
    if(mode==="ledger"&&(ids.length!==1||!contactIds.length||!entryIds.length||type!=="invoice")) return corsResponse(request,{error:"select_recipients_and_ledger_items"},400);
    const made=await sbFetch(env,token,"email_messages",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({message_type:type,subject,body_text:body,status:"sending",sent_by_email:user.email,recipient_count:0})});
    const message=made[0]; let sent=0,failed=0,skipped=0; const invoiceIds=[];
    for(const hid of ids) {
      const hs=await sbFetch(env,token,"financial_accounts?select=id,display_name&id=eq."+hid+"&account_type=eq.household&active=eq.true");
      if(!hs.length){skipped++;continue}
      const cs=await sbFetch(env,token,"household_contacts?select=id,full_name,email,relationship,is_primary&household_account_id=eq."+hid+"&active=eq.true&email=not.is.null&order=is_primary.desc");
      const recipients=cs.filter(c=>validEmail(c.email)&&(mode!=="ledger"||contactIds.includes(c.id)));
      if(!recipients.length){skipped+=mode==="ledger"?contactIds.length:1;continue}
      const bs=await sbFetch(env,token,"account_balances?select=id,display_name,balance_cents&or=(id.eq."+hid+",parent_account_id.eq."+hid+")");
      const due=Math.max(0,bs.reduce((n,x)=>n+Number(x.balance_cents||0),0));
      const accountIds=bs.map(x=>x.id).filter(uuid);
      const accountNames=Object.fromEntries(bs.map(x=>[x.id,x.display_name]));
      let activity=[];
      if(type==="invoice"&&accountIds.length) {
        const filter=mode==="ledger"
          ?"id=in.("+entryIds.join(",")+")&account_id=in.("+accountIds.join(",")+")"
          :"voided_at=is.null&account_id=in.("+accountIds.join(",")+")&limit=50";
        activity=(await sbFetch(env,token,"ledger_entries?select=id,account_id,entry_type,amount_cents,occurred_on,description,category&"+filter+"&order=occurred_on.desc")).map(x=>({...x,account_name:accountNames[x.account_id]||"Pack account"}));
      }
      if(mode==="ledger"&&activity.length!==entryIds.length){skipped+=recipients.length;continue}
      let householdSent=0;
      for(const c of recipients) {
        let provider=null,rs="failed",err=null;
        try {
          const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:"Bearer "+env.RESEND_API_KEY,"content-type":"application/json","idempotency-key":message.id+":"+hid+":"+c.id},body:JSON.stringify({from:env.FROM_EMAIL,to:[c.email],subject,html:treasurerHtml(c.full_name,hs[0].display_name,subject,body,type==="invoice"?due:null,activity,env.SUPPORT_EMAIL,type==="invoice"?env.ZELLE_PAYMENT_INFO:null,mode),text:treasurerText(c.full_name,hs[0].display_name,body,type==="invoice"?due:null,activity,env.SUPPORT_EMAIL,type==="invoice"?env.ZELLE_PAYMENT_INFO:null,mode),reply_to:env.SUPPORT_EMAIL})});
          const rd=await rr.json(); if(!rr.ok) throw new Error(rd?.message||"Email provider rejected the message");
          provider=rd.id||null;rs="sent";sent++;householdSent++;
        } catch(e){err=String(e.message||e).slice(0,500);failed++}
        await sbFetch(env,token,"email_recipients",{method:"POST",headers:{prefer:"return=minimal"},body:JSON.stringify({message_id:message.id,household_account_id:hid,recipient_name:c.full_name,recipient_email:c.email,provider_message_id:provider,status:rs,error_message:err,sent_at:rs==="sent"?new Date().toISOString():null})});
      }
      if(type==="invoice"&&householdSent>0) {
        const invoiceDate=chicagoDate();
        const invoiceNumber="P3963-"+invoiceDate.replace(/-/g,"")+"-"+message.id.slice(0,8).toUpperCase()+"-"+hid.slice(0,4).toUpperCase();
        const created=await sbFetch(env,token,"invoice_documents",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({
          message_id:message.id,
          household_account_id:hid,
          invoice_number:invoiceNumber,
          invoice_date:invoiceDate,
          family_name:hs[0].display_name,
          subject,
          body_text:body,
          balance_cents:due,
          line_items:activity,
          support_email:env.SUPPORT_EMAIL,
          drive_sync_status:"pending"
        })});
        if(created[0]?.id) invoiceIds.push(created[0].id);
      }
    }
    const final=sent&&!failed&&!skipped?"sent":sent?"partial":"failed";
    await sbFetch(env,token,"email_messages?id=eq."+message.id,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({status:final,recipient_count:sent,sent_at:new Date().toISOString()})});
    return corsResponse(request,{ok:sent>0,message_id:message.id,invoice_ids:invoiceIds,sent,failed,skipped,status:final},sent>0?200:400);
  } catch(e){console.error(JSON.stringify({event:"treasurer_email_failed",reason:String(e.message||e)}));return corsResponse(request,{error:String(e.message||"Unable to send email")},500)}
}
function chicagoDate(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return values.year+"-"+values.month+"-"+values.day;
}
function fmtMoney(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(v)||0)/100)}
function activityAmount(entry){return (entry.entry_type==="charge"?1:-1)*Number(entry.amount_cents||0)}
function treasurerActivityHtml(activity,mode){
  if(!activity?.length)return "";
  const rows=activity.map(x=>"<tr><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'>"+esc(x.occurred_on)+"</td><td style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px'><strong>"+esc(x.description)+"</strong><br><span style='color:#607284'>"+esc(x.account_name)+(x.category?" · "+esc(x.category):"")+"</span></td><td align='right' style='padding:9px 8px;border-bottom:1px solid #d8e0e8;font-size:13px;font-weight:700;color:"+(activityAmount(x)>0?"#a1122f":"#24633f")+"'>"+(activityAmount(x)>0?"+":"−")+fmtMoney(Math.abs(activityAmount(x)))+"</td></tr>").join("");
  return "<h2 style='color:#004b8d;font-size:19px;margin:24px 0 10px'>"+(mode==="ledger"?"Selected account details":"Recent account activity")+"</h2><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0'><tr><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DATE</th><th align='left' style='padding:8px;background:#eef3f8;font-size:12px'>DETAIL</th><th align='right' style='padding:8px;background:#eef3f8;font-size:12px'>AMOUNT</th></tr>"+rows+"</table>";
}
function treasurerActivityText(activity,mode){return activity?.length?"\n\n"+(mode==="ledger"?"SELECTED ACCOUNT DETAILS":"RECENT ACCOUNT ACTIVITY")+"\n"+activity.map(x=>x.occurred_on+" | "+x.account_name+" | "+x.description+" | "+(activityAmount(x)>0?"+":"-")+fmtMoney(Math.abs(activityAmount(x)))).join("\n"):""}
function paymentHtml(zelle){
  if(!zelle)return "";
  return "<div style='margin:22px 0;padding:18px;background:#fff8d9;border-left:5px solid #f7c600;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#004b8d;letter-spacing:.4px'>PAYMENT OPTIONS</div><p style='font-size:15px;line-height:1.55;margin:8px 0 0'>Pay with cash at a Pack meeting or send Zelle to <strong>"+esc(zelle)+"</strong> (Kevin Goldsmith, Pack Treasurer). Include your family name and what the payment covers in the memo.</p></div>";
}
function paymentText(zelle){return zelle?"\n\nPAYMENT OPTIONS\nPay with cash at a Pack meeting or send Zelle to "+zelle+" (Kevin Goldsmith, Pack Treasurer). Include your family name and what the payment covers in the memo.":""}
function emailLogo(){return "<img src='https://www.pack3963.com/assets/images/cubscoutlogo.png' width='170' alt='Cub Scout Pack 3963' style='display:block;width:170px;max-width:100%;height:auto;border:0;margin:0 auto 10px'>"}
function treasurerHtml(contact,family,subject,body,due,activity,support,zelle,mode){
  const ps=String(body).split(/\n{2,}/).map(p=>"<p style='font-size:16px;line-height:1.6;margin:0 0 16px'>"+esc(p).replace(/\n/g,"<br>")+"</p>").join("");
  const bal=due==null?"":"<div style='margin:20px 0;padding:18px;background:#f4f8fc;border-left:5px solid #d71920;border-radius:7px'><div style='font-size:13px;font-weight:800;color:#526474'>CURRENT FAMILY BALANCE DUE</div><div style='font-size:30px;font-weight:800;color:#004b8d;margin-top:4px'>"+fmtMoney(due)+"</div><div style='font-size:13px;color:#607284;margin-top:4px'>"+esc(family)+"</div></div>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>"+esc(subject)+"</title></head><body style='margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif'><div style='display:none;max-height:0;overflow:hidden'>Pack 3963 family account details for "+esc(family)+"</div><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='background:#eef3f8;padding:24px 12px'><tr><td align='center'><table width='100%' cellspacing='0' cellpadding='0' role='presentation' style='max-width:620px;background:#fff;border-radius:15px;overflow:hidden'><tr><td align='center' style='background:#004b8d;padding:22px 30px;border-bottom:8px solid #f7c600;color:#fff'>"+emailLogo()+"<div style='font-size:15px;font-weight:700'>Pack Treasurer</div></td></tr><tr><td style='padding:30px'><div style='color:#d71920;font-size:12px;font-weight:800;letter-spacing:1px'>FAMILY ACCOUNT</div><h1 style='color:#004b8d;font-size:25px;margin:8px 0 18px'>"+esc(subject)+"</h1><p style='font-size:16px;line-height:1.6'>Hello "+esc(contact)+",</p>"+ps+bal+treasurerActivityHtml(activity,mode)+paymentHtml(zelle)+"<p style='font-size:13px;color:#607284;margin-top:24px'>Questions? Reply or contact <a href='mailto:"+esc(support)+"'>"+esc(support)+"</a>.</p></td></tr><tr><td style='background:#003f75;color:#d9ecff;padding:17px 30px;font-size:12px'>Cub Scout Pack 3963 · Chicago, Illinois</td></tr></table></td></tr></table></body></html>"
}
function treasurerText(contact,family,body,due,activity,support,zelle,mode){return "CUB SCOUT PACK 3963\n\nHello "+contact+",\n\n"+body+(due==null?"":"\n\nCurrent family balance due for "+family+": "+fmtMoney(due))+treasurerActivityText(activity,mode)+paymentText(zelle)+"\n\nQuestions? Contact "+support}

function validEmail(value){return typeof value==="string"&&value.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function esc(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
