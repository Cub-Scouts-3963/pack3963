(() => {
  "use strict";
  const SB_URL="https://buvrqioskjjhszqkpypa.supabase.co";
  const SB_KEY="sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const EMAIL_API="https://pack3963-auth-email.cubscouts3963.workers.dev/api/treasurer/send-email";
  const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
  const state={accounts:[],campaigns:[],orders:[],entries:[],messages:[],recipients:[],contacts:[],access:null};
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
  const cents=v=>Math.round(Number(v)*100);
  const today=()=>new Date().toISOString().slice(0,10);
  const setStatus=(m,k="")=>{const e=$("#order-email-status");if(e){e.textContent=m;e.className="form-status"+(k?" is-"+k:"")}};

  async function init(session){
    if(!session?.user)return;
    const access=await sb.from("authorized_users").select("*").eq("email",String(session.user.email||"").toLowerCase()).eq("active",true).maybeSingle();
    if(access.error||!access.data)return;
    state.access=access.data;
    await load();
  }
  async function load(){
    const rs=await Promise.all([
      sb.from("account_balances").select("*").eq("active",true).order("display_name"),
      sb.from("order_campaigns").select("*").order("created_at",{ascending:false}),
      sb.from("order_item_balances").select("*").order("campaign_name").order("account_name"),
      sb.from("ledger_entries").select("id,account_id,order_item_id,entry_type,amount_cents,voided_at"),
      sb.from("email_messages").select("*").order("created_at",{ascending:false}).limit(100),
      sb.from("email_recipients").select("*").order("created_at",{ascending:false}).limit(1000),
      sb.from("household_contacts").select("*").eq("active",true)
    ]);
    for(const r of rs)if(r.error)throw r.error;
    [state.accounts,state.campaigns,state.orders,state.entries,state.messages,state.recipients,state.contacts]=rs.map(r=>r.data||[]);
    render();
  }
  function render(){
    renderCampaigns();renderOrderPicker();renderOrders();renderFamilies();renderMessages();
  }
  function renderCampaigns(){
    const filter=$("#order-name-filter"), selected=filter.value;
    filter.innerHTML='<option value="all">All order names</option>'+state.campaigns.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if(state.campaigns.some(c=>c.id===selected))filter.value=selected;
    const options=state.campaigns.filter(c=>c.active).map(c=>`<option value="${c.id}" data-price="${c.default_unit_price_cents}" data-due="${esc(c.due_on||"")}">${esc(c.name)}</option>`).join("");
    $("#order-campaign-select").innerHTML='<option value="">Choose an order...</option>'+options;
  }
  function renderOrderPicker(){
    const q=($("#order-account-search")?.value||"").toLowerCase();
    const rows=state.accounts.filter(a=>a.active&&(["scout","household"].includes(a.account_type))&&(!q||[a.display_name,a.den,a.household_name].join(" ").toLowerCase().includes(q)));
    $("#order-account-options").innerHTML=rows.map(a=>`<label class="account-picker-option"><input type="checkbox" value="${a.id}"><span><strong>${esc(a.display_name)}</strong><small>${esc((a.den||a.account_type)+" · "+money(a.balance_cents))}</small></span></label>`).join("");
    updateOrderCount();
  }
  function orderPaid(item){
    const linked=state.entries.filter(e=>e.order_item_id===item.id&&!e.voided_at);
    const charges=linked.filter(e=>e.entry_type==="charge").reduce((n,e)=>n+Number(e.amount_cents),0);
    const paid=linked.filter(e=>e.entry_type!=="charge").reduce((n,e)=>n+Number(e.amount_cents),0);
    return {charges,paid,balance:Math.max(0,charges-paid)};
  }
  function filteredOrders(){
    const q=($("#order-search")?.value||"").toLowerCase(), filter=$("#order-status-filter")?.value||"all";
    const campaign=$("#order-name-filter").value;
    return state.orders.filter(o=>{
      const p=orderPaid(o), hay=[o.campaign_name,o.account_name,o.ordered_for,o.item_variant,o.notes].join(" ").toLowerCase();
      return(campaign==="all"||o.campaign_id===campaign)&&(!q||hay.includes(q))&&(filter==="all"||(filter==="paid"?p.balance===0:filter==="unpaid"?p.paid===0&&p.balance>0:p.paid>0&&p.balance>0));
    });
  }
  function renderOrders(){
    const rows=filteredOrders();
    $("#print-filtered-orders").disabled=!rows.length;
    $("#orders-table").innerHTML=rows.length?rows.map(o=>{const p=orderPaid(o);const status=p.balance===0?"Paid":p.paid>0?"Partial":"Unpaid";return `<tr><td><strong>${esc(o.campaign_name)}</strong><br><small>Due ${esc(o.due_on||"—")}</small></td><td>${esc(o.account_name)}</td><td>${esc(o.ordered_for||o.account_name)}</td><td>${o.quantity}</td><td>${esc(o.item_variant||"—")}</td><td class="money">${money(o.total_cents)}</td><td><span class="status-pill">${status}</span><br><small>${p.balance?money(p.balance)+" due":"Paid in full"}</small></td></tr>`}).join(""):'<tr><td colspan="7" class="empty-row">No matching orders.</td></tr>';
  }
  function printOrders(){
    const rows=filteredOrders(); if(!rows.length){setStatus("No orders match the current filters.");return;}
    renderOrders();
    const popup=window.open("","_blank","width=1100,height=800");
    if(!popup){setStatus("Please allow pop-ups to print orders.","error");return;}
    const filters=[$("#order-name-filter").selectedOptions[0].textContent,$("#order-status-filter").selectedOptions[0].textContent,$("#order-search").value?`Search: ${$("#order-search").value}`:""].filter(Boolean).join(" · ");
    const total=rows.reduce((n,o)=>n+Number(o.total_cents),0), due=rows.reduce((n,o)=>n+orderPaid(o).balance,0), quantity=rows.reduce((n,o)=>n+Number(o.quantity),0);
    const table=$("#orders-table").closest("table").outerHTML;
    popup.document.write(`<!doctype html><html lang="en"><head><title>Pack 3963 filtered orders</title><style>body{font:12px Arial,sans-serif;color:#172b3f;margin:24px}h1{color:#004b93}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccd6e0;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.money{text-align:right}small{display:block}button{padding:10px}@page{size:landscape;margin:12mm}@media print{button{display:none}body{margin:0}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>Pack 3963 orders</h1><p>${esc(filters)}</p><p>${rows.length} order rows · ${quantity} items · Total ${money(total)} · Amount due ${money(due)}</p><p>Generated ${esc(new Date().toLocaleString())}</p>${table}</body></html>`);
    popup.document.close(); popup.focus(); setTimeout(()=>popup.print(),150);
  }
  function updateOrderCount(){
    const n=$$("#order-account-options input:checked").length;
    const e=$("#order-account-count");if(e)e.textContent=n+" account"+(n===1?"":"s")+" selected";
  }
  function householdAccounts(){return state.accounts.filter(a=>a.account_type==="household"&&a.active)}
  function renderFamilies(){
    const q=($("#email-family-search")?.value||"").toLowerCase();
    $("#email-family-options").innerHTML=householdAccounts().filter(a=>!q||a.display_name.toLowerCase().includes(q)).map(a=>{
      const contacts=state.contacts.filter(c=>c.household_account_id===a.id&&c.email);
      const has=contacts.length>0;
      return `<label class="account-picker-option ${has?"":"is-disabled"}"><input type="checkbox" value="${a.id}" ${has?"":"disabled"}><span><strong>${esc(a.display_name)}</strong><small>${has?esc(contacts.map(c=>c.email).join(", ")):"No email on file"} · ${money(a.balance_cents)}</small></span></label>`;
    }).join("");
    updateFamilyCount();
  }
  function updateFamilyCount(){const n=$$("#email-family-options input:checked").length;$("#email-family-count").textContent=n+" famil"+(n===1?"y":"ies")+" selected"}
  function renderMessages(){
    $("#email-history-table").innerHTML=state.messages.length?state.messages.map(m=>{
      const recipients=state.recipients.filter(r=>r.message_id===m.id);
      return `<tr><td>${esc(new Date(m.sent_at||m.created_at).toLocaleString())}</td><td><strong>${esc(m.subject)}</strong><br><small>${esc(m.sent_by_email||"")}</small></td><td>${esc(m.message_type)}</td><td>${m.recipient_count}</td><td><span class="status-pill">${esc(m.status)}</span>${recipients.filter(r=>r.status==="failed").length?`<br><small>${recipients.filter(r=>r.status==="failed").length} failed</small>`:""}</td></tr>`;
    }).join(""):'<tr><td colspan="5" class="empty-row">No emails have been sent from the portal.</td></tr>';
  }
  async function createCampaign(form){
    const f=new FormData(form);
    const row={name:String(f.get("name")).trim(),category:String(f.get("category")).trim(),description:String(f.get("description")||"").trim()||null,default_unit_price_cents:cents(f.get("unit_price")),due_on:f.get("due_on")||null,active:true};
    const r=await sb.from("order_campaigns").insert(row);if(r.error)throw r.error;
  }
  async function createOrders(form){
    const f=new FormData(form),ids=$$("#order-account-options input:checked").map(x=>x.value);
    if(!ids.length)throw new Error("Select at least one Scout or family.");
    const campaign=state.campaigns.find(c=>c.id===f.get("campaign_id"));
    if(!campaign)throw new Error("Choose an order.");
    const quantity=Math.max(1,Number(f.get("quantity")||1)),unit=cents(f.get("unit_price"));
    const created=await sb.from("order_items").insert(ids.map(id=>({campaign_id:campaign.id,account_id:id,ordered_for:String(f.get("ordered_for")||"").trim()||null,quantity,unit_price_cents:unit,item_variant:String(f.get("item_variant")||"").trim()||null,notes:String(f.get("notes")||"").trim()||null,source:"manual"}))).select();
    if(created.error)throw created.error;
    const entries=created.data.map(o=>({account_id:o.account_id,entry_type:"charge",amount_cents:o.quantity*o.unit_price_cents,occurred_on:today(),due_on:campaign.due_on,description:campaign.name+(o.ordered_for?" — "+o.ordered_for:""),category:campaign.category,notes:o.item_variant?"Option/size: "+o.item_variant:null,source:"manual",order_item_id:o.id}));
    const posted=await sb.from("ledger_entries").insert(entries);if(posted.error)throw posted.error;
  }
  async function sendEmail(form){
    if(!["admin","treasurer"].includes(state.access?.role))throw new Error("Your role cannot send email.");
    const session=(await sb.auth.getSession()).data.session;if(!session)throw new Error("Your session expired. Sign in again.");
    const f=new FormData(form),ids=$$("#email-family-options input:checked").map(x=>x.value);
    if(!ids.length)throw new Error("Select at least one family.");
    const r=await fetch(EMAIL_API,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},body:JSON.stringify({household_ids:ids,message_type:f.get("message_type"),subject:String(f.get("subject")).trim(),body_text:String(f.get("body_text")).trim()})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to send email.");
    return d;
  }
  function reveal(id){const e=$(id);e.hidden=false;e.scrollIntoView({behavior:"smooth",block:"start"})}
  document.addEventListener("DOMContentLoaded",async()=>{
    window.addEventListener("treasury-imported",()=>load().catch(x=>setStatus(x.message,"error")));
    window.addEventListener("treasury-ledger-updated",()=>load().catch(x=>setStatus(x.message,"error")));
    $("#show-campaign-form")?.addEventListener("click",()=>reveal("#campaign-form"));
    $("#show-order-form")?.addEventListener("click",()=>reveal("#order-form"));
    $$("[data-close-order-form]").forEach(b=>b.addEventListener("click",()=>$("#"+b.dataset.closeOrderForm).hidden=true));
    $("#order-search")?.addEventListener("input",renderOrders);$("#order-status-filter")?.addEventListener("change",renderOrders);
    $("#order-name-filter").addEventListener("change",renderOrders);
    $("#print-filtered-orders").addEventListener("click",printOrders);
    $("#order-account-search")?.addEventListener("input",renderOrderPicker);$("#order-account-options")?.addEventListener("change",updateOrderCount);
    $("#email-family-search")?.addEventListener("input",renderFamilies);$("#email-family-options")?.addEventListener("change",updateFamilyCount);
    $("#order-campaign-select")?.addEventListener("change",e=>{const o=e.target.selectedOptions[0];if(o?.dataset.price)$("#order-unit-price").value=(Number(o.dataset.price)/100).toFixed(2)});
    $("#campaign-form")?.addEventListener("submit",async e=>{e.preventDefault();setStatus("Creating order…");try{await createCampaign(e.currentTarget);e.currentTarget.reset();e.currentTarget.hidden=true;await load();setStatus("Order created.","success")}catch(x){setStatus(x.message,"error")}});
    $("#order-form")?.addEventListener("submit",async e=>{e.preventDefault();setStatus("Assigning order and charges…");try{await createOrders(e.currentTarget);e.currentTarget.reset();e.currentTarget.hidden=true;await load();setStatus("Order assigned and charges posted.","success")}catch(x){setStatus(x.message,"error")}});
    $("#email-form")?.addEventListener("submit",async e=>{e.preventDefault();if(!confirm("Send this email to the selected families?"))return;setStatus("Sending…");try{const d=await sendEmail(e.currentTarget);await load();setStatus(`Sent ${d.sent}; skipped ${d.skipped}; failed ${d.failed}.`,d.failed?"error":"success")}catch(x){setStatus(x.message,"error")}});
    const session=(await sb.auth.getSession()).data.session;if(session)await init(session);
    sb.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_IN"&&session)setTimeout(()=>init(session),0)});
  });
})();
