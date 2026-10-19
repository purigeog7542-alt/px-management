const SUPABASE_URL = 'https://wtyvtjvzvgurybtcnnsf.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_JLPzS9fSB0-mJN9D3Vssiw_ibQEXq4d'; 
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let D = { products: [], customers: [], sales: [], payments: [], restocks: [] };
let tab = 'sell', cust = '', method = 'sign', cart = {}, q = '';
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

async function loadDataFromSupabase() {
  try {
    const isMgr = window.USER_ROLE === 'manager';

    const [pRes, mRes, sRes, iRes, payRes, rRes] = await Promise.all([
      sb.from(isMgr ? 'products' : 'products_public').select('*'),
      sb.from(isMgr ? 'members' : 'members_public').select('*'),
      isMgr ? sb.from('transactions').select('*') : Promise.resolve({ data: [] }),
      isMgr ? sb.from('transaction_items').select('*') : Promise.resolve({ data: [] }),
      isMgr ? sb.from('payments').select('*') : Promise.resolve({ data: [] }),
      isMgr ? sb.from('restocks').select('*') : Promise.resolve({ data: [] })
    ]);

    if (pRes.error) throw pRes.error;
    if (mRes.error) throw mRes.error;

    const transactions = (sRes.data || []).map(tx => ({
      ...tx,
      items: (iRes.data || []).filter(item => item.transaction_id === tx.id).map(item => ({
        pid: item.product_id,
        name: item.name,
        qty: Number(item.qty) || 0,
        price: Number(item.unit_price) || 0,
        cost: item.qty > 0 ? (Number(item.total_cost) / Number(item.qty)) : 0
      }))
    }));

    D.products = (pRes.data || []).map(p => ({
      ...p,
      stock: isMgr ? (p.buy_qty - (transactions.flatMap(t => t.items).filter(i => i.pid === p.id).reduce((s,i) => s + i.qty, 0))) : p.stock
    }));

    D.customers = (mRes.data || []).map(m => ({ 
      id: m.id, 
      code: m.code, 
      name: m.name, 
      opening: m.opening || 0, 
      credit_limit: m.credit_limit || 1000,
      balance: isMgr ? 0 : (m.balance || 0)
    }));

    D.sales = transactions;
    D.payments = payRes.data || [];
    D.restocks = rRes.data || [];

    render();
  } catch (err) {
    console.error('Error loading data:', err);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

function calc() {
  const sold = {}, bal = {}, stockMap = {};
  D.sales.forEach(s => (s.items || []).forEach(i => sold[i.pid] = (sold[i.pid] || 0) + (Number(i.qty) || 0)));
  
  D.customers.forEach(c => bal[c.id] = c.balance !== undefined ? c.balance : (+c.opening || 0));
  if (window.USER_ROLE === 'manager') {
    D.sales.forEach(s => { if (s.method === 'sign' && s.cust in bal) bal[s.cust] += Number(s.total) || 0; });
    D.payments.forEach(y => { if (y.status === 'ok' && y.cust in bal) bal[y.cust] -= Number(y.amount) || 0; });
  }

  D.products.forEach(p => {
    stockMap[p.id] = p.stock !== undefined ? p.stock : (Number(p.buy_qty || 0) - (sold[p.id] || 0));
  });

  const stock = p => stockMap[p.id] ?? 0;
  const cost = p => 0; 
  
  return { sold, bal, stock, cost };
}

const P = id => D.products.find(p => p.id === id);
const C = id => D.customers.find(c => c.id === id);
const nextCode = (arr, pre, w) => pre + pad(Math.max(0, ...arr.map(x => parseInt((x.code||'').slice(pre.length))||0)) + 1, w);
const stat = (p, k) => { const s = k.stock(p); return s <= 0 ? ['หมด', 'r'] : s <= (p.reorder || 5) ? ['ด่วน', 'r'] : ['ปกติ', 'g']; };

function goTab(k) { tab = k; render(); }
function srch(val) { q = val; }

function render() {
  const navEl = document.getElementById('nav');
  if (navEl) {
    let navHtml = '';
    [
      ['sell', '🛒', 'ขายสินค้า'],
      ['stock', '📦', 'คลังสินค้า'],
      ['cus', '👥', 'สมาชิก']
    ].forEach(([k, i, t]) => {
      navHtml += '<button class="' + (tab === k ? 'a' : '') + '" onclick="goTab(\'' + k + '\')">' + i + '<br>' + t + '</button>';
    });
    if (window.USER_ROLE === 'manager') {
      navHtml += '<button onclick="window.location.href=\'dashboard.html\'">📊<br>แดชบอร์ด</button>';
    }
    navEl.innerHTML = navHtml;
  }
  
  const k = calc();
  let content = '';
  if (tab === 'sell') content = vSell(k);
  else if (tab === 'stock') content = vStock(k);
  else if (tab === 'cus') content = vCus(k);
  
  const appEl = document.getElementById('app');
  if (appEl) appEl.innerHTML = content;
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
    signHtml = '<label>เลือกสมาชิก</label><select onchange="cust=this.value;render()">'+opts+'</select>'+curBal;
  }

  let gridHtml = '';
  if (ps.length === 0) {
    gridHtml = '<div class="mu">ยังไม่มีสินค้าในระบบ</div>';
  } else {
    gridHtml = '<div class="grid">';
    ps.forEach(p => {
      const s = k.stock(p), n = cart[p.id] || 0;
      let badge = n ? '<div style="margin-top:6px" class="tag g">เลือก '+n+'</div>' : '';
      gridHtml += '<button class="prod '+(n?'on':'')+' '+(s<=0?'off':'')+'" onclick="add(\''+p.id+'\',1)"><div class="icon">'+(p.icon||'🥤')+'</div><div><b>'+esc(p.name)+'</b><span class="pr">'+F(p.price)+' ฿</span><div class="mu" style="margin-top:4px">เหลือ '+s+' '+esc(p.unit)+'</div></div>'+badge+'</button>';
    });
    gridHtml += '</div>';
  }

  let cartHtml = '';
  if (items.length > 0) {
    let itemsList = '';
    items.forEach(i => {
      itemsList += '<div class="row sp" style="margin:8px 0"><div style="flex:2">'+esc(P(i).name)+'<div class="mu">'+F(P(i).price)+' ฿ × '+cart[i]+'</div></div><div class="row" style="flex:1"><button class="btn s sm" onclick="add(\''+i+'\',-1)">−</button><b style="text-align:center">'+cart[i]+'</b><button class="btn s sm" onclick="add(\''+i+'\',1)">+</button></div></div>';
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
  const items = Object.keys(cart).filter(i=>cart[i]>0).map(i => ({
    pid: i,
    qty: cart[i],
    price: P(i).price
  }));

  if (!items.length) return;
  if (method === 'sign' && !cust) return toast('กรุณาเลือกสมาชิกก่อน');

  try {
    const { data, error } = await sb.rpc('checkout_sale', {
      p_method: method,
      p_cust: cust || null,
      p_items: items
    });

    if (error) throw error;

    cart = {}; 
    toast('บันทึกการขายสำเร็จ: ' + data);
    loadDataFromSupabase();
  } catch (err) {
    toast('บันทึกการขายไม่สำเร็จ: ' + err.message);
  }
}

function vStock() {
  const k = calc();
  const isMgr = window.USER_ROLE === 'manager';

  const rows = D.products.slice().sort((a,b)=>a.code>b.code?1:-1).map(p => {
    const s = p.stock <= 0 ? ['หมด', 'r'] : ['ปกติ', 'g'];
    return '<tr><td><b>' + esc(p.name) + '</b><br><span class="mu">' + p.code + '</span></td>' +
      '<td><b>' + k.stock(p) + '</b> ' + esc(p.unit) + '</td>' +
      '<td>' + F(p.price) + ' ฿</td>' +
      (isMgr ? '<td>-</td><td>-</td>' : '') +
      '<td><span class="badge ' + s[1] + '">' + s[0] + '</span></td>' +
      '<td>-</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center" class="mu">ยังไม่มีสินค้าในระบบ</td></tr>';

  return '<div class="row sp" style="margin-bottom:12px"><h2>📦 คลังสินค้า</h2></div>' +
    '<div class="card tbl"><table><tr><th>สินค้า</th><th>คงเหลือ</th><th>ราคาขาย</th>' + 
    (isMgr ? '<th>ทุน/หน่วย</th><th>กำไร/หน่วย</th>' : '') + 
    '<th>สถานะ</th><th>จัดการ</th></tr>' + rows + '</table></div>';
}

function vCus(k) {
  let rows = '';
  D.customers.slice().sort((a,b)=>a.code.localeCompare(b.code)).forEach(c => {
    const curB = k.bal[c.id], lim = c.credit_limit || 1000;
    rows += '<tr><td>'+c.code+'</td><td><b>'+esc(c.name)+'</b></td><td><b class="'+(curB>0?'neg':'')+'">'+F(curB)+'</b> <span class="mu">/ '+F(lim)+'</span></td></tr>';
  });
  return '<div class="row sp"><h2>👥 รายชื่อสมาชิก</h2></div><div class="card tbl"><table><tr><th>รหัส</th><th>ชื่อสมาชิก</th><th>ยอดค้าง / วงเงิน</th></tr>'+rows+'</table></div>';
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    loadDataFromSupabase();
  }, 200);
});
