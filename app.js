/* Vetus Lodge Daily Sales — live app (Supabase) */
const SB_URL = "https://csmtjttaeibqesgymxfs.supabase.co";
const SB_KEY = "sb_publishable_t1AeDZDr6_czlrU4NxWZNw_ri712Jnr";
const DOMAIN = "staff.vetuslodge.app";
const sb = supabase.createClient(SB_URL, SB_KEY);

const K = n => "K" + Math.round(Number(n)||0).toLocaleString("en-ZM");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const TZ = "Africa/Lusaka";
const dayKey = d => new Intl.DateTimeFormat("en-CA",{timeZone:TZ}).format(new Date(d));
const addDaysKey = (key, n) => { const d = new Date(key+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const fmtDay = key => new Date(key+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});
const fmtTime = d => new Date(d).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:TZ});
const ROLES = {reception:"Reception", manager:"Manager", director:"Director", admin:"System admin"};
const pct = v => v==null || !isFinite(v) ? "–" : Math.round(v*100)+"%";

const A = {me:null, branches:[], branch:null, tab:null, period:"week", modal:null, toast:null, err:"", busy:false, adminTab:"users",
  D:{checkins:[], waivers:[], deposits:[], sync:[], directors:[], profiles:[]}, loaded:false};

const $app = document.getElementById("app");
function render(){
  let body;
  if (!A.me) body = loginView();
  else if (A.me.must_change_password) body = changePwView();
  else if (!A.branch) body = branchPicker();
  else body = shell();
  $app.innerHTML = body + modalView() + (A.toast?`<div class="toast" role="status">${esc(A.toast)}</div>`:"");
}
function toast(m){ A.toast=m; render(); clearTimeout(toast.t); toast.t=setTimeout(()=>{A.toast=null;render()},3200); }
const fail = e => toast(e?.message || String(e));

/* ---------- Data ---------- */
async function loadMe(){
  const { data:{ user } } = await sb.auth.getUser();
  if (!user){ A.me=null; return; }
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (error || !data){ await sb.auth.signOut(); A.me=null; A.err="This login has no staff profile. Ask the system admin."; return; }
  if (!data.active){ await sb.auth.signOut(); A.me=null; A.err="This account is disabled. Ask the system admin."; return; }
  A.me = data;
  const b = await sb.from("branches").select("*").order("name");
  A.branches = b.data || [];
}
const site = id => A.branches.find(b=>b.id===id) || {id, name:id, room_count:0, rate:0};
const scopeIds = () => A.branch==="ALL" ? A.branches.map(b=>b.id) : [A.branch];
async function loadData(){
  const ids = scopeIds(), today = dayKey(Date.now()), since = addDaysKey(today,-8);
  const sinceTs = new Date(since+"T00:00:00+02:00").toISOString();
  const [c, d, s, dir] = await Promise.all([
    sb.from("checkins").select("*").in("branch_id", ids).gte("came_at", sinceTs).order("came_at",{ascending:false}),
    sb.from("deposits").select("*").in("branch_id", ids).gte("business_date", since),
    sb.from("sync_status").select("*").in("branch_id", ids),
    sb.rpc("list_directors"),
  ]);
  for (const r of [c,d,s,dir]) if (r.error) throw r.error;
  A.D.checkins = c.data; A.D.deposits = d.data; A.D.sync = s.data; A.D.directors = dir.data;
  const cids = c.data.map(x=>x.id);
  A.D.waivers = [];
  if (cids.length){ const w = await sb.from("waivers").select("*").in("checkin_id", cids); if (w.error) throw w.error; A.D.waivers = w.data; }
  if (["admin","manager","director"].includes(A.me.role)){ const p = await sb.from("profiles").select("*").order("full_name"); A.D.profiles = p.data||[]; }
  const b = await sb.from("branches").select("*").order("name"); A.branches = b.data || A.branches;
  A.loaded = true;
}
async function refresh(){ try { await loadData(); } catch(e){ fail(e); } render(); }

/* ---------- Calculations ---------- */
const waiverOf = c => A.D.waivers.find(w=>w.checkin_id===c.id && w.status!=="disputed");
const charged = c => { const w = waiverOf(c); return w ? Number(w.new_amount) : Number(c.amount_due); };
const salesRows = (bid, key) => A.D.checkins.filter(c=>c.branch_id===bid && !c.is_copy && dayKey(c.came_at)===key);
function dayTotals(bid, key){
  const ss = salesRows(bid, key);
  const expected = ss.reduce((a,c)=>a+Number(c.amount_due),0), total = ss.reduce((a,c)=>a+charged(c),0);
  return { ss, count:ss.length, expected, waived:expected-total, total,
    cash: ss.filter(c=>c.payment_method==="cash").reduce((a,c)=>a+charged(c),0),
    mobile: ss.filter(c=>c.payment_method==="mobile").reduce((a,c)=>a+charged(c),0),
    unpaid: ss.filter(c=>!c.payment_method), nights: ss.reduce((a,c)=>a+c.nights,0) };
}
function depositState(bid, key){
  const row = A.D.deposits.find(d=>d.branch_id===bid && d.business_date===key);
  const t = dayTotals(bid, key);
  if (row && row.status==="deposited") return {status:"deposited", row, t, late: new Date(row.paid_at) > new Date(addDaysKey(key,1)+"T10:00:00+02:00")};
  if (!t.count && !row) return {status:"none", t};
  const overdue = Date.now() > new Date(addDaysKey(key,1)+"T10:00:00+02:00").getTime();
  return {status: overdue ? "overdue" : "due", row, t};
}
function pill(s, late){
  if (s==="deposited") return late ? '<span class="pill warn">Deposited late</span>' : '<span class="pill ok">Deposited</span>';
  if (s==="overdue") return '<span class="pill bad">Overdue</span>';
  if (s==="due") return '<span class="pill warn">Due by 10:00</span>';
  return '<span class="pill neutral">No sales</span>';
}
const wPill = w => w.status==="confirmed" ? '<span class="pill ok">Confirmed</span>' : w.status==="disputed" ? '<span class="pill bad">Disputed</span>' : '<span class="pill warn">Awaiting director</span>';
const dirName = id => (A.D.directors.find(d=>d.id===id)||A.D.profiles.find(p=>p.id===id)||{}).full_name || "Director";
const last7 = () => { const t = dayKey(Date.now()); return [7,6,5,4,3,2,1].map(i=>addDaysKey(t,-i)); };
function syncLine(bid){
  const s = A.D.sync.find(x=>x.branch_id===bid);
  if (!s || !s.last_seen) return '<span class="muted">DS668 sync not connected yet · check-ins entered by hand</span>';
  const mins = Math.round((Date.now()-new Date(s.last_seen))/60000);
  return mins > 15 ? `<b style="color:var(--red)">DS668 sync last seen ${mins} min ago</b>` : `DS668 synced ${mins} min ago`;
}

/* ---------- Views: auth ---------- */
function topBar(){
  const br = !A.branch ? "None" : A.branch==="ALL" ? "All branches" : site(A.branch).name;
  const multi = A.me && (A.me.role!=="reception");
  return `<div class="bar-in"><img src="logo.jpg" alt="Vetus Lodge logo">
    <div><div class="name">Vetus Lodge</div><div class="sub">Daily Sales</div></div><div class="spacer"></div>
    <div class="who small"><span>Role: <b>${A.me?ROLES[A.me.role]:"None"}</b></span><span>Branch: <b>${esc(br)}</b></span>
    ${A.me?`<span>${esc(A.me.full_name)}</span>`:""}
    ${A.me&&A.branch&&multi?`<button class="btn small" data-act="switchBranch">Switch branch</button>`:""}
    ${A.me?`<button class="btn small" data-act="logout">Log out</button>`:""}</div></div>`;
}
function loginView(){
  return `<header class="bar">${topBar()}</header>
  <div class="login"><div class="login-card"><div class="top"><img src="logo.jpg" alt="Vetus Lodge"></div>
  <form class="body" id="loginForm"><div><h1>Sign in</h1><p class="muted small">Daily check-ins, payments and Lipila deposits.</p></div>
    <label class="f">Username<input id="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label class="f">Password<input id="password" type="password" autocomplete="current-password" required></label>
    ${A.err?`<p class="err">${esc(A.err)}</p>`:""}
    <button class="btn primary" type="submit" style="justify-content:center" ${A.busy?"disabled":""}>${A.busy?'<span class="spin"></span> Signing in':"Sign in"}</button>
    <p class="small muted">Forgot your password? Ask the system admin to reset it.</p>
  </form></div></div>`;
}
function changePwView(){
  return `<header class="bar">${topBar()}</header>
  <div class="login"><div class="login-card"><div class="top"><img src="logo.jpg" alt="Vetus Lodge"></div>
  <form class="body" id="pwForm"><div><h1>Set your password</h1><p class="muted small">Welcome, ${esc(A.me.full_name)}. Replace the temporary password with one only you know.</p></div>
    <label class="f">New password (at least 8 characters)<input id="pw1" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="f">Type it again<input id="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
    ${A.err?`<p class="err">${esc(A.err)}</p>`:""}
    <button class="btn primary" type="submit" style="justify-content:center">Save password</button>
  </form></div></div>`;
}
function branchPicker(){
  const ids = A.me.role==="reception" ? [A.me.branch_id] : A.branches.map(b=>b.id);
  return `<header class="bar">${topBar()}</header><main>
  <div class="head"><div><h1>Select active branch</h1><p class="meta">Choose a branch to see its check-ins, payments and deposits.</p></div></div>
  <div class="grid3">${ids.map(id=>{ const s=site(id); return `<button type="button" class="panel branch" data-act="pickBranch" data-id="${id}">
    <span style="font-family:var(--f-display);font-weight:800;font-size:1.15rem">${esc(s.name)}</span>
    <span class="small muted">${s.room_count} rooms · ${K(s.rate)} per night</span>
    <span class="small" style="color:var(--green);font-weight:700">Open ${esc(s.name)} →</span></button>`; }).join("")}
  ${A.me.role!=="reception"?`<button type="button" class="panel branch" data-act="pickBranch" data-id="ALL" style="background:var(--brand-2);color:#fff;border-color:var(--gold-line)">
    <span style="font-family:var(--f-display);font-weight:800;font-size:1.15rem">All branches</span>
    <span class="small" style="opacity:.85">Business overview: each branch, then the whole business.</span>
    <span class="small" style="font-weight:700;color:var(--gold-line)">Open overview →</span></button>`:""}
  </div></main>`;
}

/* ---------- Shell + tabs ---------- */
function tabsFor(){
  const r = A.me.role;
  if (A.branch==="ALL") return r==="admin" ? [["dash","Overview"],["deposits","Deposits"],["waivers","Waivers"],["admin","Settings"]] : [["dash","Overview"],["deposits","Deposits"],["waivers","Waivers"]];
  if (r==="reception") return [["today","Today"],["deposit","Deposit"],["deposits","History"]];
  const t = [["today","Today"],["deposit","Deposit"],["deposits","Deposits"],["waivers","Waivers"]];
  return r==="admin" ? [...t,["admin","Settings"]] : t;
}
function shell(){
  return `<header class="bar">${topBar()}<nav class="nav" aria-label="Sections">${tabsFor().map(([k,l])=>`<button data-act="tab" data-tab="${k}" aria-current="${A.tab===k?"page":"false"}">${l}</button>`).join("")}</nav></header>
  <main>${!A.loaded?'<p class="muted"><span class="spin"></span> Loading…</p>':view()}</main>`;
}
function view(){
  const t = A.tab;
  if (t==="admin") return adminView();
  if (t==="deposits") return depositsView();
  if (t==="waivers") return waiversView();
  if (t==="dash" || A.branch==="ALL") return overviewView();
  if (t==="deposit") return depositView();
  return todayView();
}

/* Today (one branch) */
function todayView(){
  const bid = A.branch, s = site(bid), today = dayKey(Date.now()), T = dayTotals(bid, today);
  const y = addDaysKey(today,-1), Y = depositState(bid, y);
  const canPay = ["reception","manager","admin"].includes(A.me.role);
  const all = A.D.checkins.filter(c=>c.branch_id===bid && dayKey(c.came_at)===today);
  return `<div class="head"><div><h1>Today at ${esc(s.name)}</h1><p class="meta">${fmtDay(today)} · ${syncLine(bid)}</p></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" data-act="refresh">Refresh</button>${canPay?`<button class="btn primary" data-act="manual">Add check-in</button>`:""}</div></div>
  ${Y.status==="due"||Y.status==="overdue"?`<div class="panel stripe ${Y.status==="overdue"?"bad":"warn"}"><div class="panel-h"><div><h2>Yesterday's deposit: ${K(Y.t.total)}</h2><p class="muted small">${fmtDay(y)} must be paid by 10:00 today.</p></div><button class="btn primary" data-act="tab" data-tab="deposit">Go to deposit</button></div></div>`:""}
  <div class="kpis">
    <div class="kpi"><div class="l">Check-ins</div><div class="v">${T.count}</div><div class="s">${pct(T.count/s.room_count)} of ${s.room_count} rooms</div></div>
    <div class="kpi"><div class="l">Due today</div><div class="v">${K(T.total)}</div><div class="s">${T.waived?K(T.waived)+" waived":"No waivers"}</div></div>
    <div class="kpi"><div class="l">Cash in hand</div><div class="v">${K(T.cash)}</div><div class="s">Mobile ${K(T.mobile)}</div></div>
    <div class="kpi"><div class="l">Not recorded</div><div class="v" style="color:${T.unpaid.length?"var(--red)":"var(--green)"}">${T.unpaid.length}</div><div class="s">${T.unpaid.length?"Record how they paid":"All recorded"}</div></div>
  </div>
  <section class="panel"><div class="panel-h"><h2>Today's check-ins</h2><span class="muted small">Rate ${K(s.rate)} per night</span></div>
  ${all.length?`<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Room</th><th class="r">Nights</th><th class="r">Amount</th><th>Paid by</th><th>Waiver</th><th>Source</th></tr></thead><tbody>
  ${all.map(c=>{ const w = A.D.waivers.find(x=>x.checkin_id===c.id); return c.is_copy ? `<tr class="muted"><td class="num">${fmtTime(c.came_at)}</td><td>Room ${esc(c.room)}</td><td colspan="4">Extra card for the same stay (not a new sale)</td><td>DS668</td></tr>` : `<tr>
    <td class="num">${fmtTime(c.came_at)}</td><td><b>Room ${esc(c.room)}</b></td><td class="r num">${c.nights}</td>
    <td class="r num">${w&&w.status!=="disputed"?`<s class="muted">${K(c.amount_due)}</s> `:""}<b>${K(charged(c))}</b></td>
    <td>${canPay?`<div class="seg" role="group" aria-label="Payment for room ${esc(c.room)}"><button data-act="pay" data-id="${c.id}" data-v="cash" aria-pressed="${c.payment_method==="cash"}">Cash</button><button data-act="pay" data-id="${c.id}" data-v="mobile" aria-pressed="${c.payment_method==="mobile"}">Mobile</button></div>`:(c.payment_method||"–")}${c.payment_method?"":' <span class="pill bad">Not recorded</span>'}</td>
    <td>${w?`${wPill(w)}<div class="small muted">${esc(dirName(w.director_id))}</div>`:(canPay?`<button class="btn small" data-act="waiver" data-id="${c.id}">Record waiver</button>`:"–")}</td>
    <td class="small">${c.source==="manual"?"Entered by hand":"DS668"}</td></tr>`; }).join("")}
  </tbody></table></div>`:`<p class="muted">No check-ins yet today. ${canPay?"Use <b>Add check-in</b> after issuing a card in DS668.":""}</p>`}</section>`;
}

/* Deposit (one branch) */
function depositView(){
  const bid = A.branch, today = dayKey(Date.now());
  const days = last7().map(k=>({k, st:depositState(bid,k)})).filter(x=>x.st.status==="due"||x.st.status==="overdue").reverse();
  const T = dayTotals(bid, today);
  const card = ({k, st}) => {
    const prepared = st.row && st.row.status!=="deposited";
    return `<div class="deposit"><div class="small" style="opacity:.85;text-transform:uppercase;letter-spacing:.08em;font-weight:700">${st.status==="overdue"?"Overdue":"Due by 10:00 "+fmtDay(addDaysKey(k,1))}</div>
      <h2 style="color:#fff">${fmtDay(k)}</h2><div class="amt">${K(st.t.total)}</div>
      <div class="small" style="opacity:.9">${st.t.count} check-ins · cash ${K(st.t.cash)} · mobile ${K(st.t.mobile)}${st.t.waived?" · "+K(st.t.waived)+" waived":""}</div>
      ${st.t.unpaid.length?`<p class="small" style="color:#FFD6D4;font-weight:700">${st.t.unpaid.length} check-in(s) still have no payment recorded. Record them first.</p>`:""}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${!prepared?`<button class="btn" data-act="closeDay" data-k="${k}" ${st.t.unpaid.length?"disabled":""}>Close ${fmtDay(k)}</button>`:
        `<button class="btn" data-act="testDeposit" data-k="${k}">Record deposit reference</button>`}</div>
      <p class="small" style="opacity:.8">Lipila is not connected yet. Pay ${K(st.t.total)} to the company number as usual, then record the mobile money reference here (test mode).</p></div>`;
  };
  return `<div class="head"><div><h1>Deposit</h1><p class="meta">Each day's total goes to the company's Lipila account by 10:00 the next morning.</p></div></div>
  <div class="grid2">${days.length?days.map(card).join(""):`<div class="deposit done"><h2>Nothing due</h2><p>All past days are deposited.</p></div>`}
  <section class="panel"><h2>Today so far · ${fmtDay(today)}</h2>
    <div><div class="sum-row"><span>${T.count} check-ins expected</span><span class="num">${K(T.expected)}</span></div>
    <div class="sum-row"><span>Waivers approved by directors</span><span class="num">− ${K(T.waived)}</span></div>
    <div class="sum-row"><span class="muted">Cash recorded</span><span class="num muted">${K(T.cash)}</span></div>
    <div class="sum-row"><span class="muted">Mobile money recorded</span><span class="num muted">${K(T.mobile)}</span></div>
    <div class="sum-row total"><span>To deposit tomorrow</span><span class="num">${K(T.total)}</span></div></div></section></div>`;
}

/* Deposits table */
function depositsView(){
  const ids = scopeIds(), rows = [];
  for (const k of last7().reverse()) for (const bid of ids){ const st = depositState(bid,k); rows.push({k,bid,st}); }
  return `<div class="head"><div><h1>Deposits</h1><p class="meta">Last 7 days · due by 10:00 the next morning</p></div><button class="btn" data-act="refresh">Refresh</button></div>
  <section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Day</th>${ids.length>1?"<th>Branch</th>":""}<th class="r">Check-ins</th><th class="r">Waived</th><th class="r">Total</th><th>Status</th><th>Reference</th></tr></thead><tbody>
  ${rows.map(({k,bid,st})=>`<tr><td>${fmtDay(k)}</td>${ids.length>1?`<td>${esc(site(bid).name)}</td>`:""}<td class="r num">${st.t.count}</td><td class="r num">${st.t.waived?K(st.t.waived):"–"}</td><td class="r num"><b>${K(st.t.total)}</b></td><td>${pill(st.status, st.late)}</td>
    <td class="small num">${st.row&&st.row.lipila_reference?esc(st.row.lipila_reference)+(st.row.test_mode?' <span class="pill neutral">test</span>':""):"–"}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}

/* Waivers */
function waiversView(){
  const ws = [...A.D.waivers].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return `<div class="head"><div><h1>Waivers</h1><p class="meta">Discounts approved by phone by a director.${A.me.role==="director"?" Confirm each one given in your name.":""}</p></div></div>
  <section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Day</th><th>Branch · room</th><th class="r">Normal</th><th class="r">Charged</th><th>Approved by</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
  ${ws.map(w=>{ const c = A.D.checkins.find(x=>x.id===w.checkin_id)||{}; const mine = A.me.role==="director" && w.director_id===A.me.id && w.status==="pending";
    return `<tr><td>${c.came_at?fmtDay(dayKey(c.came_at)):"–"}</td><td>${esc(site(c.branch_id).name)} · ${esc(c.room)}</td><td class="r num">${K(c.amount_due)}</td><td class="r num"><b>${K(w.new_amount)}</b></td><td>${esc(dirName(w.director_id))}</td><td>${esc(w.reason)}</td><td>${wPill(w)}</td>
    <td style="white-space:nowrap">${mine?`<button class="btn small primary" data-act="wdecide" data-id="${w.id}" data-v="confirmed">Confirm</button> <button class="btn small danger" data-act="wdecide" data-id="${w.id}" data-v="disputed">I didn't approve this</button>`:""}</td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">No waivers in the last 7 days.</td></tr>`}
  </tbody></table></div></section>`;
}

/* Business overview */
function stats(bid, P){
  const s = site(bid), today = dayKey(Date.now());
  if (P==="today"){ const T = dayTotals(bid, today), y = depositState(bid, addDaysKey(today,-1));
    return {sales:T.total, checkins:T.count, nights:T.nights, occ:T.count/s.room_count, waived:T.waived, cash:T.cash, mobile:T.mobile,
      outstanding:(y.status==="due"||y.status==="overdue")?y.t.total:0, overdue:y.status==="overdue"?1:0, unrecorded:T.unpaid.length, series:null}; }
  const days = last7(), sts = days.map(k=>depositState(bid,k));
  const sum = f => sts.reduce((a,x)=>a+f(x),0), paid = sts.filter(x=>x.status==="deposited");
  return {sales:sum(x=>x.t.total), checkins:sum(x=>x.t.count), nights:sum(x=>x.t.nights), occ:sum(x=>x.t.nights)/(s.room_count*7), waived:sum(x=>x.t.waived),
    cash:sum(x=>x.t.cash), mobile:sum(x=>x.t.mobile), outstanding:sts.filter(x=>x.status==="due"||x.status==="overdue").reduce((a,x)=>a+x.t.total,0),
    overdue:sts.filter(x=>x.status==="overdue").length, ontime: paid.length? paid.filter(x=>!x.late).length/paid.length : null, series: sts.map(x=>x.t.total)};
}
function spark(vals, color){
  const W=160,H=36,max=Math.max(...vals,1),bw=W/vals.length;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="36" role="img" aria-label="Daily sales, last 7 days">${vals.map((v,i)=>`<rect x="${i*bw+2}" y="${H-(v/max)*(H-4)}" width="${bw-4}" height="${Math.max(0,(v/max)*(H-4))}" rx="2" fill="${color}" opacity="${i===vals.length-1?1:.55}"><title>${K(v)}</title></rect>`).join("")}</svg>`;
}
function chart(ids){
  const days = last7(), W=640,H=220,pl=44,pb=26,pt=18, cw=(W-pl-10)/7;
  const tot = days.map(k=>ids.reduce((a,b)=>a+dayTotals(b,k).total,0));
  const max = Math.max(2000, Math.ceil(Math.max(...tot)*1.08/2000)*2000), y = v => pt+(H-pt-pb)*(1-v/max);
  let g=""; for (let v=0; v<=max; v+=max/4) g += `<line class="grid" x1="${pl}" x2="${W-10}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${v?K(v):"0"}</text>`;
  days.forEach((k,i)=>{ let acc=0; const x=pl+i*cw+cw*.2, w=cw*.6;
    ids.forEach((b,j)=>{ const v=dayTotals(b,k).total; g+=`<rect x="${x}" y="${y(acc+v)}" width="${w}" height="${y(acc)-y(acc+v)}" fill="var(--site${(j%3)+1})"><title>${esc(site(b).name)} ${fmtDay(k)}: ${K(v)}</title></rect>`; acc+=v; });
    g+=`<text x="${x+w/2}" y="${H-8}" text-anchor="middle">${fmtDay(k).slice(0,3)}</text>`;
    if (acc) g+=`<text x="${x+w/2}" y="${y(acc)-4}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${(acc/1000).toFixed(1)}k</text>`; });
  return `<div class="tbl-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily sales by branch">${g}</svg></div>
  <div class="legend">${ids.map((b,j)=>`<span style="--c:var(--site${(j%3)+1})">${esc(site(b).name)}</span>`).join("")}</div>`;
}
function overviewView(){
  const P = A.period, label = P==="today"?"today so far":"last 7 days", ids = scopeIds();
  const per = ids.map((bid,j)=>({s:site(bid), j, m:stats(bid,P)}));
  const tot = per.reduce((a,{m})=>{ for (const k of ["sales","checkins","nights","waived","cash","mobile","outstanding","overdue"]) a[k]=(a[k]||0)+m[k]; return a; },{});
  const rooms = per.reduce((a,{s})=>a+s.room_count,0);
  const occ = P==="today" ? tot.checkins/rooms : tot.nights/(rooms*7);
  const pend = A.D.waivers.filter(w=>w.status==="pending").length;
  const alerts = [];
  per.forEach(({s,m})=>{ if (m.overdue) alerts.push(["bad",`<b>${esc(s.name)}</b>: ${m.overdue} deposit${m.overdue>1?"s":""} not paid by 10:00 (${K(m.outstanding)}).`]); });
  if (pend) alerts.push(["warn",`${pend} waiver${pend>1?"s":""} awaiting director confirmation. <button class="btn small" data-act="tab" data-tab="waivers">Review</button>`]);
  const card = ({s,j,m}) => `<section class="panel stripe ${m.overdue?"bad":m.outstanding?"warn":"ok"}">
    <div class="panel-h"><h2>${esc(s.name)}</h2><span class="small muted">${s.room_count} rooms</span></div>
    <div><div class="muted small">Sales, ${label}</div><div class="num" style="font-family:var(--f-display);font-weight:800;font-size:1.6rem;line-height:1.1">${K(m.sales)}</div></div>
    ${m.series?spark(m.series,`var(--site${(j%3)+1})`):""}
    <div class="tbl-wrap"><table class="small"><tbody>
      <tr><td class="muted">Check-ins</td><td class="r num">${m.checkins}</td></tr>
      <tr><td class="muted">Occupancy</td><td class="r num">${pct(m.occ)}</td></tr>
      <tr><td class="muted">Cash · mobile</td><td class="r num">${K(m.cash)} · ${K(m.mobile)}</td></tr>
      <tr><td class="muted">Waived</td><td class="r num">${m.waived?K(m.waived):"–"}</td></tr>
      <tr><td class="muted">Not yet deposited</td><td class="r num" style="${m.outstanding?"color:var(--red);font-weight:700":""}">${m.outstanding?K(m.outstanding):"–"}</td></tr>
      ${P==="week"?`<tr><td class="muted">Deposits on time</td><td class="r num">${pct(m.ontime)}</td></tr>`:`<tr><td class="muted">Payments not recorded</td><td class="r num">${m.unrecorded||"–"}</td></tr>`}
    </tbody></table></div>
    ${A.branch==="ALL"?`<div class="panel-h"><span class="small">${syncLine(s.id)}</span><button class="btn small" data-act="pickBranch" data-id="${s.id}">Open ${esc(s.name)}</button></div>`:""}</section>`;
  return `<div class="head"><div><h1>Business overview</h1><p class="meta">${fmtDay(dayKey(Date.now()))} · ${per.map(p=>esc(p.s.name)).join(", ")}</p></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" data-act="refresh">Refresh</button><div class="seg" role="group" aria-label="Period"><button data-act="period" data-v="today" aria-pressed="${P==="today"}">Today</button><button data-act="period" data-v="week" aria-pressed="${P==="week"}">Last 7 days</button></div></div></div>
  ${alerts.length?`<section class="panel"><h2>Needs attention</h2><div class="alerts">${alerts.map(([c,m])=>`<div class="stripe ${c}">${m}</div>`).join("")}</div></section>`:""}
  <h2>By branch</h2><div class="grid3">${per.map(card).join("")}</div>
  <h2>Overall${ids.length>1?" · all branches":""}</h2>
  <div class="kpis">
    <div class="kpi"><div class="l">Total sales</div><div class="v">${K(tot.sales)}</div><div class="s">${label}</div></div>
    <div class="kpi"><div class="l">Check-ins</div><div class="v">${tot.checkins}</div><div class="s">${tot.nights} room-nights</div></div>
    <div class="kpi"><div class="l">Occupancy</div><div class="v">${pct(occ)}</div><div class="s">${rooms} rooms</div></div>
    <div class="kpi"><div class="l">Waived</div><div class="v">${K(tot.waived)}</div><div class="s">by directors</div></div>
    <div class="kpi"><div class="l">Not yet deposited</div><div class="v" style="color:${tot.outstanding?"var(--red)":"var(--green)"}">${K(tot.outstanding)}</div><div class="s">${tot.overdue?tot.overdue+" overdue":"Nothing overdue"}</div></div>
  </div>
  <div class="grid2"><section class="panel"><h2>Share of sales · ${label}</h2>
    <div style="display:grid;gap:.6rem">${[...per].sort((a,b)=>b.m.sales-a.m.sales).map(({s,j,m})=>{ const sh = tot.sales? m.sales/tot.sales:0; return `<div><div class="panel-h small"><b>${esc(s.name)}</b><span class="num">${K(m.sales)} · ${Math.round(sh*100)}%</span></div>
      <div style="height:10px;background:var(--surface-2);border:1px solid var(--line);border-radius:99px;overflow:hidden"><div style="height:100%;width:${(sh*100).toFixed(1)}%;background:var(--site${(j%3)+1})"></div></div></div>`; }).join("")}</div>
    <p class="small muted">Cash ${K(tot.cash)} · mobile money ${K(tot.mobile)}.</p></section>
  <section class="panel"><h2>Daily sales · last 7 days</h2>${chart(ids)}</section></div>`;
}

/* Admin */
function adminView(){
  const tabs=[["users","Users"],["branches","Branches & rates"],["sync","DS668 sync"],["lipila","Lipila"]];
  let body="";
  if (A.adminTab==="users") body = `<section class="panel"><h2>Staff accounts</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>
    ${A.D.profiles.map(p=>`<tr><td><b>${esc(p.full_name)}</b></td><td class="num">${esc(p.username)}</td><td>${ROLES[p.role]}</td><td>${p.branch_id?esc(site(p.branch_id).name):"All branches"}</td>
      <td>${!p.active?'<span class="pill neutral">Disabled</span>':p.must_change_password?'<span class="pill warn">Temporary password</span>':'<span class="pill ok">Active</span>'}</td>
      <td style="white-space:nowrap">${p.id===A.me.id?'<span class="small muted">You</span>':`<button class="btn small" data-act="resetPw" data-id="${p.id}">Reset password</button> <button class="btn small" data-act="toggleUser" data-id="${p.id}" data-v="${p.active?0:1}">${p.active?"Disable":"Enable"}</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Add a staff member</h3>
    <form id="addUser" class="inline"><label class="f">Full name<input id="nu-name" type="text" required></label>
      <label class="f">Username<input id="nu-user" type="text" placeholder="e.g. grace.mumbwa" autocapitalize="none" required></label>
      <label class="f">Role<select id="nu-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="f">Branch (reception only)<select id="nu-branch">${A.branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label>
      <label class="f">Temporary password<input id="nu-pw" type="text" minlength="8" autocomplete="off" required></label>
      <button class="btn primary" type="submit">Add user</button></form>
    <p class="small muted">Give the person their username and temporary password in person. They must change it the first time they sign in.</p></section>`;
  if (A.adminTab==="branches") body = `<section class="panel"><h2>Branches & room rates</h2><div class="tbl-wrap"><table><thead><tr><th>Branch</th><th class="r">Rooms</th><th class="r">Rate per night (K)</th><th>Reception number</th></tr></thead><tbody>
    ${A.branches.map(b=>`<tr><td><b>${esc(b.name)}</b></td><td class="r num">${b.room_count}</td><td class="r"><input type="number" id="rate-${b.id}" data-act="rate" data-id="${b.id}" value="${Number(b.rate)}" min="0" step="10" style="max-width:110px;text-align:right"></td>
      <td><input type="text" id="sim-${b.id}" data-act="sim" data-id="${b.id}" value="${esc(b.reception_number||"")}" placeholder="09xx xxx xxx" style="max-width:160px"></td></tr>`).join("")}
    </tbody></table></div><p class="small muted">A new rate applies to check-ins from now on. Rates are still the DS668 default of K199 until you set the real ones.</p></section>`;
  if (A.adminTab==="sync") body = `<section class="panel"><h2>DS668 sync</h2><div class="tbl-wrap"><table><thead><tr><th>Branch</th><th>Status</th><th>Latest DS668 guest</th></tr></thead><tbody>
    ${A.branches.map(b=>{ const s=A.D.sync.find(x=>x.branch_id===b.id); return `<tr><td><b>${esc(b.name)}</b></td><td class="small">${syncLine(b.id)}</td><td class="num">${s?("#"+s.last_ds_guest_id):"–"}</td></tr>`; }).join("")}
    </tbody></table></div><p class="small muted">The laptop helper is installed at Mumbwa. It is waiting for database access from the DS668 supplier. Until then, reception adds check-ins by hand.</p></section>`;
  if (A.adminTab==="lipila") body = `<section class="panel"><h2>Lipila</h2><p class="stripe warn">Not connected yet. Deposits are recorded in test mode with the mobile money reference. Live Lipila requests start once the lodge's Lipila business keys are added.</p></section>`;
  return `<div class="head"><div><h1>Settings</h1><p class="meta">Staff, branches, sync and payments</p></div>
  <div class="seg" role="group" aria-label="Settings section">${tabs.map(([k,l])=>`<button data-act="adminTab" data-v="${k}" aria-pressed="${A.adminTab===k}">${l}</button>`).join("")}</div></div>${body}`;
}

/* Modals */
function modalView(){
  const m = A.modal; if (!m) return "";
  const wrap = (inner, id) => `<div class="scrim"><form class="modal" id="${id}">${inner}${m.err?`<p class="err">${esc(m.err)}</p>`:""}</form></div>`;
  if (m.type==="manual") return wrap(`<h2>Add check-in · ${esc(site(A.branch).name)}</h2>
    <p class="muted small">Enter the stay after issuing the card in DS668. Rate ${K(site(A.branch).rate)} per night. Check-out is 10:00 on the last day.</p>
    <label class="f">Room number<input id="m-room" type="text" inputmode="numeric" required></label>
    <label class="f">Nights<input id="m-nights" type="number" min="1" max="60" value="1" required></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Add check-in</button></div>`, "manualForm");
  if (m.type==="waiver"){ const c = A.D.checkins.find(x=>x.id===m.id); return wrap(`<h2>Waiver for room ${esc(c.room)}</h2>
    <p class="muted small">Call a director first and record only what they approved. Normal price ${K(c.amount_due)}.</p>
    <label class="f">Approved by<select id="w-dir">${A.D.directors.map(d=>`<option value="${d.id}">${esc(d.full_name)}</option>`).join("")}</select></label>
    <label class="f">New price (K)<input id="w-to" type="number" min="0" step="10" required></label>
    <label class="f">Reason<input id="w-reason" type="text" required placeholder="e.g. returning guest"></label>
    ${A.D.directors.length?"":'<p class="err">No director accounts exist yet. Ask the system admin to add the directors.</p>'}
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit" ${A.D.directors.length?"":"disabled"}>Save waiver</button></div>`, "waiverForm"); }
  if (m.type==="testDeposit"){ const st = depositState(A.branch, m.k); return wrap(`<h2>Record deposit · ${fmtDay(m.k)}</h2>
    <p>Amount: <b>${K(st.t.total)}</b></p><p class="small muted">Test mode while Lipila is being connected. Enter the reference from the mobile money message after paying the company number.</p>
    <label class="f">Mobile money reference<input id="d-ref" type="text" required></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save deposit</button></div>`, "depositForm"); }
  if (m.type==="resetPw"){ const p = A.D.profiles.find(x=>x.id===m.id); return wrap(`<h2>Reset password · ${esc(p.full_name)}</h2>
    <label class="f">New temporary password (at least 8 characters)<input id="r-pw" type="text" minlength="8" autocomplete="off" required></label>
    <p class="small muted">They will be asked to choose their own password when they next sign in.</p>
    <div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Reset password</button></div>`, "resetForm"); }
  return "";
}

/* ---------- Events ---------- */
async function adminCall(body){
  const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error){ let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch(_){} throw new Error(msg); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
document.addEventListener("click", async e=>{
  const b = e.target.closest("[data-act]"); if (!b || b.tagName==="INPUT") return;
  const a = b.dataset.act, id = b.dataset.id;
  try {
    if (a==="logout"){ await sb.auth.signOut(); A.me=null; A.branch=null; A.loaded=false; A.err=""; render(); }
    if (a==="switchBranch"){ A.branch=null; A.loaded=false; render(); }
    if (a==="pickBranch"){ A.branch=id; A.tab=tabsFor()[0][0]; A.loaded=false; render(); await refresh(); }
    if (a==="tab"){ A.tab=b.dataset.tab; render(); }
    if (a==="period"){ A.period=b.dataset.v; render(); }
    if (a==="adminTab"){ A.adminTab=b.dataset.v; render(); }
    if (a==="refresh"){ await refresh(); toast("Updated"); }
    if (a==="close"){ A.modal=null; render(); }
    if (a==="manual"){ A.modal={type:"manual"}; render(); }
    if (a==="waiver"){ A.modal={type:"waiver", id}; render(); }
    if (a==="testDeposit"){ A.modal={type:"testDeposit", k:b.dataset.k}; render(); }
    if (a==="resetPw"){ A.modal={type:"resetPw", id}; render(); }
    if (a==="pay"){ const { error } = await sb.rpc("record_payment",{p_checkin:id, p_method:b.dataset.v}); if (error) throw error; await refresh(); }
    if (a==="wdecide"){ const { error } = await sb.rpc("decide_waiver",{p_waiver:id, p_decision:b.dataset.v}); if (error) throw error; await refresh(); toast(b.dataset.v==="confirmed"?"Waiver confirmed":"Waiver disputed. The manager and owner can see it."); }
    if (a==="closeDay"){ const { error } = await sb.rpc("prepare_deposit",{p_branch:A.branch, p_date:b.dataset.k}); if (error) throw error; await refresh(); toast(fmtDay(b.dataset.k)+" closed. Record the deposit reference after paying."); }
    if (a==="toggleUser"){ await adminCall({action:"set_active", id, active: b.dataset.v==="1"}); await refresh(); toast("Account updated"); }
  } catch(err){ fail(err); }
});
document.addEventListener("change", async e=>{
  const t = e.target; if (!t.dataset || !t.dataset.act) return;
  try {
    if (t.dataset.act==="rate"){ const v = Math.max(0, Number(t.value)||0); const { error } = await sb.from("branches").update({rate:v}).eq("id", t.dataset.id); if (error) throw error; await refresh(); toast(site(t.dataset.id).name+" rate set to "+K(v)); }
    if (t.dataset.act==="sim"){ const { error } = await sb.from("branches").update({reception_number:t.value.trim()||null}).eq("id", t.dataset.id); if (error) throw error; await refresh(); toast("Reception number saved"); }
  } catch(err){ fail(err); }
});
document.addEventListener("submit", async e=>{
  e.preventDefault(); const f = e.target.id;
  const setErr = msg => { if (A.modal){ A.modal.err = msg; } else { A.err = msg; } render(); };
  try {
    if (f==="loginForm"){
      const un = document.getElementById("username").value.trim().toLowerCase(), pw = document.getElementById("password").value;
      A.busy=true; A.err=""; render();
      const { error } = await sb.auth.signInWithPassword({ email: `${un}@${DOMAIN}`, password: pw });
      A.busy=false;
      if (error){ A.err = /invalid/i.test(error.message) ? "Wrong username or password." : /banned/i.test(error.message) ? "This account is disabled. Ask the system admin." : error.message; render(); return; }
      await loadMe(); render();
    }
    if (f==="pwForm"){
      const p1 = document.getElementById("pw1").value, p2 = document.getElementById("pw2").value;
      if (p1.length < 8) return setErr("Use at least 8 characters.");
      if (p1 !== p2) return setErr("The two passwords don't match.");
      const { error } = await sb.auth.updateUser({ password: p1 }); if (error) throw error;
      const r = await sb.rpc("password_changed"); if (r.error) throw r.error;
      A.me.must_change_password = false; A.err=""; render(); toast("Password saved");
    }
    if (f==="manualForm"){
      const { error } = await sb.rpc("add_manual_checkin",{p_branch:A.branch, p_room:document.getElementById("m-room").value, p_nights:Number(document.getElementById("m-nights").value)});
      if (error) return setErr(error.message);
      A.modal=null; await refresh(); toast("Check-in added");
    }
    if (f==="waiverForm"){
      const { error } = await sb.rpc("record_waiver",{p_checkin:A.modal.id, p_new_amount:Number(document.getElementById("w-to").value), p_director:document.getElementById("w-dir").value, p_reason:document.getElementById("w-reason").value});
      if (error) return setErr(error.message);
      A.modal=null; await refresh(); toast("Waiver saved");
    }
    if (f==="depositForm"){
      const { error } = await sb.rpc("record_test_deposit",{p_branch:A.branch, p_date:A.modal.k, p_reference:document.getElementById("d-ref").value});
      if (error) return setErr(error.message);
      A.modal=null; await refresh(); toast("Deposit recorded");
    }
    if (f==="resetForm"){
      try { await adminCall({action:"reset", id:A.modal.id, password:document.getElementById("r-pw").value}); } catch(err){ return setErr(err.message); }
      A.modal=null; await refresh(); toast("Password reset. Give them the temporary password in person.");
    }
    if (f==="addUser"){
      const role = document.getElementById("nu-role").value;
      await adminCall({action:"create", full_name:document.getElementById("nu-name").value, username:document.getElementById("nu-user").value,
        role, branch_id: role==="reception" ? document.getElementById("nu-branch").value : null, password:document.getElementById("nu-pw").value});
      await refresh(); toast("Staff member added");
    }
  } catch(err){ A.busy=false; fail(err); }
});

(async function boot(){
  render();
  try { await loadMe(); } catch(e){ A.err = e.message; }
  render();
})();
