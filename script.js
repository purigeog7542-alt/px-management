// --- ตั้งค่าการเชื่อมต่อ Supabase ---
const SUPABASE_URL = 'https://wtyvtjvzvgurybtcnnsf.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_JLPzS9fSB0-mJN9D3Vssiw_ibQEXq4d'; 
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let D = { products: [], customers: [], sales: [], payments: [], restocks: [] };
let tab = 'sell', cust = '', method = 'sign', cart = {}, q = '';
let salesChartInstance = null, profitChartInstance = null;
let unlockUntil = 0;

const hp = s => { let h = 5381; for (let c of ('mw' + s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); };
const gate = fn => {
  const pin = localStorage.getItem('mw_pin');
  if (!pin || Date.now() < unlockUntil) return fn();
  modal('<h2>🔒 ใส่รหัส PIN</h2><label>กรุณาใส่รหัส PIN เพื่อดำเนินการต่อ</label><input id="pin" type="password" maxlength="6" inputmode="numeric">', () => {
    const p = V('pin');
    if (hp(p) !== pin) throw {message: 'รหัส PIN ไม่ถูกต้อง'};
    unlockUntil = Date.now() + 5 * 60 * 1000;
    fn();
  });
  setTimeout(() => { const el = document.getElementById('pin'); if(el) el.focus(); }, 100);
};

const pad = (n, l=2) => String(n).padStart(l, '0');
const ds = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
const today = () => ds(new Date());

function toast(t) {
  const e = document.getElementById('toast');
  if (!e) return;
  e.textContent = t; e.style.display = 'block';
  setTimeout(() => e.style.display = 'none', 2600);
}
const F = n => (+n||0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// --- ฟังก์ชันช่วยเหลือ Export Excel (CSV UTF-8) ---
function exportToCSV(filename, rows) {
  let processRow = function (row) {
    return row.map(val => {
      if (val === null || val === undefined) return '';
      let escaped = String(val).replace(/"/g, '""');
      if (escaped.search(/("|,|\n)/g) >= 0) escaped = '"' + escaped + '"';
      return escaped;
    }).join(',');
  };
  let csv = '\uFEFF' + rows.map(processRow).join('\n');
  let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  let link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- โหลดข้อมูลจาก Supabase ---
async function loadDataFromSupabase() {
  try {
    const [pRes, mRes, sRes, iRes, payRes, rRes] = await Promise.all([
      sb.from('products').select('*'),
      sb.from('members').select('*'),
      sb.from('transactions').select('*'),
      sb.from('transaction_items').select('*'),
      sb.from('payments').select('*'),
      sb.from('restocks').select('*')
    ]);

    if (pRes.error) throw pRes.error;
    if (mRes.error) throw mRes.error;

    const transactions = (sRes.data || []).map(tx => ({
      ...tx,
      items: (iRes.data || []).filter(item => item.transaction_id === tx.id).map(item => ({
        pid: item.product_id,
        name: item.name,
        qty: item.qty,
        price: item.unit_price,
        cost: item.total_cost / item.qty
      }))
    }));

    D.products = pRes.data || [];
    D.customers = (mRes.data || []).map(m => ({ id: m.id, code: m.code, name: m.name, opening: m.opening, credit_limit: m.credit_limit }));
    D.sales = transactions;
    D.payments = payRes.data || [];
    D.restocks = rRes.data || [];

    render();
  } catch (err) {
    console.error('Error loading data:', err);
    toast('โหลดข้อมูลจาก Supabase ไม่สำเร็จ: ' + err.message);
  }
}

// --- เปิดใช้งาน Supabase Realtime ---
function initRealtime() {
  sb.channel('public-db')
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
      console.log('Realtime change received:', payload);
      loadDataFromSupabase();
    })
    .subscribe();
}

function calc() {
  const sold = {}, bal = {}, dynamicCost = {}, dynamicStock = {}, lastCost = {};
  
  D.sales.forEach(s => (s.items || []).forEach(i => sold[i.pid] = (sold[i.pid] || 0) + i.qty));
  
  D.customers.forEach(c => bal[c.id] = +c.opening || 0);
  D.sales.forEach(s => { if (s.method === 'sign' && s.cust in bal) bal[s.cust] += s.total; });
  D.payments.forEach(y => { if (y.cust in bal) bal[y.cust] -= y.amount; });

  D.products.forEach(p => {
    const productRestocks = D.restocks.filter(r => r.pid === p.id).sort((a,b) => b.ts - a.ts);
    
    let baseCost = 0;
    if (productRestocks.length > 0) {
      const latest = productRestocks[0];
      baseCost = latest.units > 0 ? (latest.cost / latest.units) : 0;
    } else if (Number(p.buy_qty) > 0) {
      baseCost = Number(p.buy_cost) / Number(p.buy_qty);
    } else {
      baseCost = Number(p.buy_cost) || 0; 
    }

    if (baseCost >= Number(p.price) && Number(p.price) > 0) {
      baseCost = Number(p.price) * 0.7; 
    }

    lastCost[p.id] = baseCost;

    let totalQty = Number(p.buy_qty) || 0;
    let totalCost = Number(p.buy_cost) || 0;
    productRestocks.forEach(r => {
      totalQty += Number(r.units) || 0;
      totalCost += Number(r.cost) || 0;
    });

    dynamicStock[p.id] = totalQty - (Number(p.hist) || 0) - (sold[p.id] || 0);
    
    let calcC = baseCost;
    if (dynamicStock[p.id] > 0 && totalQty > 0) {
      calcC = totalCost / totalQty;
    }
    
    if (calcC >= Number(p.price) && Number(p.price) > 0) {
      calcC = Number(p.price) * 0.7;
    }

    dynamicCost[p.id] = calcC > 0 ? calcC : (Number(p.price) ? Number(p.price) * 0.7 : 10);
  });

  const stock = p => dynamicStock[p.id] ?? (Number(p.buy_qty) - (Number(p.hist) || 0) - (sold[p.id] || 0));
  const cost = p => {
    let c = dynamicCost[p.id] ?? lastCost[p.id] ?? 0;
    if (c >= Number(p.price) && Number(p.price) > 0) c = Number(p.price) * 0.7;
    return c > 0 ? c : (Number(p.price) ? Number(p.price) * 0.7 : 10);
  };
  
  return { sold, bal, stock, cost };
}

const P = id => D.products.find(p => p.id === id);
const C = id => D.customers.find(c => c.id === id);
const nextCode = (arr, pre, w) => pre + pad(Math.max(0, ...arr.map(x => parseInt((x.code||'').slice(pre.length))||0)) + 1, w);
const stat = (p, k) => { const s = k.stock(p); return s <= 0 ? ['หมด', 'r'] : s <= p.reorder ? ['ด่วน', 'r'] : s <= p.reorder * 1.5 ? ['เตือน', 'y'] : ['ปกติ', 'g']; };

function goTab(k) { tab = k; render(); }
function srch(val) { q = val; }

function render() {
  const navEl = document.getElementById('nav');
  if (navEl) {
    let navHtml = '';
    [['sell','🛒','ขายสินค้า'],['stock','📦','คลังสินค้า'],['cus','👥','สมาชิก ('+D.customers.length+')'],['rep','📊','รายงาน']].forEach(([k,i,t]) => {
      navHtml += '<button class="'+(tab===k?'a':'')+'" onclick="goTab(\''+k+'\')">'+i+'<br>'+t+'</button>';
    });
    navEl.innerHTML = navHtml;
  }
  
  const k = calc();
  let content = '';
  if (tab === 'sell') content = vSell(k);
  else if (tab === 'stock') content = vStock(k);
  else if (tab === 'cus') content = vCus(k);
  else if (tab === 'rep') content = vRep();
  
  const appEl = document.getElementById('app');
  if (appEl) appEl.innerHTML = content;
  if (tab === 'rep') initCharts();
}

function vSell(k) {
  const ps = D.products.slice().sort((a,b)=>a.code>b.code?1:-1).filter(p=>!q||(p.name+p.code).toLowerCase().includes(q.toLowerCase()));
  const items = Object.keys(cart).filter(i=>cart[i]>0), tot = items.reduce((s,i)=>s+cart[i]*P(i).price,0);
  
  let signHtml = '';
  if (method === 'sign') {
    let opts = '<option value="">— เลือกสมาชิก —</option>';
    D.customers.slice().sort((a,b)=>a.name.localeCompare(b.name,'th')).forEach(c => {
      opts += '<option value="'+c.id+'" '+(cust===c.id?'selected':'')+'>'+c.name+' ('+c.code+')</option>';
    });
    let curBal = '';
    if (cust) {
      const cObj = C(cust), curB = k.bal[cust], limit = cObj.credit_limit || 1000;
      const isOver = (curB + tot) > limit;
      curBal = '<div class="mu" style="margin-top:6px">ยอดค้างปัจจุบัน: <b>'+F(curB)+' ฿</b> · วงเงินเครดิต: <b>'+F(limit)+' ฿</b>' +
        (isOver ? '<div class="neg" style="margin-top:4px"><b>⚠️ ยอดรวมจะเกินวงเงินเครดิตที่กำหนด — ไม่อนุญาตให้เซ็นจ่าย</b></div>' : '') + '</div>';
    }
    signHtml = '<label>เลือกสมาชิก ('+D.customers.length+' ท่าน)</label><select onchange="cust=this.value;render()">'+opts+'</select>'+curBal;
  }

  let gridHtml = '';
  if (ps.length === 0) {
    gridHtml = '<div class="mu">ยังไม่มีสินค้า — เพิ่มที่แท็บคลังสินค้า</div>';
  } else {
    gridHtml = '<div class="grid">';
    ps.forEach(p => {
      const s = k.stock(p), n = cart[p.id] || 0;
      let badge = n ? '<div style="margin-top:6px" class="tag g">เลือก '+n+'</div>' : '';
      gridHtml += '<button class="prod '+(n?'on':'')+' '+(s<=0?'off':'')+'" onclick="add(\''+p.id+'\',1)"><div class="icon">'+(p.icon||'🥤')+'</div><div><b>'+p.name+'</b><span class="pr">'+F(p.price)+' ฿</span><div class="mu" style="margin-top:4px">เหลือ '+s+' '+p.unit+'</div></div>'+badge+'</button>';
    });
    gridHtml += '</div>';
  }

  let cartHtml = '';
  if (items.length > 0) {
    let itemsList = '';
    items.forEach(i => {
      itemsList += '<div class="row sp" style="margin:8px 0"><div style="flex:2">'+P(i).name+'<div class="mu">'+F(P(i).price)+' ฿ × '+cart[i]+'</div></div><div class="row" style="flex:1"><button class="btn s sm" onclick="add(\''+i+'\',-1)">−</button><b style="text-align:center">'+cart[i]+'</b><button class="btn s sm" onclick="add(\''+i+'\',1)">+</button></div></div>';
    });
    let disableBtn = '';
    if (method === 'sign' && cust) {
      const cObj = C(cust), curB = k.bal[cust], limit = cObj.credit_limit || 1000;
      if ((curB + tot) > limit) disableBtn = ' disabled style="opacity:0.5;cursor:not-allowed"';
    }
    cartHtml = '<div class="card" style="margin-top:14px"><h2 style="margin-top:0">ตะกร้าสินค้า</h2>'+itemsList+'<div class="row sp" style="margin:12px 0;border-top:1px solid var(--bd);padding-top:8px"><b>ยอดรวมทั้งสิ้น</b><b style="font-size:22px;color:var(--pr)">'+F(tot)+' ฿</b></div><button class="btn w"'+disableBtn+' onclick="checkout()">ยืนยันการขาย'+(method==='sign'?' (บันทึกยอดเซ็น)':'')+'</button><button class="btn s w" style="margin-top:6px" onclick="cart={};render()">ล้างตะกร้า</button></div>';
  }

  return '<div class="card"><div class="seg"><button class="'+(method==='sign'?'a':'')+'" onclick="method=\'sign\';render()">✍️ เซ็นจ่าย (สมาชิก)</button><button class="'+(method==='cash'?'a':'')+'" onclick="method=\'cash\';render()">💵 เงินสด</button></div>'+signHtml+'</div><input placeholder="🔍 ค้นหาสินค้า / รหัส" id="sq" value="'+esc(q)+'" oninput="srch(this.value)" style="margin-bottom:12px">'+gridHtml+cartHtml;
}

function add(id, d) {
  const k = calc(), p = P(id), n = (cart[id] || 0) + d;
  if (n > k.stock(p) && d > 0) return toast('สินค้าในสต็อกไม่พอ');
  cart[id] = Math.max(0, n);
  render();
}

async function checkout() {
  const k = calc(), items = Object.keys(cart).filter(i=>cart[i]>0).map(i=>{const p=P(i);return{pid:i,name:p.name,qty:cart[i],price:p.price,cost:+k.cost(p).toFixed(4)}});
  if (!items.length) return; if (method === 'sign' && !cust) return toast('กรุณาเลือกสมาชิกก่อน');
  const tt = items.reduce((s,i)=>s+i.qty*i.price,0);
  if (method === 'sign') {
    const cObj = C(cust), limit = cObj.credit_limit || 1000;
    if ((k.bal[cust] + tt) > limit) return toast('วงเงินเครดิตไม่เพียงพอ ไม่สามารถเซ็นจ่ายได้');
  }
  const d = today(), pre = 'B' + d.slice(2).replace(/-/g,'') + '-'; let n = D.sales.filter(s=>s.date===d).length + 1, bill;
  for(;;){bill=pre+pad(n,3);if(!D.sales.find(s=>s.id===bill))break;n++;}

  const txData = {
    id: bill,
    bill: bill,
    date: d,
    ts: Date.now(),
    method: method,
    cust: method === 'sign' ? cust : null,
    cust_name: method === 'sign' ? C(cust).name : 'เงินสด',
    total: tt,
    cost: items.reduce((s,i)=>s+i.qty*i.cost,0)
  };

  try {
    const { error: txErr } = await sb.from('transactions').insert([txData]);
    if (txErr) throw txErr;

    const itemRows = items.map(i => ({
      transaction_id: bill,
      product_id: i.pid,
      name: i.name,
      qty: i.qty,
      unit_price: i.price,
      total_cost: i.qty * i.cost
    }));

    const { error: itmErr } = await sb.from('transaction_items').insert(itemRows);
    if (itmErr) throw itmErr;

    cart = {}; toast('บันทึกการขายสำเร็จ: '+bill);
    loadDataFromSupabase();
  } catch (err) {
    toast('บันทึกการขายไม่สำเร็จ: ' + err.message);
  }
}

// --- หน้าแสดงผลคลังสินค้า (vStock) ---
function vStock() {
  const k = calc();
  const rows = D.products.slice().sort((a,b)=>a.code>b.code?1:-1).map(p => {
    const s = stat(p, k), c = k.cost(p);
    return '<tr><td><b>' + esc(p.name) + '</b><br><span class="mu">' + p.code + '</span></td>' +
      '<td><b>' + k.stock(p) + '</b> ' + p.unit + '</td>' +
      '<td>' + F(p.price) + ' ฿</td>' +
      '<td>' + F(c) + ' ฿</td>' +
      '<td><b style="color:var(--pr)">' + F(p.price - c) + ' ฿</b> <span class="mu">(' + ((p.price - c) / p.price * 100).toFixed(1) + '%)</span></td>' +
      '<td><span class="badge ' + (s[1] === 'ok' ? 'ok' : 'er') + '">' + s[0] + '</span></td>' +
      '<td><div class="row" style="gap:4px">' +
        '<button class="btn s sm" onclick="adjustStockManual(\'' + p.id + '\')">ปรับสต็อก</button>' +
        '<button class="btn s sm" onclick="gate(()=>fRestock(\'' + p.id + '\'))">รับของ</button>' +
        '<button class="btn sm" onclick="gate(()=>fProd(\'' + p.id + '\'))">แก้</button>' +
      '</div></td></tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center" class="mu">ยังไม่มีสินค้าในระบบ</td></tr>';

  return '<div class="row sp" style="margin-bottom:12px">' +
    '<h2>📦 คลังสินค้า</h2>' +
    '<div class="row" style="flex:none;gap:6px">' +
      '<button class="btn sm s" onclick="exportStockExcel()">📥 Excel</button>' +
      '<button class="btn sm" onclick="window.print()">🖨 พิมพ์ PDF / รายงาน</button>' +
      '<button class="btn sm p" onclick="gate(()=>fProd())">+ เพิ่มสินค้า</button>' +
    '</div></div>' +
    '<div class="card tbl"><table><tr><th>สินค้า</th><th>คงเหลือ</th><th>ราคาขาย</th><th>ทุน/หน่วย</th><th>กำไร/หน่วย</th><th>สถานะ</th><th>จัดการ</th></tr>' + rows + '</table></div>';
}

function exportStockExcel() {
  const k = calc();
  let rows = [['รหัสสินค้า', 'ชื่อสินค้า', 'คงเหลือ', 'หน่วย', 'ราคาขาย (บาท)', 'ทุน/หน่วย (บาท)', 'กำไร/หน่วย (บาท)', 'สถานะ']];
  D.products.slice().sort((a,b)=>a.code>b.code?1:-1).forEach(p => {
    const s = stat(p, k), c = k.cost(p);
    rows.push([p.code, p.name, k.stock(p), p.unit, p.price, c.toFixed(2), (p.price - c).toFixed(2), s[0]]);
  });
  exportToCSV('stock_report_' + today() + '.csv', rows);
  toast('ดาวน์โหลดรายงานคลังสินค้า (Excel) แล้ว');
}

function modal(h, save) {
  const mb = document.getElementById('mb');
  const mo = document.getElementById('mo');
  if (!mb || !mo) return;
  mb.innerHTML = h + '<div class="row" style="margin-top:14px"><button class="btn s" onclick="closeM()">ปิด</button>'+(save?'<button class="btn" id="sv">บันทึก</button>':'')+'</div>';
  mo.style.display = 'flex';
  if (save) document.getElementById('sv').onclick = async () => { try { await save(); closeM(); } catch(e) { toast('ไม่สำเร็จ: '+e.message); } };
}

const closeM = () => {
  const mo = document.getElementById('mo');
  if (mo) mo.style.display = 'none';
};
const V = id => document.getElementById(id) ? document.getElementById(id).value : '';

function pv(fromMk) {
  const g = id => document.getElementById(id), n = id => g(id) ? (+g(id).value || 0) : 0;
  const c = g('cs') ? n('cs') : (n('pe') > 0 ? n('pc') / n('pe') : 0);
  if (fromMk && n('mk') > 0 && c > 0 && g('pr')) g('pr').value = Math.ceil(c * (1 + n('mk') / 100));
  const box = g('pvb'); if (!box) return;
  const pr = n('pr'), pf = pr - c, cl = pf < 0 ? 'neg' : '';
  let h = '<div class="row sp"><span>ต้นทุน/หน่วย</span><b>' + F(c) + ' ฿</b></div>' +
    '<div class="row sp"><span>กำไร/หน่วย</span><b class="' + cl + '">' + F(pf) + ' ฿</b></div>' +
    '<div class="row sp"><span>กำไรเทียบต้นทุน (markup)</span><b class="' + cl + '">' + (c > 0 ? F(pf / c * 100) : '-') + ' %</b></div>' +
    '<div class="row sp"><span>กำไรเทียบราคาขาย (margin)</span><b class="' + cl + '">' + (pr > 0 ? F(pf / pr * 100) : '-') + ' %</b></div>';
  if (g('pe') && n('pe') > 0) h += '<div class="row sp"><span>กำไรต่อ 1 แพ็ค (' + n('pe') + ' ชิ้น)</span><b class="' + cl + '">' + F(pf * n('pe')) + ' ฿</b></div>';
  if (pr > 0 && pf < 0) h += '<div class="neg" style="margin-top:6px"><b>⚠️ ราคาขายต่ำกว่าต้นทุน — ขาดทุน</b></div>';
  box.innerHTML = h;
}

function fProd(id) {
  const p = id ? P(id) : null, k = calc();
  const currentIcon = p ? (p.icon || '🥤') : '🥤';
  const emojis = ['🥤', '☕', '🍵', '🥛', '🧃', '🍫', '🍜', '🥔', '🍺', '🍞', '🍪', '🍬', '🧊', '🥫', '🍉', '🍎', '🥚', '🍚', '⚡', '🍭', '🍿'];
  let emojiOptions = '';
  emojis.forEach(em => { emojiOptions += '<option value="'+em+'" '+(currentIcon===em?'selected':'')+'>'+em+' (ไอคอน)</option>'; });
  const oi = ' oninput="pv()"';
  const costFields = p
    ? '<label>ต้นทุนเฉลี่ย / หน่วย (บาท)</label><input id="cs" type="number" inputmode="decimal" step="any" value="'+(+k.cost(p).toFixed(2))+'"'+oi+'>'
    : '<div class="row"><div><label>หน่วยขาย</label><input id="u" value="หน่วย"></div><div><label>ชื่อแพ็ค</label><input id="pn" value="แพ็ค"></div></div>' +
      '<div class="row"><div><label>ชิ้นต่อแพ็ค</label><input id="pe" type="number" value="1"'+oi+'></div><div><label>จำนวนแพ็คที่ซื้อ</label><input id="pk" type="number" value="1"></div></div>' +
      '<label>ต้นทุนต่อแพ็ค (บาท)</label><input id="pc" type="number" inputmode="decimal" step="any"'+oi+'>';

  modal('<h2>'+(p?'แก้ไขสินค้า':'เพิ่มสินค้าใหม่')+'</h2><label>ชื่อสินค้า</label><input id="n" value="'+esc(p?p.name:'')+'">' +
    '<label>ไอคอน / Emoji</label><select id="ic" style="font-size:20px;padding:6px">'+emojiOptions+'</select>' + costFields + (p ? '<div class="row"><div><label>หน่วยขาย</label><input id="u" value="'+esc(p.unit)+'"></div><div><label>ชื่อแพ็ค</label><input id="pn" value="'+esc(p.pack_name||'แพ็ค')+'"></div><div><label>ชิ้นต่อแพ็ค</label><input id="pe" type="number" value="'+(p.per||1)+'" oninput="pv()"></div></div>' : '') +
    '<label>ราคาขาย / หน่วย (บาท)</label><input id="pr" type="number" inputmode="decimal" step="any" value="'+(p?p.price:'')+'"'+oi+'>' +
    '<label>หรือตั้งราคาจากกำไรที่ต้องการ (% เทียบต้นทุน, ปัดขึ้นเป็นบาทเต็ม)</label><input id="mk" type="number" placeholder="เช่น 30" oninput="pv(true)">' +
    '<div class="pv" id="pvb"></div>' +
    '<label>จุดเตือนสั่งซื้อ</label><input id="ro" type="number" value="'+(p?p.reorder:5)+'">' + (p ? '<button class="btn s w" style="margin-top:14px;color:var(--er);border-color:var(--er)" onclick="gate(()=>delProd(\''+id+'\'))">🗑 ลบสินค้า</button>': ''),
  async () => {
    const n = V('n').trim(); if(!n) throw{message:'กรอกชื่อสินค้า'};
    const price = +V('pr') || 0; if(!(price>0)) throw{message:'กรอกราคาขาย'};
    const costPerUnit = p ? (+V('cs') || k.cost(p)) : ((+V('pc') || 0) / (+V('pe') || 1));
    if (costPerUnit <= 0) throw {message: 'ไม่อนุญาตให้ต้นทุนเป็น 0 บาท'};

    if(p) {
      const updateData = {
        name: n,
        icon: V('ic') || '🥤',
        price: price,
        reorder: +V('ro') || 5,
        unit: V('u').trim() || p.unit,
        pack_name: V('pn').trim() || p.pack_name,
        per: +V('pe') || p.per || 1
      };
      if(V('cs') !== '') updateData.buy_cost = +V('cs') * p.buy_qty;

      const { error } = await sb.from('products').update(updateData).eq('id', p.id);
      if (error) throw error;
    } else {
      const per = +V('pe')||1, pk = +V('pk')||0, pc = +V('pc')||0;
      if (pc <= 0) throw {message: 'ไม่อนุญาตให้ต้นทุนเป็น 0 บาท'};
      const code = nextCode(D.products,'P',3);
      const newProd = {
        id: code,
        code: code,
        name: n,
        icon: V('ic') || '🥤',
        price: price,
        reorder: +V('ro') || 5,
        unit: V('u').trim() || 'หน่วย',
        pack_name: V('pn').trim() || 'แพ็ค',
        per: per,
        buy_qty: per * pk,
        buy_cost: pk * pc,
        hist: 0
      };
      const { error } = await sb.from('products').insert([newProd]);
      if (error) throw error;
    }
    loadDataFromSupabase();
  });
  pv();
}

async function delProd(id) {
  if (D.sales.some(s => (s.items || []).some(i => i.pid === id))) return toast('ลบไม่ได้ มีประวัติการขายสินค้านี้แล้ว');
  if (!confirm('ยืนยันลบสินค้านี้ออกจากระบบ?')) return;
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) return toast('ลบไม่สำเร็จ: ' + error.message);
  closeM(); loadDataFromSupabase(); toast('ลบสินค้าแล้ว');
}

async function adjustStockManual(pid) {
  const p = D.products.find(x => x.id === pid);
  if (!p) return;
  const k = calc();
  const currentStock = k.stock(p);

  const newStockStr = prompt(`ปรับแก้สต็อกสินค้า: [${p.code}] ${p.name}\nจำนวนคงเหลือปัจจุบัน: ${currentStock} ${p.unit}\n\nกรุณากรอกจำนวนสต็อกคงเหลือที่ถูกต้อง:`, currentStock);
  if (newStockStr === null) return;

  const newStock = parseInt(newStockStr);
  if (isNaN(newStock)) {
    alert('กรุณากรอกเป็นตัวเลขเท่านั้น');
    return;
  }

  const diff = newStock - currentStock;
  if (diff === 0) {
    toast('ยอดสต็อกตรงกันอยู่แล้ว ไม่มีการเปลี่ยนแปลง');
    return;
  }

  const soldQty = k.sold[pid] || 0;
  const histQty = p.hist || 0;
  const newBuyQty = newStock + soldQty + histQty;

  try {
    const { error } = await sb.from('products').update({ buy_qty: newBuyQty }).eq('id', pid);
    if (error) throw error;

    toast(`ปรับสต็อกสินค้า ${p.name} เป็น ${newStock} ${p.unit} เรียบร้อยแล้ว`);
    loadDataFromSupabase();
  } catch (err) {
    toast('ปรับสต็อกไม่สำเร็จ: ' + err.message);
  }
}

function fRestock(id) {
  const p = P(id), k = calc(), pn = esc(p.pack_name || 'แพ็ค');
  const hh = D.restocks.filter(r => r.pid === id).sort((a, b) => b.ts - a.ts).slice(0, 8).map(r =>
    '<div class="row sp mu" style="margin:4px 0"><span>' + new Date(r.ts).toLocaleDateString('th-TH') + ' · ' + r.packs + ' ' + pn + ' (' + r.units + ' ' + esc(p.unit) + ') · ' + F(r.cost) + ' ฿</span><span style="flex:none"><button class="btn s sm" onclick="gate(()=>delRs(\'' + r.id + '\'))">ลบ</button></span></div>').join('')
    || '<div class="mu">ยังไม่มีประวัติรับของ</div>';
  modal('<h2>รับสินค้าเข้า: ' + esc(p.name) + '</h2><div class="mu">คงเหลือ ' + k.stock(p) + ' ' + esc(p.unit) + ' · ต้นทุนเฉลี่ย ' + F(k.cost(p)) + ' ฿/หน่วย</div>' +
    '<label>จำนวน' + pn + 'ที่รับ</label><input id="pk" type="number" inputmode="decimal"><label>ต้นทุนรวมต่อ' + pn + ' (บาท)</label><input id="pc" type="number" inputmode="decimal" step="any">' +
    '<h2 style="margin-top:14px">ประวัติการรับของ</h2>' + hh,
  async () => {
    const pk = +V('pk'); if (!(pk > 0)) throw {message: 'กรอกจำนวน'};
    const pc = +V('pc') || 0; if (!(pc > 0)) throw {message: 'ไม่อนุญาตให้ต้นทุนเป็น 0 บาท'};
    const per = p.per || 1;
    const newRestock = {
      id: 'R' + Date.now(),
      pid: id,
      ts: Date.now(),
      date: today(),
      packs: pk,
      per: per,
      units: pk * per,
      cost: pk * pc
    };
    const { error: rErr } = await sb.from('restocks').insert([newRestock]);
    if (rErr) throw rErr;

    const { error: pErr } = await sb.from('products').update({
      buy_qty: p.buy_qty + (pk * per),
      buy_cost: p.buy_cost + (pk * pc)
    }).eq('id', id);
    if (pErr) throw pErr;

    loadDataFromSupabase();
  });
}

async function delRs(rid) {
  const r = D.restocks.find(x => x.id === rid), p = r && P(r.pid); if (!p) return;
  if (calc().stock(p) - r.units < 0) return toast('ลบไม่ได้ สต็อกจะติดลบ (มีการขายไปแล้ว)');
  if (!confirm('ลบรายการรับของนี้? สต็อกและต้นทุนจะถูกปรับกลับ')) return;
  
  await sb.from('restocks').delete().eq('id', rid);
  await sb.from('products').update({
    buy_qty: p.buy_qty - r.units,
    buy_cost: p.buy_cost - r.cost
  }).eq('id', p.id);

  loadDataFromSupabase();
  toast('ลบรายการรับของแล้ว');
  closeM();
}

async function cancelBill(sid) {
  if (!confirm('ยืนยันยกเลิกบิลขายนี้? สินค้าจะถูกคืนเข้าสต็อก และยอดค้างของสมาชิกจะถูกปรับลดลง')) return;
  const { error } = await sb.from('transactions').delete().eq('id', sid);
  if (error) return toast('ยกเลิกไม่สำเร็จ: ' + error.message);
  loadDataFromSupabase();
  toast('ยกเลิกบิลเรียบร้อยแล้ว');
}

// --- หน้าสมาชิก (vCus) ---
function vCus(k) {
  const tot = Object.values(k.bal).reduce((a,b)=>a+b,0), pd = D.payments.filter(y=>y.status==='pending');
  let pendingHtml = '';
  if (pd.length > 0) {
    let pItems = '';
    pd.forEach(y => {
      pItems += '<div class="row sp" style="margin-top:6px"><span>'+((C(y.cust)||{}).name||'สมาชิก')+' · '+F(y.amount)+'</span><button class="btn s sm" onclick="gate(()=>confirmPay(\''+y.id+'\'))">ยืนยัน</button></div>';
    });
    pendingHtml = '<div class="card"><b>โอนเงินรอตรวจสอบ '+F(pd.reduce((s,y)=>s+y.amount,0))+' ฿</b>'+pItems+'</div>';
  }
  let rows = '';
  D.customers.slice().sort((a,b)=>a.code.localeCompare(b.code)).forEach(c => {
    const curB = k.bal[c.id], lim = c.credit_limit || 1000;
    rows += '<tr><td>'+c.code+'</td><td><b>'+c.name+'</b></td><td><b class="'+(curB>0?'neg':'')+'">'+F(curB)+'</b> <span class="mu">/ '+F(lim)+'</span></td><td><button class="btn s sm" onclick="gate(()=>fEditCus(\''+c.id+'\'))">แก้ไข</button> <button class="btn s sm" onclick="gate(()=>fPay(\''+c.id+'\'))">ชำระเงิน/ประวัติ</button></td></tr>';
  });
  return '<div class="row sp"><h2>👥 รายชื่อสมาชิก '+D.customers.length+' ท่าน · ค้างรวม '+F(tot)+' ฿</h2><div class="row" style="flex:none;gap:6px"><button class="btn sm s" onclick="exportCusExcel()">📥 Excel</button><button class="btn sm s" onclick="window.print()">🖨 PDF</button><button class="btn sm" onclick="gate(()=>fAddCus())">+ เพิ่มสมาชิก</button></div></div>'+pendingHtml+'<div class="card tbl"><table><tr><th>รหัส</th><th>ชื่อสมาชิก</th><th>ยอดค้าง / วงเงิน</th><th>จัดการ</th></tr>'+rows+'</table></div>';
}

function exportCusExcel() {
  const k = calc();
  let rows = [['รหัสสมาชิก', 'ชื่อ-นามสกุล', 'ยอดค้างปัจจุบัน (บาท)', 'วงเงินเครดิตสูงสุด (บาท)']];
  D.customers.slice().sort((a,b)=>a.code.localeCompare(b.code)).forEach(c => {
    rows.push([c.code, c.name, k.bal[c.id], c.credit_limit || 1000]);
  });
  exportToCSV('members_report_' + today() + '.csv', rows);
  toast('ดาวน์โหลดรายงานสมาชิก (Excel) แล้ว');
}

function fAddCus() {
  modal('<h2>เพิ่มสมาชิกใหม่</h2><label>ชื่อ-นามสกุลสมาชิก</label><input id="cn"><label>ยอดค้างยกมาเริ่มต้น (บาท)</label><input id="op" type="number" inputmode="decimal" value="0"><label>วงเงินเครดิตสูงสุด (บาท)</label><input id="cl" type="number" inputmode="decimal" value="1000">',
  async () => {
    const name = V('cn').trim(); if(!name) throw{message:'กรอกชื่อสมาชิก'};
    const code = nextCode(D.customers, 'C', 2);
    const newMem = { id: code, code: code, name: name, opening: +V('op') || 0, credit_limit: +V('cl') || 1000 };
    const { error } = await sb.from('members').insert([newMem]);
    if (error) throw error;
    loadDataFromSupabase();
  });
}

function fEditCus(id) {
  const c = C(id), k = calc();
  modal('<h2>แก้ไขข้อมูล: '+c.name+' ('+c.code+')</h2><label>ชื่อสมาชิก</label><input id="cn" value="'+esc(c.name)+'"><label>ตั้งค่ายอดค้างยกมา (บาท)</label><input id="op" type="number" inputmode="decimal" value="'+c.opening+'"><label>วงเงินเครดิตสูงสุด (บาท)</label><input id="cl" type="number" inputmode="decimal" value="'+(c.credit_limit||1000)+'"><button class="btn s w" style="margin-top:14px;color:var(--er);border-color:var(--er)" onclick="gate(()=>delCus(\''+id+'\'))">🗑 ลบสมาชิก</button>',
  async () => {
    const name = V('cn').trim(); if(!name) throw{message:'กรอกชื่อสมาชิก'};
    const { error } = await sb.from('members').update({
      name: name,
      opening: +V('op') || 0,
      credit_limit: +V('cl') || 1000
    }).eq('id', id);
    if (error) throw error;
    loadDataFromSupabase();
  });
}

async function delCus(id) {
  if (D.sales.some(s => s.cust === id)) return toast('ลบไม่ได้ มีประวัติการซื้อของสมาชิกนี้แล้ว');
  if (!confirm('ยืนยันลบสมาชิกนี้?')) return;
  const { error } = await sb.from('members').delete().eq('id', id);
  if (error) return toast('ลบไม่สำเร็จ: ' + error.message);
  closeM(); loadDataFromSupabase(); toast('ลบสมาชิกแล้ว');
}

async function confirmPay(payId) {
  const { error } = await sb.from('payments').update({ status: 'ok' }).eq('id', payId);
  if (error) return toast('ยืนยันไม่สำเร็จ: ' + error.message);
  loadDataFromSupabase();
  toast('ยืนยันการชำระเงินแล้ว');
}

function fPay(id) {
  const c = C(id), k = calc();
  const hist = [...D.sales.filter(s=>s.cust===id&&s.method==='sign').map(s=>({tbl:'sales',id:s.id,ts:s.ts,t:'ซื้อ '+s.bill,v:s.total})), ...D.payments.filter((y)=>y.cust===id).map((y)=>({tbl:'payments',id:y.id,ts:y.ts,t:'ชำระเงิน ('+(y.status==='pending'?'รอตรวจ':'อนุมัติแล้ว')+')',v:-y.amount}))].sort((a,b)=>b.ts-a.ts).slice(0,10);
  let histHtml = '';
  hist.forEach(h => {
    histHtml += '<div class="row sp mu" style="margin:4px 0"><span>'+new Date(h.ts).toLocaleDateString('th-TH')+' '+h.t+'</span><b>'+F(h.v)+'</b><button class="btn s sm" onclick="gate(()=>delPayOrTx(\''+h.tbl+'\',\''+h.id+'\'))">ลบ</button></div>';
  });
  if (!histHtml) histHtml = '<div class="mu">ยังไม่มีประวัติ</div>';

  modal('<h2>'+c.name+' ('+c.code+')</h2><div class="kp"><div>ยอดค้าง<b class="'+(k.bal[id]>0?'neg':'')+'">'+F(k.bal[id])+' ฿</b></div></div><label>รับชำระเงิน (บาท)</label><input id="am" type="number" inputmode="decimal"><label>ช่องทาง</label><select id="me"><option value="cash">เงินสด</option><option value="transfer">โอนเงิน</option></select><label>ใบแจ้งยอดหนี้รายเดือน (Statement)</label><div class="row"><input id="sm" type="month" value="'+today().slice(0,7)+'"><button class="btn s" onclick="stmt(\''+id+'\')">🖨 พิมพ์ใบแจ้งหนี้</button></div><h2 style="margin-top:14px">ประวัติล่าสุด</h2>'+histHtml,
  async () => {
    const a = +V('am'); if(!(a>0)) throw{message:'กรอกจำนวนเงิน'};
    const methodVal = V('me');
    const newPay = {
      cust: id,
      amount: a,
      method: methodVal,
      status: methodVal === 'transfer' ? 'pending' : 'ok',
      date: today(),
      ts: Date.now()
    };
    const { error } = await sb.from('payments').insert([newPay]);
    if (error) throw error;
    loadDataFromSupabase();
  });
}

// --- ฟังก์ชันลบประวัติการชำระเงินหรือรายการบิล ---
async function delPayOrTx(tbl, id) {
  if (!confirm('ยืนยันลบรายการนี้?')) return;
  if (tbl === 'sales') {
    const { error } = await sb.from('transactions').delete().eq('id', id);
    if (error) return toast('ลบไม่สำเร็จ: ' + error.message);
  } else {
    const { error } = await sb.from('payments').delete().eq('id', id);
    if (error) return toast('ลบไม่สำเร็จ: ' + error.message);
  }
  loadDataFromSupabase();
  toast('ลบรายการเรียบร้อยแล้ว');
  closeM();
}

// --- ฟังก์ชันพิมพ์ใบแจ้งหนี้ Statement รายเดือน ---
function stmt(id) {
  const c = C(id), k = calc();
  const m = V('sm');
  const txs = D.sales.filter(s => s.cust === id && s.method === 'sign' && s.date.startsWith(m));
  const pays = D.payments.filter(y => y.cust === id && y.date.startsWith(m));
  
  let rows = '';
  txs.forEach(s => {
    rows += '<tr><td>' + s.date + '</td><td>ซื้อบิล ' + s.bill + '</td><td style="text-align:right">' + F(s.total) + '</td></tr>';
  });
  pays.forEach(y => {
    rows += '<tr><td>' + y.date + '</td><td>ชำระเงิน (' + (y.method === 'cash' ? 'เงินสด' : 'โอนเงิน') + ')</td><td style="text-align:right">-' + F(y.amount) + '</td></tr>';
  });

  const win = window.open('', '_blank');
  win.document.write(
    '<html><head><title>ใบแจ้งยอดหนี้ - ' + c.name + '</title>' +
    '<style>body{font-family:sans-serif;padding:20px;color:#333}h2,h3{margin:0 0 10px 0}table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #ddd;padding:8px;font-size:14px}th{background:#f5f5f5}</style></head>' +
    '<body><h2>ใบแจ้งยอดหนี้ (Statement)</h2><h3>' + c.name + ' (' + c.code + ') ประจำเดือน ' + m + '</h3>' +
    '<table><tr><th>วันที่</th><th>รายการ</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr>' + rows + '</table>' +
    '<h3 style="margin-top:20px;text-align:right">ยอดค้างชำระสุทธิ: ' + F(k.bal[id]) + ' ฿</h3>' +
    '</body></html>'
  );
  win.document.close();
  win.print();
}

// --- ฟังก์ชันวิเคราะห์และประมวลผลรายงาน (เวอร์ชันสมบูรณ์) ---
function renderReports() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11

  let totalSalesAll = 0;
  let totalCostAll = 0;
  let dailySales = 0;
  let weeklySales = 0;
  let monthlySales = 0;
  
  let dailyProfit = 0;
  let weeklyProfit = 0;
  let monthlyProfit = 0;

  // เก็บข้อมูลแยกตามสัปดาห์ (1 เดือนแบ่งเป็น 4 สัปดาห์)
  const weeklyData = { 
    1: { sales: 0, cost: 0, profit: 0, label: 'สัปดาห์ที่ 1 (วันที่ 1-7)' }, 
    2: { sales: 0, cost: 0, profit: 0, label: 'สัปดาห์ที่ 2 (วันที่ 8-14)' }, 
    3: { sales: 0, cost: 0, profit: 0, label: 'สัปดาห์ที่ 3 (วันที่ 15-21)' }, 
    4: { sales: 0, cost: 0, profit: 0, label: 'สัปดาห์ที่ 4 (วันที่ 22 เป็นต้นไป)' } 
  };

  // เก็บยอดขายแยกตามวันในสัปดาห์นี้
  const dailyBreakdown = {};
  
  // คำนวณทุนรวมที่ซื้อของทั้งหมด
  let totalInvestmentCost = 0;
  D.products.forEach(p => {
    let pCost = Number(p.buy_cost) || 0;
    const pRestocks = D.restocks.filter(r => r.pid === p.id);
    pRestocks.forEach(r => pCost += Number(r.cost) || 0);
    totalInvestmentCost += pCost;
  });

  const todayStr = now.toISOString().split('T')[0];

  D.sales.forEach(s => {
    const saleDate = new Date(s.ts || s.date);
    const saleDateStr = saleDate.toISOString().split('T')[0];
    
    if (saleDate.getFullYear() < 2024) return;

    let sRevenue = Number(s.total) || 0;
    let sCost = 0;
    
    (s.items || []).forEach(i => {
      const prod = D.products.find(p => p.id === i.pid);
      const cPerUnit = prod ? (D.cost ? D.cost(prod) : (prod.buy_cost / (prod.buy_qty || 1))) : 0;
      sCost += cPerUnit * (i.qty || 0);
    });

    let sProfit = sRevenue - sCost;
    totalSalesAll += sRevenue;
    totalCostAll += sCost;

    if (saleDateStr === todayStr) {
      dailySales += sRevenue;
      dailyProfit += sProfit;
    }

    if (saleDate.getFullYear() === currentYear && saleDate.getMonth() === currentMonth) {
      monthlySales += sRevenue;
      monthlyProfit += sProfit;

      const dayOfMonth = saleDate.getDate();
      let weekNum = Math.ceil(dayOfMonth / 7);
      if (weekNum > 4) weekNum = 4;

      weeklyData[weekNum].sales += sRevenue;
      weeklyData[weekNum].cost += sCost;
      weeklyData[weekNum].profit += sProfit;

      // บันทึกย่อยรายวันสำหรับเดือนปัจจุบัน
      if (!dailyBreakdown[saleDateStr]) {
        dailyBreakdown[saleDateStr] = { sales: 0, cost: 0, profit: 0, date: saleDateStr };
      }
      dailyBreakdown[saleDateStr].sales += sRevenue;
      dailyBreakdown[saleDateStr].cost += sCost;
      dailyBreakdown[saleDateStr].profit += sProfit;
    }
  });

  const currentDayOfMonth = now.getDate();
  let currentWeekNum = Math.ceil(currentDayOfMonth / 7);
  if (currentWeekNum > 4) currentWeekNum = 4;

  weeklySales = weeklyData[currentWeekNum].sales;
  weeklyProfit = weeklyData[currentWeekNum].profit;

  return {
    totalSalesAll,
    totalInvestmentCost,
    totalProfitAll: totalSalesAll - totalCostAll,
    dailySales,
    dailyProfit,
    weeklySales,
    weeklyProfit,
    monthlySales,
    monthlyProfit,
    weeklyData,
    dailyBreakdown
  };
}

// --- หน้าแสดงผลรายงาน (vRep) ---
function vRep() {
  const r = renderReports();
  const netCashAfterProfit = r.totalSalesAll - r.totalProfitAll;

  // รายละเอียด 4 สัปดาห์
  let weeklyRows = '';
  Object.keys(r.weeklyData).forEach(wKey => {
    const w = r.weeklyData[wKey];
    weeklyRows += '<div class="row sp" style="margin:6px 0;padding:6px 0;border-bottom:1px solid var(--bd)">' +
      '<div><span class="mu">' + w.label + '</span></div>' +
      '<div style="text-align:right">ยอดขาย: <b>' + F(w.sales) + ' ฿</b> | ทุน: <b>' + F(w.cost) + ' ฿</b> | กำไร: <b style="color:var(--pr)">' + F(w.profit) + ' ฿</b></div>' +
    '</div>';
  });

  // รายละเอียดสรุปยอดรายวันในเดือนนี้
  let dailyRows = '';
  const sortedDates = Object.keys(r.dailyBreakdown).sort().reverse().slice(0, 7); // 7 วันล่าสุด
  sortedDates.forEach(dStr => {
    const d = r.dailyBreakdown[dStr];
    const dateObj = new Date(dStr);
    const dayName = dateObj.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
    const isSunday = dateObj.getDay() === 0;
    
    dailyRows += '<tr>' +
      '<td><b>' + dayName + '</b>' + (isSunday ? ' <span class="tag g">ตัดรอบสัปดาห์</span>' : '') + '</td>' +
      '<td style="text-align:right">' + F(d.sales) + ' ฿</td>' +
      '<td style="text-align:right">' + F(d.cost) + ' ฿</td>' +
      '<td style="text-align:right;color:var(--pr);font-weight:bold">' + F(d.profit) + ' ฿</td>' +
    '</tr>';
  });
  if (!dailyRows) dailyRows = '<tr><td colspan="4" style="text-align:center" class="mu">ยังไม่มีข้อมูลยอดขายรายวันในเดือนนี้</td></tr>';

  return '<div class="row sp" style="margin-bottom:12px">' +
    '<h2>📊 วิเคราะห์ยอดขาย & รายงานสวัสดิการ</h2>' +
    '<div class="row" style="flex:none;gap:6px">' +
      '<button class="btn sm s" onclick="exportReportExcel()">📥 ส่งออก Excel</button>' +
      '<button class="btn sm" onclick="window.print()">🖨 พิมพ์ PDF / รายงาน</button>' +
    '</div></div>' +
    
    // การ์ดสรุปยอดหลัก 4 ช่อง
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px">' +
      '<div class="card"><div class="mu">ยอดขายประจำวัน</div><div style="font-size:24px;font-weight:bold;color:var(--pr)">' + F(r.dailySales) + ' ฿</div><div class="mu" style="margin-top:4px">กำไรวันนี้: <b>' + F(r.dailyProfit) + ' ฿</b></div></div>' +
      '<div class="card"><div class="mu">ยอดขายประจำสัปดาห์นี้</div><div style="font-size:24px;font-weight:bold;color:var(--pr)">' + F(r.weeklySales) + ' ฿</div><div class="mu" style="margin-top:4px">กำไรสัปดาห์นี้: <b>' + F(r.weeklyProfit) + ' ฿</b></div></div>' +
      '<div class="card"><div class="mu">ยอดขายประจำเดือนนี้</div><div style="font-size:24px;font-weight:bold;color:var(--pr)">' + F(r.monthlySales) + ' ฿</div><div class="mu" style="margin-top:4px">กำไรเดือนนี้: <b>' + F(r.monthlyProfit) + ' ฿</b></div></div>' +
      '<div class="card"><div class="mu">ทุนรวมที่ซื้อของทั้งหมด</div><div style="font-size:24px;font-weight:bold">' + F(r.totalInvestmentCost) + ' ฿</div><div class="mu" style="margin-top:4px">ยอดขายรวมทั้งหมด: <b>' + F(r.totalSalesAll) + ' ฿</b></div></div>' +
    '</div>' +

    // การ์ดสรุปผลกำไรและการแบ่งสัปดาห์
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:16px">' +
      '<div class="card"><h3>💰 สรุปผลกำไรและการเงิน</h3>' +
        '<div class="row sp" style="margin:10px 0"><span>ทุนรวมซื้อของทั้งหมด (คลัง + รับของ)</span><b>' + F(r.totalInvestmentCost) + ' ฿</b></div>' +
        '<div class="row sp" style="margin:10px 0"><span>ยอดขายรวมทั้งหมด</span><b>' + F(r.totalSalesAll) + ' ฿</b></div>' +
        '<div class="row sp" style="margin:10px 0;border-top:1px solid var(--bd);padding-top:8px"><span>กำไรสุทธิรวมทั้งหมด (ที่คาดว่าจะได้รับ)</span><b style="color:var(--pr);font-size:18px">' + F(r.totalProfitAll) + ' ฿</b></div>' +
        '<div class="row sp" style="margin:10px 0"><span>เงินคงเหลือเมื่อหักกำไร (เงินต้นคืนทุน)</span><b>' + F(netCashAfterProfit) + ' ฿</b></div>' +
      '</div>' +
      
      '<div class="card"><h3>📅 สรุปยอดและเงินลงทุนแบ่ง 4 สัปดาห์ (ประจำเดือนนี้)</h3>' +
        '<div class="mu" style="margin-bottom:8px">ระบบจะตัดรอบสรุปผลทุกๆ วันอาทิตย์</div>' +
        weeklyRows + 
      '</div>' +
    '</div>' +

    // ตารางยอดขายรายวันล่าสุด
    '<div class="card tbl" style="margin-bottom:16px">' +
      '<h3>📆 สรุปยอดขายและกำไรแยกรายวัน (7 วันล่าสุด)</h3>' +
      '<table>' +
        '<tr><th>วันที่</th><th style="text-align:right">ยอดขาย (บาท)</th><th style="text-align:right">ต้นทุน (บาท)</th><th style="text-align:right">กำไรสุทธิ (บาท)</th></tr>' +
        dailyRows +
      '</table>' +
    '</div>';
}

function initCharts() {
  // ฟังก์ชันรองรับการวาดกราฟถ้ามี
}
