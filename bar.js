/* Vetus Lodge · Bar & restaurant: sell screen, sales, bar deposit, stock, stock-take, menu.
   Loaded before app.js; uses app.js globals (A, sb, esc, K, render, refresh, toast, fail, site, scopeIds, dayKey, addDaysKey, fmtDay, fmtTime, last7). */
const POS = { outlet:"bar", cart:{}, cat:"All", busy:false, sub:"sales", counts:{}, period:"today" };
const CATS = ["Beer","Spirits","Wine","Soft drinks","Water","Snacks","Meals","Other"];
const canManageBar = () => ["manager","admin"].includes(A.me.role);

async function barLoad(ids){
  const today = dayKey(Date.now()), since = addDaysKey(today,-8), sinceTs = new Date(since+"T00:00:00+02:00").toISOString();
  const [m, s, d] = await Promise.all([
    sb.from("menu_items").select("*").in("branch_id", ids).order("category").order("name"),
    sb.from("pos_sales").select("*").in("branch_id", ids).gte("sold_at", sinceTs).order("sold_at",{ascending:false}),
    sb.from("pos_deposits").select("*").in("branch_id", ids).gte("business_date", since),
  ]);
  for (const r of [m,s,d]) if (r.error) throw r.error;
  A.D.menu = m.data; A.D.posSales = s.data; A.D.posDeposits = d.data; A.D.posLines = [];
  const sids = s.data.map(x=>x.id);
  for (let i=0; i<sids.length; i+=150){ const l = await sb.from("pos_sale_lines").select("*").in("sale_id", sids.slice(i,i+150)); if (l.error) throw l.error; A.D.posLines.push(...l.data); }
}

/* ---------- calculations ---------- */
const posDay = (bid, key) => (A.D.posSales||[]).filter(s=>s.branch_id===bid && !s.voided && dayKey(s.sold_at)===key);
function barTotals(bid, key){
  const ss = posDay(bid, key), sum = f => ss.filter(f).reduce((a,s)=>a+Number(s.total),0);
  return { ss, count:ss.length, total:sum(()=>true), cash:sum(s=>s.payment_method==="cash"), mobile:sum(s=>s.payment_method==="mobile"),
    bar:sum(s=>s.outlet==="bar"), restaurant:sum(s=>s.outlet==="restaurant") };
}
function barDepState(bid, key){
  const row = (A.D.posDeposits||[]).find(d=>d.branch_id===bid && d.business_date===key), t = barTotals(bid, key);
  if (row && row.status==="deposited") return {status:"deposited", row, t, late: new Date(row.paid_at) > new Date(addDaysKey(key,1)+"T10:00:00+02:00")};
  if (!t.count && !row) return {status:"none", t};
  return {status: Date.now() > new Date(addDaysKey(key,1)+"T10:00:00+02:00").getTime() ? "overdue" : "due", row, t};
}
function barPeriod(bid, P){
  const keys = P==="today" ? [dayKey(Date.now())] : [...last7().slice(1), dayKey(Date.now())];
  const tt = keys.map(k=>barTotals(bid,k)), sts = last7().map(k=>barDepState(bid,k));
  return { total:tt.reduce((a,t)=>a+t.total,0), count:tt.reduce((a,t)=>a+t.count,0),
    bar:tt.reduce((a,t)=>a+t.bar,0), restaurant:tt.reduce((a,t)=>a+t.restaurant,0), cash:tt.reduce((a,t)=>a+t.cash,0), mobile:tt.reduce((a,t)=>a+t.mobile,0),
    outstanding:sts.filter(x=>x.status==="due"||x.status==="overdue").reduce((a,x)=>a+x.t.total,0), overdue:sts.filter(x=>x.status==="overdue").length };
}
const lowItems = bid => (A.D.menu||[]).filter(i=>i.branch_id===bid && i.active && i.track_stock && Number(i.stock)<=Number(i.low_level));
const stockLabel = i => !i.track_stock ? "" : Number(i.stock)<=0 ? '<span class="pill bad">Out</span>' : Number(i.stock)<=Number(i.low_level) ? `<span class="pill warn">${Number(i.stock)} left</span>` : `<span class="small muted">${Number(i.stock)} left</span>`;
const cartLines = () => Object.entries(POS.cart).filter(([,q])=>q>0).map(([id,q])=>({item:(A.D.menu||[]).find(i=>i.id===id), q})).filter(x=>x.item);
const cartTotal = () => cartLines().reduce((a,{item,q})=>a+q*Number(item.price),0);

/* ---------- Sell (bar staff, managers) ---------- */
function sellView(){
  const bid = A.branch, items = (A.D.menu||[]).filter(i=>i.branch_id===bid && i.active && (POS.outlet==="restaurant" ? true : true));
  const cats = ["All", ...new Set(items.map(i=>i.category))];
  const shown = items.filter(i=>POS.cat==="All" || i.category===POS.cat);
  const lines = cartLines(), total = cartTotal(), T = barTotals(bid, dayKey(Date.now()));
  const mine = posDay(bid, dayKey(Date.now())).slice(0,8);
  const Y = barDepState(bid, addDaysKey(dayKey(Date.now()),-1));
  return `<div class="head"><div><h1>Sell · ${esc(site(bid).name)}</h1><p class="meta">Today: ${T.count} sale${T.count===1?"":"s"} · ${K(T.total)} (cash ${K(T.cash)} · mobile ${K(T.mobile)})</p></div>
    <div class="seg" role="group" aria-label="Outlet"><button data-act="posOutlet" data-v="bar" aria-pressed="${POS.outlet==="bar"}">Bar</button><button data-act="posOutlet" data-v="restaurant" aria-pressed="${POS.outlet==="restaurant"}">Restaurant</button></div></div>
  ${(Y.status==="due"||Y.status==="overdue") && A.me.role==="bar" ? `<div class="panel stripe ${Y.status==="overdue"?"bad":"warn"}"><div class="panel-h"><div><h2>Yesterday's bar deposit: ${K(Y.t.total)}</h2><p class="muted small">Due by 10:00 today.</p></div><button class="btn primary" data-act="tab" data-tab="bardeposit">Go to deposit</button></div></div>`:""}
  ${!items.length ? `<section class="panel"><h2>No items yet</h2><p class="muted">${canManageBar()?"Add drinks and meals under <b>Bar → Menu</b> first.":"Ask the manager to add the menu items."}</p></section>` : `
  <div class="pos">
    <section class="panel"><div class="chips" role="group" aria-label="Category">${cats.map(c=>`<button data-act="posCat" data-v="${esc(c)}" aria-pressed="${POS.cat===c}">${esc(c)}</button>`).join("")}</div>
      <div class="items">${shown.map(i=>`<button class="item" data-act="posAdd" data-id="${i.id}"><b>${esc(i.name)}</b><span class="num">${K(i.price)}</span>${stockLabel(i)}${POS.cart[i.id]?`<span class="qty">${POS.cart[i.id]}</span>`:""}</button>`).join("")}</div></section>
    <section class="panel cart"><div class="panel-h"><h2>Order · ${POS.outlet==="bar"?"Bar":"Restaurant"}</h2>${lines.length?'<button class="btn small" data-act="posClear">Clear</button>':""}</div>
      ${lines.length ? `<div class="lines">${lines.map(({item,q})=>`<div class="line"><span>${esc(item.name)}<span class="small muted"> · ${K(item.price)}</span></span>
        <span class="seg" role="group" aria-label="Quantity of ${esc(item.name)}"><button data-act="posDec" data-id="${item.id}" aria-label="One less">−</button><button disabled>${q}</button><button data-act="posAdd" data-id="${item.id}" aria-label="One more">+</button></span>
        <b class="num">${K(q*Number(item.price))}</b></div>`).join("")}</div>` : '<p class="muted small">Tap items to add them.</p>'}
      <div class="sum-row total"><span>Total</span><span class="num">${K(total)}</span></div>
      <div class="paybtns"><button class="btn primary" data-act="posPay" data-v="cash" ${!lines.length||POS.busy?"disabled":""}>Cash ${K(total)}</button><button class="btn primary" data-act="posPay" data-v="mobile" ${!lines.length||POS.busy?"disabled":""}>Mobile ${K(total)}</button></div>
      <p class="small muted">Take the money first, then tap how they paid. Mobile money goes to the bar number${site(bid).bar_number?` (${esc(site(bid).bar_number)})`:""}.</p>
    </section>
  </div>`}
  <section class="panel"><h2>Today's sales</h2>${mine.length?salesTable(mine,false):'<p class="muted">No sales yet today.</p>'}</section>`;
}
function salesTable(list, withVoid){
  return `<div class="tbl-wrap"><table><thead><tr><th>Receipt</th><th>Time</th><th>Items</th><th>Outlet</th><th>Paid</th><th class="r">Total</th>${withVoid?"<th></th>":""}</tr></thead><tbody>
  ${list.map(s=>{ const ls = (A.D.posLines||[]).filter(l=>l.sale_id===s.id); return `<tr class="${s.voided?"muted":""}"><td class="num">#${s.receipt_no}</td><td class="num">${fmtDay(dayKey(s.sold_at))} ${fmtTime(s.sold_at)}</td>
    <td class="small">${ls.map(l=>`${Number(l.qty)} × ${esc(l.name)}`).join(", ")||"–"}${s.voided?`<div class="small">Voided: ${esc(s.void_reason||"")}</div>`:""}</td>
    <td>${s.outlet==="bar"?"Bar":"Restaurant"}</td><td>${s.payment_method==="cash"?"Cash":"Mobile"}</td><td class="r num">${s.voided?`<s>${K(s.total)}</s>`:`<b>${K(s.total)}</b>`}</td>
    ${withVoid?`<td>${!s.voided&&canManageBar()?`<button class="btn small" data-act="posVoid" data-id="${s.id}">Void</button>`:s.voided?'<span class="pill neutral">Voided</span>':""}</td>`:""}</tr>`; }).join("")}
  </tbody></table></div>`;
}
function barSalesView(){
  const bid = A.branch, list = (A.D.posSales||[]).filter(s=>s.branch_id===bid).slice(0,60);
  return `<div class="head"><div><h1>Bar & restaurant sales</h1><p class="meta">Last 7 days · ${esc(site(bid).name)}</p></div><button class="btn" data-act="refresh">Refresh</button></div>
  <section class="panel">${list.length?salesTable(list,false):'<p class="muted">No sales yet.</p>'}<p class="small muted">Made a mistake? Ask the manager to void the sale. Bar staff cannot delete or change sales.</p></section>`;
}

/* ---------- Bar deposit ---------- */
function barDepositView(){
  const bid = A.branch, today = dayKey(Date.now());
  const keys = isDemo(bid) ? [...last7(), today] : last7();
  const days = keys.map(k=>({k, st:barDepState(bid,k)})).filter(x=>(x.st.status==="due"||x.st.status==="overdue") && x.st.t.count).reverse();
  const T = barTotals(bid, today), num = site(bid).bar_number;
  const card = ({k, st}) => { const prepared = st.row && st.row.status!=="deposited";
    return `<div class="deposit"><div class="small" style="opacity:.85;text-transform:uppercase;letter-spacing:.08em;font-weight:700">${k===today?"Demo: deposit today's bar sales now":st.status==="overdue"?"Overdue":"Due by 10:00 "+fmtDay(addDaysKey(k,1))}</div>
      <h2 style="color:#fff">${fmtDay(k)}</h2><div class="amt">${K(st.t.total)}</div>
      <div class="small" style="opacity:.9">${st.t.count} sales · bar ${K(st.t.bar)} · restaurant ${K(st.t.restaurant)} · cash ${K(st.t.cash)} · mobile ${K(st.t.mobile)}</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">${!prepared?`<button class="btn" data-act="posClose" data-k="${k}">Close ${fmtDay(k)}</button>`:`<button class="btn" data-act="posDepRef" data-k="${k}">Record deposit reference</button>`}</div>
      <p class="small" style="opacity:.8">Put the cash on the bar number${num?` (${esc(num)})`:""}, pay ${K(st.t.total)} to the company Lipila account, then record the mobile money reference.</p></div>`; };
  return `<div class="head"><div><h1>Bar deposit</h1><p class="meta">Bar and restaurant money is deposited separately from rooms, by 10:00 the next morning.</p></div></div>
  <div class="grid2">${days.length?days.map(card).join(""):`<div class="deposit done"><h2>Nothing due</h2><p>All past bar days are deposited.</p></div>`}
  <section class="panel"><h2>Today so far · ${fmtDay(today)}</h2>
    <div class="sum-row"><span>${T.count} sales · bar</span><span class="num">${K(T.bar)}</span></div>
    <div class="sum-row"><span>Restaurant</span><span class="num">${K(T.restaurant)}</span></div>
    <div class="sum-row"><span class="muted">Cash</span><span class="num muted">${K(T.cash)}</span></div>
    <div class="sum-row"><span class="muted">Mobile money</span><span class="num muted">${K(T.mobile)}</span></div>
    <div class="sum-row total"><span>${isDemo(bid)?"To deposit now (demo)":"To deposit tomorrow"}</span><span class="num">${K(T.total)}</span></div></section></div>`;
}

/* ---------- Manager: Bar section ---------- */
function barManageView(){
  const ids = scopeIds(), multi = ids.length>1, P = POS.period;
  const subs = [["sales","Sales"],["stock","Stock"],["take","Stock-take"],["menu","Menu"]].filter(([k])=>!multi || k==="sales" || k==="stock");
  if (!subs.some(([k])=>k===POS.sub)) POS.sub = "sales";
  let body = "";
  if (POS.sub==="sales"){
    const per = ids.map(bid=>({s:site(bid), m:barPeriod(bid,P)}));
    const tot = per.reduce((a,{m})=>{ for (const k in m) a[k]=(a[k]||0)+m[k]; return a; },{});
    const keys = P==="today"?[dayKey(Date.now())]:[...last7().slice(1), dayKey(Date.now())];
    const lines = (A.D.posLines||[]).filter(l=>{ const s=(A.D.posSales||[]).find(x=>x.id===l.sale_id); return s && !s.voided && ids.includes(s.branch_id) && keys.includes(dayKey(s.sold_at)); });
    const top = Object.values(lines.reduce((a,l)=>{ a[l.name]=a[l.name]||{name:l.name,q:0,v:0}; a[l.name].q+=Number(l.qty); a[l.name].v+=Number(l.line_total); return a; },{})).sort((a,b)=>b.v-a.v).slice(0,8);
    const voids = (A.D.posSales||[]).filter(s=>s.voided && ids.includes(s.branch_id) && keys.includes(dayKey(s.sold_at)));
    const recent = (A.D.posSales||[]).filter(s=>ids.includes(s.branch_id)).slice(0,30);
    body = `<div class="kpis">
      <div class="kpi"><div class="l">Bar & restaurant sales</div><div class="v">${K(tot.total)}</div><div class="s">${tot.count} sale${tot.count===1?"":"s"} · ${P==="today"?"today":"last 7 days, including today"}</div></div>
      <div class="kpi"><div class="l">Bar · restaurant</div><div class="v" style="font-size:1.2rem">${K(tot.bar)} · ${K(tot.restaurant)}</div><div class="s">cash ${K(tot.cash)} · mobile ${K(tot.mobile)}</div></div>
      <div class="kpi"><div class="l">Not yet deposited</div><div class="v" style="color:${tot.outstanding?"var(--red)":"var(--green)"}">${K(tot.outstanding)}</div><div class="s">${tot.overdue?tot.overdue+" overdue":"Nothing overdue"}</div></div>
      <div class="kpi"><div class="l">Voided sales</div><div class="v" style="color:${voids.length?"var(--red)":"inherit"}">${voids.length}</div><div class="s">${voids.length?K(voids.reduce((a,s)=>a+Number(s.total),0))+" voided":"None"}</div></div>
    </div>
    ${multi?`<section class="panel"><h2>By branch</h2><div class="tbl-wrap"><table><thead><tr><th>Branch</th><th class="r">Sales</th><th class="r">Bar</th><th class="r">Restaurant</th><th class="r">Not deposited</th><th>Low stock</th></tr></thead><tbody>
      ${per.map(({s,m})=>`<tr><td><b>${esc(s.name)}</b></td><td class="r num">${K(m.total)}</td><td class="r num">${K(m.bar)}</td><td class="r num">${K(m.restaurant)}</td><td class="r num" style="${m.overdue?"color:var(--red);font-weight:700":""}">${m.outstanding?K(m.outstanding):"–"}</td><td>${lowItems(s.id).length?`<span class="pill warn">${lowItems(s.id).length} item${lowItems(s.id).length>1?"s":""}</span>`:"–"}</td></tr>`).join("")}
      </tbody></table></div></section>`:""}
    <div class="grid2"><section class="panel"><h2>Best sellers</h2>${top.length?`<div class="tbl-wrap"><table class="small"><tbody>${top.map(t=>`<tr><td>${esc(t.name)}</td><td class="r num">${t.q}</td><td class="r num"><b>${K(t.v)}</b></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">No sales yet.</p>'}</section>
    <section class="panel"><h2>Bar deposits · last 7 days</h2><div class="tbl-wrap"><table class="small"><tbody>
      ${last7().reverse().flatMap(k=>ids.map(bid=>{ const st=barDepState(bid,k); return st.status==="none"?"":`<tr><td>${fmtDay(k)}</td>${multi?`<td>${esc(site(bid).name)}</td>`:""}<td class="r num">${K(st.t.total)}</td><td>${pill(st.status, st.late)}</td><td class="num">${st.row&&st.row.reference?esc(st.row.reference):""}</td></tr>`; })).join("")||'<tr><td class="muted">No bar sales in the last 7 days.</td></tr>'}
    </tbody></table></div></section></div>
    <section class="panel"><h2>Recent sales</h2>${recent.length?salesTable(recent,true):'<p class="muted">No sales yet.</p>'}${canManageBar()?'<p class="small muted">Only managers and admins can void a sale. The stock goes back and the reason is kept.</p>':""}</section>`;
  }
  if (POS.sub==="stock"){
    const items = (A.D.menu||[]).filter(i=>ids.includes(i.branch_id) && i.active && i.track_stock);
    const val = items.reduce((a,i)=>a+Math.max(0,Number(i.stock))*Number(i.price),0);
    body = `<section class="panel"><div class="panel-h"><h2>Stock levels</h2><span class="small muted">Stock value at selling price: <b>${K(val)}</b></span></div>
    ${items.length?`<div class="tbl-wrap"><table><thead><tr><th>Item</th>${multi?"<th>Branch</th>":""}<th>Category</th><th class="r">In stock</th><th class="r">Reorder at</th><th>Status</th><th class="r">Value</th>${canManageBar()&&!multi?"<th></th>":""}</tr></thead><tbody>
      ${items.sort((a,b)=>(Number(a.stock)-Number(a.low_level))-(Number(b.stock)-Number(b.low_level))).map(i=>`<tr><td><b>${esc(i.name)}</b></td>${multi?`<td>${esc(site(i.branch_id).name)}</td>`:""}<td>${esc(i.category)}</td><td class="r num">${Number(i.stock)}</td><td class="r num">${Number(i.low_level)}</td><td>${stockLabel(i)||""}</td><td class="r num">${K(Math.max(0,Number(i.stock))*Number(i.price))}</td>${canManageBar()&&!multi?`<td><button class="btn small" data-act="posReceive" data-id="${i.id}">Receive stock</button></td>`:""}</tr>`).join("")}
    </tbody></table></div>`:'<p class="muted">No stock items yet. Add them under Menu.</p>'}
    <p class="small muted">Stock goes down with every sale. Use <b>Receive stock</b> when deliveries arrive, and a weekly <b>Stock-take</b> to catch shortages.</p></section>`;
  }
  if (POS.sub==="take"){
    const items = (A.D.menu||[]).filter(i=>i.branch_id===A.branch && i.active && i.track_stock);
    body = canManageBar() ? `<section class="panel"><h2>Stock-take · ${esc(site(A.branch).name)}</h2>
      <p class="small muted">Count what is physically on the shelves and in the store, and enter each number. Leave blank anything you didn't count. The system compares it with what should be there.</p>
      ${items.length?`<form id="stockTake"><div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="r">System says</th><th class="r">Counted</th></tr></thead><tbody>
        ${items.map(i=>`<tr><td><b>${esc(i.name)}</b> <span class="small muted">${esc(i.category)}</span></td><td class="r num">${Number(i.stock)}</td><td class="r"><input type="number" min="0" step="1" data-count="${i.id}" style="max-width:100px;text-align:right" inputmode="numeric"></td></tr>`).join("")}
      </tbody></table></div><div style="margin-top:.8rem"><button class="btn primary" type="submit">Save stock-take</button></div></form>`:'<p class="muted">No stock items yet.</p>'}</section>`
      : `<section class="panel"><p class="muted">Only managers and admins can do a stock-take.</p></section>`;
  }
  if (POS.sub==="menu"){
    const items = (A.D.menu||[]).filter(i=>i.branch_id===A.branch);
    const ed = canManageBar();
    body = `<section class="panel"><h2>Menu · ${esc(site(A.branch).name)}</h2>
    ${items.length?`<div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Outlet</th><th class="r">Price (K)</th><th>Count stock</th><th class="r">Reorder at</th><th>On menu</th></tr></thead><tbody>
      ${items.map(i=>`<tr class="${i.active?"":"muted"}"><td>${ed?`<input type="text" value="${esc(i.name)}" data-menu="name" data-id="${i.id}" style="min-width:160px">`:`<b>${esc(i.name)}</b>`}</td>
        <td>${ed?`<select data-menu="category" data-id="${i.id}">${[...new Set([...CATS,i.category])].map(c=>`<option ${c===i.category?"selected":""}>${esc(c)}</option>`).join("")}</select>`:esc(i.category)}</td>
        <td>${ed?`<select data-menu="outlet" data-id="${i.id}"><option value="bar" ${i.outlet==="bar"?"selected":""}>Bar</option><option value="restaurant" ${i.outlet==="restaurant"?"selected":""}>Restaurant</option></select>`:(i.outlet==="bar"?"Bar":"Restaurant")}</td>
        <td class="r">${ed?`<input type="number" min="0" step="1" value="${Number(i.price)}" data-menu="price" data-id="${i.id}" style="max-width:90px;text-align:right">`:K(i.price)}</td>
        <td>${ed?`<select data-menu="track_stock" data-id="${i.id}"><option value="1" ${i.track_stock?"selected":""}>Yes</option><option value="0" ${i.track_stock?"":"selected"}>No</option></select>`:(i.track_stock?"Yes":"No")}</td>
        <td class="r">${ed&&i.track_stock?`<input type="number" min="0" step="1" value="${Number(i.low_level)}" data-menu="low_level" data-id="${i.id}" style="max-width:70px;text-align:right">`:(i.track_stock?Number(i.low_level):"–")}</td>
        <td>${ed?`<select data-menu="active" data-id="${i.id}"><option value="1" ${i.active?"selected":""}>Yes</option><option value="0" ${i.active?"":"selected"}>No</option></select>`:(i.active?"Yes":"No")}</td></tr>`).join("")}
    </tbody></table></div>`:'<p class="muted">No items yet.</p>'}
    ${ed?`<h3>Add an item</h3><form id="menuAdd" class="inline">
      <label class="f">Name<input id="mi-name" type="text" required placeholder="e.g. Mosi Lager 375ml"></label>
      <label class="f">Category<select id="mi-cat">${CATS.map(c=>`<option>${c}</option>`).join("")}</select></label>
      <label class="f">Outlet<select id="mi-outlet"><option value="bar">Bar</option><option value="restaurant">Restaurant</option></select></label>
      <label class="f">Price (K)<input id="mi-price" type="number" min="0" step="1" required></label>
      <label class="f">Count stock?<select id="mi-track"><option value="1">Yes (drinks, packets)</option><option value="0">No (cooked meals)</option></select></label>
      <label class="f">Reorder at<input id="mi-low" type="number" min="0" step="1" value="5"></label>
      <button class="btn primary" type="submit">Add item</button></form>
      <p class="small muted">New items start at 0 in stock. Use <b>Stock → Receive stock</b> to enter what you have. Turn an item off instead of removing it, so its sales history stays.</p>`:""}
    </section>`;
  }
  return `<div class="head"><div><h1>Bar & restaurant</h1><p class="meta">${multi?"All branches":esc(site(A.branch).name)} · sales, stock and deposits</p></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">${POS.sub==="sales"?`<div class="seg" role="group" aria-label="Period"><button data-act="posPeriod" data-v="today" aria-pressed="${P==="today"}">Today</button><button data-act="posPeriod" data-v="week" aria-pressed="${P==="week"}">Last 7 days</button></div>`:""}
    <div class="seg" role="group" aria-label="Bar section">${subs.map(([k,l])=>`<button data-act="posSub" data-v="${k}" aria-pressed="${POS.sub===k}">${l}</button>`).join("")}</div></div></div>
  ${(() => { const lows = ids.flatMap(lowItems); return lows.length&&POS.sub!=="stock" ? `<div class="panel stripe warn"><b>Low stock:</b> ${lows.slice(0,8).map(i=>`${esc(i.name)} (${Number(i.stock)})`).join(", ")}${lows.length>8?"…":""}</div>` : ""; })()}
  ${body}`;
}

/* ---------- modals ---------- */
function barModal(m){
  const wrap = (inner, id) => `<div class="scrim"><form class="modal" id="${id}">${inner}${m.err?`<p class="err">${esc(m.err)}</p>`:""}</form></div>`;
  if (m.type==="posVoid"){ const s = (A.D.posSales||[]).find(x=>x.id===m.id); return wrap(`<h2>Void receipt #${s.receipt_no}</h2>
    <p class="muted small">${K(s.total)} · ${fmtTime(s.sold_at)}. The stock goes back and the sale is kept as voided with your reason.</p>
    <label class="f">Reason<input id="pv-reason" type="text" required placeholder="e.g. Rang up the wrong drink"></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit" style="background:var(--red);border-color:var(--red)">Void sale</button></div>`, "posVoidForm"); }
  if (m.type==="posReceive"){ const i = (A.D.menu||[]).find(x=>x.id===m.id); return wrap(`<h2>Receive stock · ${esc(i.name)}</h2>
    <p class="muted small">Now in stock: ${Number(i.stock)}. Count the delivery before you enter it.</p>
    <label class="f">How many arrived (units)<input id="pr-qty" type="number" min="1" step="1" required inputmode="numeric"></label>
    <label class="f">Note (supplier, invoice)<input id="pr-note" type="text" placeholder="optional"></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Add to stock</button></div>`, "posReceiveForm"); }
  if (m.type==="posDepRef") return wrap(`<h2>Record bar deposit · ${fmtDay(m.k)}</h2>
    <p>Amount: <b>${K(barDepState(A.branch, m.k).t.total)}</b></p><p class="small muted">Enter the reference from the mobile money message after paying the company Lipila account.</p>
    <label class="f">Mobile money reference<input id="pd-ref" type="text" required></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save deposit</button></div>`, "posDepForm");
  if (m.type==="posTakeResult"){ const r = m.result; return `<div class="scrim"><div class="modal"><h2>Stock-take saved</h2>
    <p>${r.counted} item${r.counted===1?"":"s"} counted. ${r.differences.length?`${r.differences.length} did not match.`:"Everything matched."}</p>
    ${r.differences.length?`<div class="tbl-wrap"><table class="small"><thead><tr><th>Item</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th></tr></thead><tbody>${r.differences.map(d=>`<tr><td>${esc(d.name)}</td><td class="r num">${Number(d.expected)}</td><td class="r num">${Number(d.counted)}</td><td class="r num" style="color:${d.diff<0?"var(--red)":"var(--green)"}">${d.diff>0?"+":""}${Number(d.diff)} (${K(Math.abs(d.value))})</td></tr>`).join("")}</tbody></table></div>`:""}
    ${r.shortage_value?`<p class="err">Shortage worth ${K(r.shortage_value)} at selling price.</p>`:""}
    <div class="actions"><button type="button" class="btn primary" data-act="close">Done</button></div></div></div>`; }
  return "";
}

/* ---------- events ---------- */
document.addEventListener("click", async e=>{
  const b = e.target.closest("[data-act]"); if (!b || b.tagName==="INPUT" || b.tagName==="SELECT") return;
  const a = b.dataset.act, id = b.dataset.id; if (!a.startsWith("pos")) return;
  try {
    if (a==="posOutlet"){ POS.outlet=b.dataset.v; render(); }
    if (a==="posCat"){ POS.cat=b.dataset.v; render(); }
    if (a==="posAdd"){ POS.cart[id]=(POS.cart[id]||0)+1; render(); }
    if (a==="posDec"){ POS.cart[id]=Math.max(0,(POS.cart[id]||0)-1); if (!POS.cart[id]) delete POS.cart[id]; render(); }
    if (a==="posClear"){ POS.cart={}; render(); }
    if (a==="posSub"){ POS.sub=b.dataset.v; render(); }
    if (a==="posPeriod"){ POS.period=b.dataset.v; render(); }
    if (a==="posPay"){ if (POS.busy) return; POS.busy=true; render();
      const lines = cartLines().map(({item,q})=>({item_id:item.id, qty:q}));
      const { data, error } = await sb.rpc("pos_record_sale",{p_branch:A.branch, p_outlet:POS.outlet, p_lines:lines, p_method:b.dataset.v});
      POS.busy=false; if (error){ render(); throw error; }
      POS.cart={}; await refresh();
      toast(`Receipt #${data.receipt_no} · ${K(data.total)} ${b.dataset.v==="cash"?"cash":"mobile"}${data.low&&data.low.length?" · Low stock: "+data.low.map(x=>x.name).join(", "):""}`); }
    if (a==="posVoid"){ A.modal={type:"posVoid", id}; render(); }
    if (a==="posReceive"){ A.modal={type:"posReceive", id}; render(); }
    if (a==="posClose"){ const { error } = await sb.rpc("pos_prepare_deposit",{p_branch:A.branch, p_date:b.dataset.k}); if (error) throw error; await refresh(); toast(fmtDay(b.dataset.k)+" closed. Record the deposit reference after paying."); }
    if (a==="posDepRef"){ A.modal={type:"posDepRef", k:b.dataset.k}; render(); }
  } catch(err){ POS.busy=false; fail(err); }
});
document.addEventListener("change", async e=>{
  const t = e.target; if (!t.dataset || !t.dataset.menu) return;
  const f = t.dataset.menu; let v = t.value;
  if (f==="price"||f==="low_level") v = Math.max(0, Number(v)||0);
  if (f==="track_stock"||f==="active") v = v==="1";
  if (f==="name"){ v = v.trim(); if (!v) return fail("Name cannot be empty"); }
  try { const { error } = await sb.from("menu_items").update({[f]:v}).eq("id", t.dataset.id); if (error) throw error; await refresh(); toast("Menu updated"); } catch(err){ fail(err); }
});
document.addEventListener("submit", async e=>{
  const f = e.target.id; if (!["posVoidForm","posReceiveForm","posDepForm","stockTake","menuAdd"].includes(f)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const setErr = msg => { if (A.modal) A.modal.err = msg; render(); };
  const g = id => document.getElementById(id);
  try {
    if (f==="posVoidForm"){ const { error } = await sb.rpc("pos_void_sale",{p_sale:A.modal.id, p_reason:g("pv-reason").value}); if (error) return setErr(error.message); A.modal=null; await refresh(); toast("Sale voided"); }
    if (f==="posReceiveForm"){ const { data, error } = await sb.rpc("stock_receive",{p_item:A.modal.id, p_qty:Number(g("pr-qty").value), p_note:g("pr-note").value}); if (error) return setErr(error.message); A.modal=null; await refresh(); toast("Stock updated: "+Number(data)+" in stock"); }
    if (f==="posDepForm"){ const { error } = await sb.rpc("pos_record_deposit",{p_branch:A.branch, p_date:A.modal.k, p_reference:g("pd-ref").value}); if (error) return setErr(error.message); A.modal=null; await refresh(); toast("Bar deposit recorded"); }
    if (f==="stockTake"){ const counts = [...document.querySelectorAll("[data-count]")].filter(i=>i.value!=="").map(i=>({item_id:i.dataset.count, counted:Number(i.value)}));
      if (!counts.length) return fail("Enter at least one count");
      const { data, error } = await sb.rpc("stock_take",{p_branch:A.branch, p_counts:counts}); if (error) throw error;
      await refresh(); A.modal={type:"posTakeResult", result:data}; render(); }
    if (f==="menuAdd"){ const name = g("mi-name").value.trim(), price = Number(g("mi-price").value);
      if (!name) return fail("Enter the item name");
      const { error } = await sb.from("menu_items").insert({branch_id:A.branch, name, category:g("mi-cat").value, outlet:g("mi-outlet").value, price:Math.max(0,price||0), track_stock:g("mi-track").value==="1", low_level:Math.max(0,Number(g("mi-low").value)||0)});
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "That item already exists" : error.message);
      await refresh(); toast(name+" added"); }
  } catch(err){ fail(err); }
}, true);
