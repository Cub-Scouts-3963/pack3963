import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup(file, exports, client = {}) {
  const elements = new Map();
  const element = selector => { if (!elements.has(selector)) elements.set(selector, {value:"",textContent:"",innerHTML:"",dataset:{},selectedOptions:[{textContent:"All"}],reset(){},hidden:true}); return elements.get(selector); };
  const printed = [];
  const context = vm.createContext({Intl,Date,Number,String,Array,Set,FormData:class{constructor(form){this.values=form.values}get(k){return this.values[k]??""}},crypto:{randomUUID:()=>"test-payment-id"},Event:class{},setTimeout:fn=>fn(),document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){}},window:{supabase:{createClient:()=>client},dispatchEvent(){},open:()=>({document:{write:s=>printed.push(s),close(){}},focus(){},print(){}})}});
  let source = readFileSync(new URL("../assets/js/"+file,import.meta.url),"utf8");
  source=source.replace(/\}\)\(\);\s*$/,`globalThis.subject={${exports}};})();`);
  vm.runInContext(source,context); return { ...context.subject, element, printed };
}
const account={id:"scout-a",display_name:"Example Scout",active:true};
function ledger(charge = null, error = null) {
  const posted=[];
  const client={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:charge,error:null}),insert:async row=>{posted.push(row);return {error}}})};
  const s=setup("treasurer.js","state,saveLedgerPayment,disableReload:()=>{loadAll=async()=>{};renderAccountLedger=()=>{};}",client);
  s.disableReload();s.state.accounts=[account];s.state.access={role:"treasurer"};
  const form={dataset:{accountId:account.id},values:{amount:"12.50",occurred_on:"2026-10-21",payment_method:"cash",reference:"receipt 1"},reset(){},hidden:false};
  return {...s,form,posted};
}
test("treasurer can record a general payment on exactly the selected Scout account",async()=>{const s=ledger();await s.saveLedgerPayment(s.form);assert.equal(s.posted.length,1);assert.equal(s.posted[0].account_id,account.id);assert.equal(s.posted[0].amount_cents,1250);assert.equal(s.posted[0].entry_type,"payment");assert.equal(s.posted[0].order_item_id,null);assert.equal(s.form.hidden,true)});
test("charge-specific payments retain the matching order link and category",async()=>{const s=ledger({id:"charge",account_id:account.id,entry_type:"charge",description:"Shirts",category:"T-shirt",order_item_id:"shirt-order"});s.form.values.charge_id="charge";await s.saveLedgerPayment(s.form);assert.equal(s.posted[0].order_item_id,"shirt-order");assert.equal(s.posted[0].category,"T-shirt")});
test("viewers and inactive accounts cannot post ledger payments",async()=>{for(const kind of ["viewer","inactive"]){const s=ledger();if(kind==="viewer")s.state.access.role="viewer";else s.state.accounts=[{...account,active:false}];await assert.rejects(()=>s.saveLedgerPayment(s.form));assert.equal(s.posted.length,0)}});
test("payments cannot use another Scout's charge or a removed charge",async()=>{for(const charge of [{account_id:"other",entry_type:"charge"},{account_id:account.id,entry_type:"charge",voided_at:"today"},{account_id:account.id,entry_type:"payment"}]){const s=ledger(charge);s.form.values.charge_id="charge";await assert.rejects(()=>s.saveLedgerPayment(s.form));assert.equal(s.posted.length,0)}});
test("invalid amounts, dates, and payment methods never reach the insert",async()=>{for(const values of [{amount:"-1"},{amount:"0"},{amount:"1.234"},{occurred_on:"2026-02-30"},{payment_method:"mystery"}]){const s=ledger();Object.assign(s.form.values,values);await assert.rejects(()=>s.saveLedgerPayment(s.form));assert.equal(s.posted.length,0)}});
test("failed payment insert keeps the form open and preserves its retry ID",async()=>{const s=ledger(null,new Error("Denied"));await assert.rejects(()=>s.saveLedgerPayment(s.form),/Denied/);assert.equal(s.form.hidden,false);assert.equal(s.form.dataset.paymentId,"test-payment-id")});
function orders(){const s=setup("treasurer-orders.js","state,filteredOrders,renderOrders,printOrders");s.state.orders=[{id:"a",campaign_id:"shirts",campaign_name:"Shirts",account_name:"Example Scout",quantity:2,total_cents:2000},{id:"b",campaign_id:"camp",campaign_name:"Camp",account_name:"Other Scout",quantity:1,total_cents:3000}];s.state.entries=[{order_item_id:"a",entry_type:"charge",amount_cents:2000},{order_item_id:"a",entry_type:"payment",amount_cents:1000},{order_item_id:"b",entry_type:"charge",amount_cents:3000}];s.element("#order-name-filter").value="all";return s}
test("order name, status and search filters combine",()=>{const s=orders();s.element("#order-name-filter").value="shirts";s.element("#order-status-filter").value="partial";s.element("#order-search").value="Example";assert.equal(s.filteredOrders().length,1);s.element("#order-status-filter").value="paid";assert.equal(s.filteredOrders().length,0);s.renderOrders();assert.equal(s.element("#print-filtered-orders").disabled,true)});
test("printing includes only filtered table rows and matching totals",()=>{const s=orders();s.element("#order-name-filter").value="shirts";s.element("#order-search").value="<example>";s.element("#order-search").value="Example";s.element("#orders-table").closest=()=>({outerHTML:s.element("#orders-table").innerHTML});s.printOrders();assert.match(s.printed[0],/Shirts/);assert.doesNotMatch(s.printed[0],/Other Scout/);assert.match(s.printed[0],/1 order rows · 2 items/);assert.match(s.printed[0],/Total \$20.00 · Amount due \$10.00/)});
