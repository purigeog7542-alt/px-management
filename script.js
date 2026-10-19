window.SUPABASE_URL = window.SUPABASE_URL || 'https://wtyvtjvzvgurybtcnnsf.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_JLPzS9fSB0-mJN9D3Vssiw_ibQEXq4d';
window.sb = window.sb || window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

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

    D.products = (pRes.data || []).map(p => {
      let unitCost = 0;
      if (isMgr && p.buy_qty > 0) {
        unitCost = Number(p.buy_cost || 0) / Number(p.buy_qty || 1);
      }
      return {
        ...p,
        cost: unitCost,
        stock: isMgr ? (p.buy_qty - (transactions.flatMap(t => t.items).filter(i => i.pid === p.id).reduce((s,i) => s + i.qty, 0))) : p.stock
      };
    });

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
  const sold = {}, bal = {}, stockMap = {}, costMap = {};
  D.sales.forEach(s => (s.items || []).forEach(i => sold[i.pid] = (sold[i.pid] || 0) + (Number(i.qty) || 0)));
  
  D.customers.forEach(c => bal[c.id] = c.balance !== undefined ? c.balance : (+c.opening || 0));
  if (window.USER_ROLE === 'manager') {
    D.sales.forEach(s => { if (s.method === 'sign' && s.cust in bal) bal[s.cust] += Number(s.total) || 0; });
    D.payments.forEach(y => { if (y.status === 'ok' && y.cust in bal) bal[y.cust] -= Number(y.amount) || 0; });
  }

  D.products.forEach(p => {
    stockMap[p.id] = p.stock !== undefined ? p.stock : (Number(p.buy_qty || 0) - (sold[p.id] || 0));
    costMap[p.id] = p.cost !== undefined ? p.cost : (Number(p.buy_cost || 0) / (Number(p.buy_qty) || 1));
  });

  const stock = p => stockMap[p.id] ?? 0;
  const cost = p => costMap[p.id] ?? 0;
  
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
  const k = calc(), p = P(id);
  if (!p) return;
  const n = (cart[id] || 0) + d;
  if (n > k.stock(p) && d > 0) return toast('สินค้าในสต็อกไม่พอ');
  cart[id] = Math.max(0, n);
  render();
}

function addToCartAndGoSell(pid) {
  add(pid, 1);
  goTab('sell');
  toast('เพิ่มลงตะกร้าเรียบร้อยแล้ว');
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
    const s = stat(p, k), c = k.cost(p), profit = p.price - c;
    
    let actionBtns = '';
    if (isMgr) {
      actionBtns = '<div class="row" style="gap:4px">' +
        '<button class="btn s sm" onclick="adjustStockManual(\'' + p.id + '\')">ปรับสต็อก</button>' +
        '<button class="btn s sm" onclick="fRestock(\'' + p.id + '\')">รับของ</button>' +
        '<button class="btn sm" onclick="fProd(\'' + p.id + '\')">แก้ไข</button>' +
      '</div>';
    } else {
      actionBtns = '<div class="row" style="gap:4px">' +
        '<button class="btn s sm" onclick="addToCartAndGoSell(\'' + p.id + '\')">+ เพิ่มเข้าตะกร้า</button>' +
      '</div>';
    }

    return '<tr>' +
      '<td><b>' + esc(p.name) + '</b><br><span class="mu">' + p.code + '</span></td>' +
      '<td><b>' + k.stock(p) + '</b> ' + esc(p.unit) + '</td>' +
      '<td>' + F(p.price) + ' ฿</td>' +
      (isMgr ? '<td>' + F(c) + ' ฿</td><td><b style="color:var(--pr)">' + F(profit) + ' ฿</b></td>' : '') +
      '<td><span class="badge ' + (s[1] === 'r' ? 'er' : 'ok') + '">' + s[0] + '</span></td>' +
      '<td>' + actionBtns + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="' + (isMgr ? 7 : 5) + '" style="text-align:center" class="mu">ยังไม่มีสินค้าในระบบ</td></tr>';

  // 💡 พนักงานขาย (Seller) และ ผู้จัดการ (Manager) จะเห็นปุ่มเพิ่มสินค้าใหม่ได้ทั้งคู่
  const headerBtns = '<button class="btn sm p" onclick="fProd()">+ เพิ่มสินค้าใหม่</button>';

  return '<div class="row sp" style="margin-bottom:12px">' +
    '<h2>📦 คลังสินค้า</h2>' +
    '<div class="row" style="flex:none;gap:6px">' + headerBtns + '</div>' +
    '</div>' +
    '<div class="card tbl"><table><tr>' +
    '<th>สินค้า</th><th>คงเหลือ</th><th>ราคาขาย</th>' + 
    (isMgr ? '<th>ทุน/หน่วย</th><th>กำไร/หน่วย</th>' : '') + 
    '<th>สถานะ</th><th>จัดการ</th>' +
    '</tr>' + rows + '</table></div>';
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
    '<div class="row sp"><span>กำไร/หน่วย</span><b class="' + cl + '">' + F(pf) + ' ฿</b></div>';
  box.innerHTML = h;
}

function fProd(id) {
  const isMgr = window.USER_ROLE === 'manager';
  const p = id ? P(id) : null, k = calc();
  const currentIcon = p ? (p.icon || '🥤') : '🥤';
  const emojis = ['🥤', '☕', '🍵', '🥛', '🧃', '🍫', '🍜', '🥔', '🍺', '🍞', '🍪', '🍬', '🧊', '🥫', '🍉', '🍎', '🥚', '🍚', '⚡', '🍭', '🍿'];
  let emojiOptions = '';
  emojis.forEach(em => { emojiOptions += '<option value="'+em+'" '+(currentIcon===em?'selected':'')+'>'+em+' (ไอคอน)</option>'; });
  const oi = ' oninput="pv()"';

  // 💡 ถ้าเป็น Seller เพิ่มสินค้า จะซ่อนช่องกรอกต้นทุน
  let costFields = '';
  if (isMgr) {
    costFields = p
      ? '<label>ต้นทุนเฉลี่ย / หน่วย (บาท)</label><input id="cs" type="number" inputmode="decimal" step="any" value="'+(+k.cost(p).toFixed(2))+'"'+oi+'>'
      : '<div class="row"><div><label>หน่วยขาย</label><input id="u" value="หน่วย"></div><div><label>ชื่อแพ็ค</label><input id="pn" value="แพ็ค"></div></div>' +
        '<div class="row"><div><label>ชิ้นต่อแพ็ค</label><input id="pe" type="number" value="1"'+oi+'></div><div><label>จำนวนแพ็คที่ซื้อ</label><input id="pk" type="number" value="1"></div></div>' +
        '<label>ต้นทุนต่อแพ็ค (บาท)</label><input id="pc" type="number" inputmode="decimal" step="any"'+oi+'>';
  } else {
    costFields = '<div class="row"><div><label>หน่วยขาย</label><input id="u" value="หน่วย"></div><div><label>จำนวนสต็อกตั้งต้น</label><input id="st" type="number" value="0"></div></div>';
  }

  modal('<h2>'+(p?'แก้ไขสินค้า':'เพิ่มสินค้าใหม่')+'</h2><label>ชื่อสินค้า</label><input id="n" value="'+esc(p?p.name:'')+'">' +
    '<label>ไอคอน / Emoji</label><select id="ic" style="font-size:20px;padding:6px">'+emojiOptions+'</select>' + costFields + (p ? '<div class="row"><div><label>หน่วยขาย</label><input id="u" value="'+esc(p.unit)+'"></div><div><label>ชื่อแพ็ค</label><input id="pn" value="'+esc(p.pack_name||'แพ็ค')+'"></div><div><label>ชิ้นต่อแพ็ค</label><input id="pe" type="number" value="'+(p.per||1)+'" oninput="pv()"></div></div>' : '') +
    '<label>ราคาขาย / หน่วย (บาท)</label><input id="pr" type="number" inputmode="decimal" step="any" value="'+(p?p.price:'')+'"'+oi+'>' +
    '<div class="pv" id="pvb"></div>' +
    '<label>จุดเตือนสั่งซื้อ</label><input id="ro" type="number" value="'+(p?p.reorder:5)+'">' + (p && isMgr ? '<button class="btn s w" style="margin-top:14px;color:var(--er);border-color:var(--er)" onclick="delProd(\''+id+'\')">🗑 ลบสินค้า</button>': ''),
  async () => {
    const n = V('n').trim(); if(!n) throw{message:'กรอกชื่อสินค้า'};
    const price = +V('pr') || 0; if(!(price>0)) throw{message:'กรอกราคาขาย'};
    
    if(p) {
      if (!isMgr) throw {message: 'พนักงานขายไม่มีสิทธิ์แก้ไขสินค้า'};
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
      const per = +V('pe')||1;
      const code = nextCode(D.products,'P',3);
      let initialQty = 0;
      let initialCost = 0;

      if (isMgr) {
        const pk = +V('pk')||0, pc = +V('pc')||0;
        initialQty = per * pk;
        initialCost = pk * pc;
      } else {
        initialQty = +V('st') || 0;
        initialCost = 0; // Seller เพิ่ม จะบันทึกทุนเป็น 0 บาท
      }

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
        buy_qty: initialQty,
        buy_cost: initialCost
      };
      const { error } = await sb.from('products').insert([newProd]);
      if (error) throw error;
    }
    loadDataFromSupabase();
  });
  if (isMgr) pv();
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
  const newBuyQty = newStock + soldQty;

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
    '<div class="row sp mu" style="margin:4px 0"><span>' + new Date(r.ts).toLocaleDateString('th-TH') + ' · ' + r.packs + ' ' + pn + ' (' + r.units + ' ' + esc(p.unit) + ') · ' + F(r.cost) + ' ฿</span><span style="flex:none"><button class="btn s sm" onclick="delRs(\'' + r.id + '\')">ลบ</button></span></div>').join('')
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
