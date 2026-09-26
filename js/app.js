// Giao diện. Mọi thay đổi dữ liệu đi qua push()/save() → tính lại từ nhật ký → lưu → vẽ lại.
import * as L from './logic.js';
import * as store from './store.js';
import * as X from './export.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const sheetEl = $('#sheet');

let team = store.loadTeam();
let match = null; // trận đang mở (đang ghi hoặc vừa xong)
let R = null; // kết quả replay(match)
const ui = { coachFilter: 'set', recvFor: null, sheet: null, pickHow: null, editIdx: null, chk: null };

function loadCurrent() {
  const id = store.currentId();
  match = id ? store.loadMatch(id) : null;
  R = match ? L.replay(match) : null;
}

// ---------- ghi dữ liệu ----------
function save() {
  R = L.replay(match);
  match.status = R.over ? 'done' : 'live';
  store.saveMatch(match, R);
  render();
}
function push(ev) {
  ev.ts = Date.now(); // mốc thời gian: dùng để khớp video ở giai đoạn sau
  match.events.push(ev);
  save();
}

// ---------- tiện ích hiển thị ----------
const P = (pid) => L.playerById(match, pid);
function chip(pid, extra = '') {
  const p = P(pid);
  if (!p) return '<span class="pnum">?</span>';
  return `<span class="pnum">${p.num}</span><span class="pname">${esc(p.name || L.POS_SHORT[p.pos] || '')}</span>${extra}`;
}
const pname = (pid) => esc(L.playerLabel(match, pid));
const sideName = (s) => (s === 'us' ? 'Ta' : 'Đối thủ');

let toastTimer = null;
function toast(msg, undo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button data-act="undo" class="btn-sm">Hoàn tác</button>' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function openSheet(name, data = {}) {
  ui.sheet = name;
  Object.assign(ui, data);
  renderSheet();
}
function closeSheet() {
  ui.sheet = null;
  sheetEl.hidden = true;
  sheetEl.innerHTML = '';
}

// ---------- router ----------
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => { closeSheet(); render(); });

function render() {
  const h = location.hash || '#/';
  const [, route, arg] = h.split('/');
  document.body.dataset.route = route || 'home';
  let html;
  if (route === 'team') html = viewTeam();
  else if (route === 'setup') html = viewSetup();
  else if (route === 'live' && match) html = viewLive();
  else if (route === 'coach' && match) html = viewCoach();
  else if (route === 'rallies' && match) html = viewRallies();
  else if (route === 'history') html = viewHistory();
  else if (route === 'summary') html = viewSummary(arg);
  else html = viewHome();
  const warn = store.lastError
    ? `<div class="banner" role="alert">Không lưu được vào máy (${esc(store.lastError.name)}). Hãy xuất JSON ngay để tránh mất dữ liệu.</div>` : '';
  app.innerHTML = warn + html;
  if (ui.sheet) renderSheet();
  wake(route === 'live');
}

// ---------- Trang chủ ----------
function viewHome() {
  const live = match && match.status === 'live';
  return `
  <header class="top"><h1>Scout Bóng Chuyền</h1></header>
  <main class="home">
    ${live ? `<button class="big primary" data-act="nav" data-to="#/live" data-testid="continue">Tiếp tục ghi: ${esc(team.name)} vs ${esc(match.opponent)}<small>Set ${R.sets.length} · ${R.cur ? `${R.cur.us}–${R.cur.them}` : ''}</small></button>` : ''}
    <button class="big ${live ? '' : 'primary'}" data-act="nav" data-to="#/setup" data-testid="new-match">Trận mới</button>
    <button class="big" data-act="nav" data-to="#/team" data-testid="team">Đội của tôi <small>${team.players.length} VĐV</small></button>
    <button class="big" data-act="nav" data-to="#/history" data-testid="history">Lịch sử trận</button>
    <div class="row2">
      <button class="btn" data-act="import">Nhập dữ liệu (JSON)</button>
      <button class="btn" data-act="backup">Sao lưu toàn bộ</button>
    </div>
    <p class="hint">Dữ liệu chỉ nằm trên máy này. Sao lưu JSON sau mỗi trận.</p>
  </main>`;
}

// ---------- Đội ----------
function viewTeam() {
  const rows = team.players.map((p, i) => `
    <div class="prow" data-i="${i}">
      <input class="num" type="number" inputmode="numeric" min="0" max="99" value="${p.num}" data-field="num" aria-label="Số áo">
      <input class="name" type="text" value="${esc(p.name)}" placeholder="Tên (tuỳ chọn)" data-field="name" aria-label="Tên">
      <select data-field="pos" aria-label="Vị trí">${L.POSITIONS.map(([k, v]) => `<option value="${k}" ${p.pos === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn-icon" data-act="delPlayer" data-i="${i}" aria-label="Xoá">✕</button>
    </div>`).join('');
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Đội của tôi</h1></header>
  <main class="page">
    <label class="field">Tên đội<input type="text" value="${esc(team.name)}" data-field="teamName"></label>
    <p class="hint">Số áo · Tên · Vị trí. Tự lưu khi sửa. Khai báo <b>chuyền hai</b> để xoay vòng P1–P6 tính theo vị trí chuyền hai.</p>
    <div class="plist">${rows}</div>
    <button class="btn" data-act="addPlayer">+ Thêm VĐV</button>
  </main>`;
}
function onTeamInput(el) {
  const f = el.dataset.field;
  if (f === 'teamName') team.name = el.value.trim() || 'Đội nhà';
  else {
    const p = team.players[+el.closest('.prow').dataset.i];
    p[f] = f === 'num' ? parseInt(el.value, 10) || 0 : el.value.trim();
  }
  saveTeam();
}
function saveTeam() {
  store.saveTeam(team);
  // Đồng bộ tên/số/vị trí sang trận đang ghi (giữ nguyên id nên nhật ký không lệch). Không vẽ lại để khỏi mất con trỏ khi gõ.
  if (match && match.status === 'live') {
    for (const p of team.players) {
      const q = P(p.id);
      if (q) Object.assign(q, p);
      else match.players.push({ ...p });
    }
    match.teamName = team.name;
    R = L.replay(match);
    store.saveMatch(match, R);
  }
}

// ---------- Thiết lập trận ----------
function lineupFields(lineup, libero) {
  const opts = (sel) => team.players.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p.num}${p.name ? ' · ' + esc(p.name) : ''}${p.pos ? ' (' + L.POS_SHORT[p.pos] + ')' : ''}</option>`).join('');
  const slots = [4, 3, 2, 5, 6, 1].map((z) => `<label class="slot">P${z}<select name="p${z}" data-testid="lu-p${z}">${opts(lineup[z - 1])}</select></label>`).join('');
  return `<div class="lineup"><div class="net">LƯỚI</div>${slots}</div>
    <label class="field">Libero<select name="libero" data-testid="lu-libero"><option value="">Không có</option>${opts(libero)}</select></label>`;
}
function readLineup(form) {
  const lineup = [1, 2, 3, 4, 5, 6].map((z) => form.elements['p' + z].value);
  const libero = form.elements.libero.value || null;
  if (new Set(lineup).size !== 6) return { err: 'Đội hình P1–P6 phải là 6 VĐV khác nhau.' };
  if (libero && lineup.includes(libero)) return { err: 'Libero không được nằm trong 6 VĐV xuất phát.' };
  return { lineup, libero };
}
function radio(name, val, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
}
function viewSetup() {
  const lib = team.players.find((p) => p.pos === 'L');
  const six = team.players.filter((p) => p !== lib).slice(0, 6).map((p) => p.id);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Trận mới</h1></header>
  <main class="page">
    <form id="setup" class="form">
      <div class="field">Loại trận ${radio('type', 'official', [['practice', 'Đấu tập'], ['official', 'Chính thức']])}</div>
      <label class="field">Đối thủ<input name="opp" type="text" required placeholder="Tên đội bạn" data-testid="opp"></label>
      <label class="field">Ngày<input name="date" type="date" value="${today}"></label>
      <div class="field">Thể thức ${radio('bestOf', '5', [['5', '5 set (thắng 3)'], ['3', '3 set (thắng 2)']])}</div>
      <div class="field">Đội hình xuất phát set 1</div>
      ${lineupFields(six, lib ? lib.id : '')}
      <div class="field">Phát bóng trước ${radio('server', 'us', [['us', esc(team.name)], ['them', 'Đối thủ']])}</div>
      <p class="err" id="setupErr" role="alert"></p>
      <button class="big primary" type="submit" data-testid="start-match">Bắt đầu ghi</button>
    </form>
  </main>`;
}
function submitSetup(form) {
  const lu = readLineup(form);
  const err = $('#setupErr');
  if (lu.err) return (err.textContent = lu.err);
  const opp = form.elements.opp.value.trim();
  if (!opp) return (err.textContent = 'Nhập tên đối thủ.');
  const server = form.elements.server.value;
  match = {
    id: store.uid(), created: Date.now(), app: 'scout-bong-chuyen', version: 1,
    type: form.elements.type.value, opponent: opp, date: form.elements.date.value,
    bestOf: +form.elements.bestOf.value, firstServer: server, teamName: team.name,
    players: team.players.map((p) => ({ ...p })),
    events: [{ t: 'start', lineup: lu.lineup, libero: lu.libero, server, ts: Date.now() }],
    status: 'live',
  };
  store.setCurrent(match.id);
  ui.recvFor = null;
  save();
  go('#/live');
}

// ---------- Màn ghi trận ----------
function court(c, big = false) {
  const cell = (z) => {
    const pid = c.order[z - 1];
    const p = P(pid);
    const srv = z === 1 && c.serve === 'us';
    const isS = pid === c.ref && p && p.pos === 'S';
    return `<div class="zone ${srv ? 'srv' : ''} ${isS ? 'setter' : ''}" data-z="${z}"><span class="zl">P${z}</span>${chip(pid)}${srv ? '<span class="ball" title="Đang phát">●</span>' : ''}</div>`;
  };
  return `<div class="court ${big ? 'big' : ''}" data-testid="court">${[4, 3, 2, 5, 6, 1].map(cell).join('')}</div>`;
}

function viewLive() {
  const c = R.cur;
  const s = c || { us: 0, them: 0, n: 1 };
  const last = R.rallies[R.rallies.length - 1];
  const tl = c ? 2 - c.to.us : 2;
  let body;
  if (R.over) {
    body = `<div class="card center"><h2>Trận kết thúc</h2><p class="result">${esc(match.teamName)} ${R.winsUs}–${R.winsThem} ${esc(match.opponent)}</p>
      <p>${L.setScores(R).join(' · ')}</p>
      <button class="big primary" data-act="nav" data-to="#/summary/${match.id}" data-testid="to-summary">Xem tổng kết</button></div>`;
  } else if (R.needStart) {
    body = `<div class="card center">${c ? `<h2>Hết set ${c.n}: ${c.us}–${c.them}</h2>` : ''}
      <button class="big primary" data-act="startSet" data-testid="start-set">Bắt đầu set ${R.sets.length + 1}</button></div>`;
  } else {
    const hb = (h) => {
      const dis = h.need && h.need !== c.serve;
      return `<button class="how ${h.win ? 'win' : 'lose'}" data-act="how" data-how="${h.k}" ${dis ? 'disabled' : ''}>${h.label}</button>`;
    };
    const wins = L.HOWS.filter((h) => h.win && !h.hidden).map(hb).join('');
    const loses = L.HOWS.filter((h) => !h.win && !h.hidden).map(hb).join('');
    body = `<div class="hows">
        <div class="col"><div class="colh win">TA GHI ĐIỂM</div>${wins}</div>
        <div class="col"><div class="colh lose">TA MẤT ĐIỂM</div>${loses}</div>
      </div>`;
  }
  const lastLine = last
    ? `<button class="lastline" data-act="nav" data-to="#/rallies" data-testid="last">Pha trước: <b>${last.win ? 'Ghi' : 'Mất'}</b> · ${L.HOW[last.how].label}${last.p ? ' · ' + pname(last.p) : ''} · ${last.usA}–${last.themA}</button>`
    : '';
  const rp = !R.over && !R.needStart ? recvPanel() : '';
  const forced = R.forced.map((n) => R.sets[n - 1]).map((x) => `set ${x.n} (${x.us}–${x.them})`).join(', ');
  const warn = (R.ignored.length ? `<button class="banner" data-act="nav" data-to="#/rallies">${R.ignored.length} sự kiện bị bỏ qua sau khi sửa — bấm để kiểm tra</button>` : '')
    + (forced ? `<button class="banner" data-act="nav" data-to="#/rallies" data-testid="forced">Sau khi sửa/xoá pha, ${forced} kết thúc khi chưa đủ điểm — kiểm tra lại các pha</button>` : '');
  return `
  <header class="top live-top">
    <button class="back" data-act="nav" data-to="#/" aria-label="Trang chủ">‹</button>
    <div class="meta"><b data-testid="set-no">Set ${s.n}</b> · Set thắng <b data-testid="sets">${R.winsUs}–${R.winsThem}</b></div>
    <button class="btn-sm" data-act="more" data-testid="more">Thêm ▾</button>
  </header>
  ${warn}
  <main class="live ${rp ? 'has-recv' : ''}">
    <section class="board">
      <div class="score">
        <div class="side us ${c && c.serve === 'us' ? 'serving' : ''}"><span class="tn">${esc(match.teamName)}</span><span class="pts" data-testid="score-us">${s.us}</span>${c && c.serve === 'us' ? '<span class="sv" data-testid="serve-us">● PHÁT</span>' : ''}</div>
        <div class="side them ${c && c.serve === 'them' ? 'serving' : ''}"><span class="tn">${esc(match.opponent)}</span><span class="pts" data-testid="score-them">${s.them}</span>${c && c.serve === 'them' ? '<span class="sv" data-testid="serve-them">● PHÁT</span>' : ''}</div>
      </div>
      ${c ? `<div class="rotline"><span>Xoay vòng <b data-testid="rot">${'P' + (c.order.indexOf(c.ref) + 1)}</b></span><span>Hội ý: ta còn ${tl}, đối còn ${2 - c.to.them}</span></div>${court(c)}` : ''}
      ${lastLine}${rp}
    </section>
    <section class="entry">${body}</section>
  </main>
  <nav class="bottombar">
    <button data-act="undo" data-testid="undo">Hoàn tác</button>
    <button data-act="timeout" data-side="us" ${!c || c.over || tl <= 0 ? 'disabled' : ''} data-testid="timeout">Hội ý ta</button>
    <button class="coachbtn" data-act="nav" data-to="#/coach" data-testid="coach">Màn HLV</button>
    <button data-act="nav" data-to="#/rallies" data-testid="rallies">Các pha</button>
  </nav>`;
}

// Hỏi đỡ bước 1 NGAY SAU một pha đối thủ phát: 1 chạm chấm 0–3, chọn người đỡ nếu kịp. Bỏ qua được.
function recvPanel() {
  const idx = ui.recvFor;
  const ev = idx != null ? match.events[idx] : null;
  const last = R.rallies[R.rallies.length - 1];
  if (!ev || !last || last.i !== idx || last.serve !== 'them' || ev.how === 'rer') return '';
  const setC = R.sets[last.set - 1];
  const people = [setC.libero, ...[5, 6, 1, 4, 3, 2].map((z) => orderBefore(last)[z - 1])].filter(Boolean);
  return `<div class="recv" data-testid="recv">
    <div class="recvh">Đỡ bước 1 pha vừa rồi? <small>0 hỏng → 3 hoàn hảo · bỏ qua được</small></div>
    <div class="rc">${[0, 1, 2, 3].map((n) => `<button data-act="rc" data-rc="${n}" class="${ev.rc === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="rp">${people.map((pid) => `<button data-act="rp" data-rp="${pid}" class="${ev.rp === pid ? 'on' : ''}">${chip(pid)}</button>`).join('')}</div>
  </div>`;
}
// Đội hình trên sân TẠI thời điểm pha đó bắt đầu (trước khi xoay).
function orderBefore(rec) {
  const m2 = { ...match, events: match.events.slice(0, rec.i) };
  const R2 = L.replay(m2);
  return R2.cur.order;
}

// Chống chạm đúp: nút mới vẽ lại đúng chỗ ngón tay → chạm thứ hai trong 350ms bị bỏ qua.
let lastCommit = 0;
const tapGuard = () => (window.__SCOUT_TEST ? 0 : 350);

function onHow(k) {
  if (Date.now() - lastCommit < tapGuard()) return;
  const h = L.HOW[k];
  const c = R.cur;
  if (h.who === 'none') return commitRally(k, null);
  if (h.who === 'server') return commitRally(k, c.order[0]);
  openSheet('pick', { pickHow: k });
}
function commitRally(how, pid) {
  const serveThem = R.cur.serve === 'them';
  closeSheet();
  push({ t: 'r', how, p: pid });
  lastCommit = Date.now();
  ui.recvFor = serveThem && how !== 'rer' ? match.events.length - 1 : null;
  const last = R.rallies[R.rallies.length - 1];
  render();
  // Không bật toast: dòng "Pha trước" đã xác nhận, nút Hoàn tác luôn ở thanh dưới — tránh che nút ghi.
  const ll = $('.lastline');
  if (ll) { ll.classList.add('flash'); setTimeout(() => ll.classList.remove('flash'), 400); }
  void last;
}

function undo() {
  if (!match) return;
  if (match.events.length <= 1) return toast('Không còn gì để hoàn tác.');
  const ev = match.events.pop();
  ui.recvFor = null;
  save();
  const what = { r: 'pha ' + (L.HOW[ev.how] || {}).label, sub: 'thay người', to: 'hội ý', start: 'bắt đầu set', endset: 'kết thúc set', endmatch: 'kết thúc trận', fix: 'chỉnh xoay vòng', chk: 'đối soát' }[ev.t] || 'thao tác';
  toast('Đã hoàn tác: ' + what);
}

// ---------- Bảng chọn (sheet) ----------
function renderSheet() {
  const c = R && R.cur;
  let inner = '';
  const s = ui.sheet;
  if (s === 'pick') {
    const h = L.HOW[ui.pickHow];
    const btn = (pid) => `<button class="pbtn" data-act="pickP" data-pid="${pid}">${chip(pid)}</button>`;
    inner = `<h3>${h.label} — cầu thủ nào?</h3>
      <div class="pgrid">${[4, 3, 2, 5, 6, 1].map((z) => btn(c.order[z - 1])).join('')}</div>
      ${c.libero ? `<div class="pgrid one">${btn(c.libero)}</div>` : ''}
      <div class="row2"><button class="btn" data-act="pickP" data-pid="" data-testid="pick-unknown">Không rõ</button><button class="btn" data-act="closeSheet">Huỷ</button></div>`;
  } else if (s === 'more') {
    inner = `<h3>Thêm</h3><div class="menu">
      <button data-act="openSheet" data-s="sub" ${!c || c.over ? 'disabled' : ''} data-testid="m-sub">Thay người</button>
      <button data-act="nav" data-to="#/rallies">Danh sách pha · sửa / xoá</button>
      <button data-act="openSheet" data-s="check" ${!c ? 'disabled' : ''} data-testid="m-check">Đối soát tỉ số với trọng tài</button>
      <button data-act="openSheet" data-s="fix" ${!c || c.over ? 'disabled' : ''} data-testid="m-fix">Chỉnh xoay vòng / bên phát / điểm</button>
      <button data-act="timeout" data-side="them" ${!c || c.over || c.to.them >= 2 ? 'disabled' : ''}>Đối thủ xin hội ý</button>
      <button data-act="endSet" ${!c || c.over ? 'disabled' : ''}>Kết thúc set (thủ công)</button>
      <button data-act="endMatch" ${R.over ? 'disabled' : ''} data-testid="m-endmatch">Kết thúc trận</button>
      <button data-act="nav" data-to="#/summary/${match.id}">Tổng kết / xuất dữ liệu</button>
      <button data-act="closeSheet">Đóng</button></div>`;
  } else if (s === 'sub') {
    const onCourt = [...c.order, c.libero].filter(Boolean);
    const bench = match.players.filter((p) => !onCourt.includes(p.id));
    inner = `<h3>Thay người · set ${c.n} (đã thay ${c.subs})</h3>
      <form id="subForm" class="form">
        <label class="field">Ra sân<select name="out" data-testid="sub-out">${onCourt.map((pid) => `<option value="${pid}">${pname(pid)}${pid === c.libero ? ' (libero)' : ''}</option>`).join('')}</select></label>
        <label class="field">Vào sân<select name="in" data-testid="sub-in">${bench.map((p) => `<option value="${p.id}">${pname(p.id)}</option>`).join('')}</select></label>
        <div class="row2"><button class="btn primary" type="submit" data-testid="sub-ok">Xác nhận</button><button class="btn" type="button" data-act="closeSheet">Huỷ</button></div>
      </form>`;
  } else if (s === 'fix') {
    inner = `<h3>Chỉnh tay</h3><p class="hint">Chỉ dùng khi app lệch so với thực tế. Mỗi lần chỉnh được ghi vào nhật ký và hoàn tác được.</p>
      <div class="menu">
        <button data-act="fix" data-rot="1">Xoay ta tới 1 vòng</button>
        <button data-act="fix" data-rot="-1">Xoay ta lùi 1 vòng</button>
        <button data-act="fix" data-serve="${c.serve === 'us' ? 'them' : 'us'}">Đổi bên phát → ${sideName(c.serve === 'us' ? 'them' : 'us')}</button>
        <button data-act="fixPoint" data-how="uw">+1 điểm ta (không rõ cách)</button>
        <button data-act="fixPoint" data-how="ul">+1 điểm đối thủ (không rõ cách)</button>
        <button data-act="closeSheet">Đóng</button></div>`;
  } else if (s === 'check') {
    const r = ui.chk;
    let msg = '';
    if (r) {
      msg = r.ok
        ? `<p class="ok" data-testid="chk-result">Khớp: ${r.us}–${r.them}.</p>`
        : `<p class="err" data-testid="chk-result">LỆCH: app ${r.appUs}–${r.appThem}, trọng tài ${r.us}–${r.them}. App không tự sửa — mở “Các pha” để tìm pha ghi sai, hoặc dùng “Chỉnh tay”.</p>
           <div class="row2"><button class="btn" data-act="nav" data-to="#/rallies">Mở các pha</button><button class="btn" data-act="openSheet" data-s="fix">Chỉnh tay</button></div>`;
    }
    inner = `<h3>Đối soát tỉ số set ${c.n}</h3><p class="hint">Nhập tỉ số trên bảng/biên bản trọng tài.</p>
      <form id="chkForm" class="form"><div class="row2">
        <label class="field">${esc(match.teamName)}<input name="us" type="number" inputmode="numeric" min="0" required data-testid="chk-us"></label>
        <label class="field">Đối thủ<input name="them" type="number" inputmode="numeric" min="0" required data-testid="chk-them"></label></div>
        ${msg}
        <div class="row2"><button class="btn primary" type="submit" data-testid="chk-ok">Đối soát</button><button class="btn" type="button" data-act="closeSheet">Đóng</button></div></form>`;
  } else if (s === 'startSet') {
    const prev = R.sets[R.sets.length - 1];
    const n = R.sets.length + 1;
    inner = `<h3>Bắt đầu set ${n}${n === match.bestOf ? ' (set quyết định, tới 15)' : ''}</h3>
      <form id="setForm" class="form">${lineupFieldsFor(prev.lineup, prev.libero)}
        <div class="field">Phát bóng trước ${radio('server', L.defaultServer(match, R), [['us', esc(match.teamName)], ['them', 'Đối thủ']])}</div>
        <p class="err" id="setErr"></p>
        <div class="row2"><button class="btn primary" type="submit" data-testid="set-ok">Bắt đầu</button><button class="btn" type="button" data-act="closeSheet">Huỷ</button></div></form>`;
  } else if (s === 'edit') {
    inner = editSheet();
  } else if (s === 'text') {
    inner = `<h3>Văn bản tổng kết</h3><p class="hint">Chọn tất cả rồi sao chép vào Zalo.</p><textarea readonly rows="12">${esc(ui.text)}</textarea><button class="btn" data-act="closeSheet">Đóng</button>`;
  }
  sheetEl.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-body" role="dialog" aria-modal="true">${inner}</div>`;
  sheetEl.hidden = false;
}
function lineupFieldsFor(lineup, libero) {
  const saved = team;
  team = { ...team, players: match.players };
  const html = lineupFields(lineup, libero);
  team = saved;
  return html;
}

function editSheet() {
  const ev = match.events[ui.editIdx];
  if (!ev || ev.t !== 'r') return '<p>Không tìm thấy pha.</p><button class="btn" data-act="closeSheet">Đóng</button>';
  const rec = R.rallies.find((r) => r.i === ui.editIdx);
  const hb = L.HOWS.map((h) => `<button class="how sm ${h.win ? 'win' : 'lose'} ${ev.how === h.k ? 'on' : ''}" data-act="editHow" data-how="${h.k}" ${rec && h.need && h.need !== rec.serve ? 'disabled' : ''}>${h.label}</button>`).join('');
  const pb = ['', ...match.players.map((p) => p.id)].map((pid) => `<button class="pchip ${(ev.p || '') === pid ? 'on' : ''}" data-act="editP" data-pid="${pid}">${pid ? chip(pid) : 'Không rõ'}</button>`).join('');
  const rc = ['', 0, 1, 2, 3].map((n) => `<button class="pchip ${(ev.rc ?? '') === n ? 'on' : ''}" data-act="editRc" data-rc="${n}">${n === '' ? '—' : n}</button>`).join('');
  return `<h3>Sửa pha ${rec ? `set ${rec.set} #${rec.no} (${rec.usB}–${rec.themB} → ${rec.usA}–${rec.themA})` : '(đang bị bỏ qua)'}</h3>
    <div class="field">Cách</div><div class="hgrid">${hb}</div>
    <div class="field">Cầu thủ</div><div class="chips">${pb}</div>
    <div class="field">Đỡ bước 1 (khi đối thủ phát)</div><div class="chips">${rc}</div>
    <div class="row2"><button class="btn danger" data-act="delEvent" data-testid="del-rally">Xoá pha này</button><button class="btn primary" data-act="closeSheet">Xong</button></div>`;
}

// ---------- Danh sách pha ----------
function viewRallies() {
  const rows = R.rallies.slice().reverse().map((r) => `
    <button class="rrow ${r.win ? 'w' : 'l'}" data-act="edit" data-i="${r.i}" data-testid="rally-${r.set}-${r.no}">
      <span class="rs">S${r.set} #${r.no}</span><span class="rsc">${r.usA}–${r.themA}</span>
      <span class="rh">${L.HOW[r.how].label}${r.p ? ' · ' + pname(r.p) : ''}</span>
      <span class="rx">${r.rot} · ${r.serve === 'us' ? 'ta phát' : 'đối phát'}${r.rc != null ? ' · đỡ ' + r.rc + (r.rp ? ' ' + pname(r.rp) : '') : ''}</span>
    </button>`).join('');
  const ign = R.ignored.map((i) => {
    const ev = match.events[i];
    return `<button class="rrow ign" data-act="${ev.t === 'r' ? 'edit' : 'delIgnored'}" data-i="${i}">Bị bỏ qua: ${ev.t === 'r' ? L.HOW[ev.how].label : ev.t} — bấm để ${ev.t === 'r' ? 'sửa/xoá' : 'xoá'}</button>`;
  }).join('');
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/live">‹</button><h1>Các pha (${R.rallies.length})</h1></header>
  <main class="page"><p class="hint">Bấm vào một pha để sửa hoặc xoá. Tỉ số, xoay vòng và thống kê tự tính lại.</p>${ign}<div class="rlist">${rows || '<p>Chưa có pha nào.</p>'}</div></main>`;
}

// ---------- Màn HLV ----------
function coachBlocks(setN, isCur) {
  const st = L.stats(match, R, setN);
  const ins = L.insights(match, st, isCur);
  const rotRows = st.rot.map((x) => `<tr data-testid="rot-${x.k}" class="${st.worst && st.worst.k === x.k ? 'worst' : ''}">
      <th>${x.k}</th><td data-c="wl">${x.won}–${x.lost}</td><td data-c="diff">${x.diff > 0 ? '+' : ''}${x.diff}</td>
      <td data-c="so">${L.pct(x.soW, x.soN)}<small>${x.soN ? ` ${x.soW}/${x.soN}` : ''}</small></td>
      <td data-c="bp">${L.pct(x.bpW, x.bpN)}<small>${x.bpN ? ` ${x.bpW}/${x.bpN}` : ''}</small></td></tr>`).join('');
  const passRows = st.passers.map((q) => `<tr data-testid="pass-${q.pid}"><th>${pname(q.pid)}</th><td data-c="avg">${L.dec(q.avg)}</td><td data-c="n">${q.n}</td></tr>`).join('');
  const atk = st.players.filter((p) => p.k + p.e > 0).map((p) => `<tr data-testid="atk-${p.pid}"><th>${pname(p.pid)}</th><td data-c="k">${p.k}</td><td data-c="e">${p.e}</td><td data-c="eff">${p.eff == null ? '–' : L.dec(p.eff, 2)}</td><td data-c="b">${p.b}</td></tr>`).join('');
  const srv = st.players.filter((p) => p.ace + p.se > 0).map((p) => `<tr data-testid="srv-${p.pid}"><th>${pname(p.pid)}</th><td data-c="ace">${p.ace}</td><td data-c="se">${p.se}</td></tr>`).join('');
  const s = st.src;
  const src = (k, lbl) => `<li><span>${lbl}</span><b data-testid="src-${k}">${s[k]}</b></li>`;
  const recvAvg = st.recv.n ? L.dec(st.recv.sum / st.recv.n) : '–';
  return `
  <section class="card insights" data-testid="insights"><h2>Nhận định</h2><ol>${ins.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol></section>
  <section class="kpis">
    <div class="kpi"><span>Side-out</span><b data-testid="so">${L.pct(st.soW, st.soN)}</b><small>${st.soW}/${st.soN} pha đối phát</small></div>
    <div class="kpi"><span>Break-point</span><b data-testid="bp">${L.pct(st.bpW, st.bpN)}</b><small>${st.bpW}/${st.bpN} pha ta phát</small></div>
    <div class="kpi"><span>Đỡ bước 1 TB</span><b data-testid="recv-avg">${recvAvg}</b><small>${st.recv.n} lần chấm</small></div>
  </section>
  <section class="card"><h2>Điểm theo xoay vòng</h2>
    <table class="tbl"><thead><tr><th>Vòng</th><th>Thắng–thua</th><th>+/−</th><th>Side-out</th><th>Break-point</th></tr></thead><tbody>${rotRows}</tbody></table>
    <p class="hint">Xoay vòng = vị trí của chuyền hai (P1–P6). Tô đỏ = vòng kém nhất (≥3 pha).</p></section>
  <section class="card"><h2>Đỡ bước 1 theo người</h2>${passRows ? `<table class="tbl"><thead><tr><th>VĐV</th><th>TB /3</th><th>Lần</th></tr></thead><tbody>${passRows}</tbody></table>` : '<p class="hint">Chưa chấm đỡ bước 1 theo người.</p>'}</section>
  <section class="card"><h2>Tấn công</h2>${atk ? `<table class="tbl"><thead><tr><th>VĐV</th><th>Ghi</th><th>Hỏng</th><th>Hiệu suất</th><th>Chắn</th></tr></thead><tbody>${atk}</tbody></table>` : '<p class="hint">Chưa có pha tấn công kết thúc.</p>'}
    <p class="hint">Hỏng = lỗi tấn công + bị chắn. Hiệu suất = (ghi − hỏng) / (ghi + hỏng), chỉ tính pha tấn công kết thúc điểm.</p></section>
  <section class="card"><h2>Phát bóng</h2><p class="big-num">Ace <b data-testid="ace">${st.ace}</b> · Lỗi <b data-testid="se">${st.se}</b></p>
    ${srv ? `<table class="tbl"><thead><tr><th>VĐV</th><th>Ace</th><th>Lỗi</th></tr></thead><tbody>${srv}</tbody></table>` : ''}</section>
  <section class="card"><h2>Nguồn điểm</h2><div class="src">
    <ul class="for"><li class="h">Ta ghi <b data-testid="won">${st.won}</b></li>${src('atk', 'Tấn công')}${src('blk', 'Chắn bóng')}${src('ace', 'Phát bóng ăn điểm')}${src('oer', 'Đối thủ lỗi')}${s.uw ? src('uw', 'Không rõ cách') : ''}</ul>
    <ul class="against"><li class="h">Ta mất <b data-testid="lost">${st.lost}</b></li>${src('aer', 'Lỗi tấn công')}${src('bkd', 'Bị chắn')}${src('ser', 'Lỗi phát bóng')}${src('rer', 'Đỡ hỏng / bị ace')}${src('xer', 'Lỗi khác')}${src('oat', 'Đối thủ tấn công')}${s.ul ? src('ul', 'Không rõ cách') : ''}</ul>
  </div></section>`;
}

function viewCoach() {
  const c = R.cur;
  const setN = ui.coachFilter === 'set' && c ? c.n : null;
  const run = L.currentRun(R.rallies.filter((r) => !c || r.set === c.n));
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/live" data-testid="coach-back">‹ Ghi trận</button><h1>Màn HLV</h1></header>
  <main class="page coach">
    <div class="coachhead">
      <div class="cs"><b>${esc(match.teamName)} ${c ? c.us : 0}–${c ? c.them : 0} ${esc(match.opponent)}</b> · Set ${c ? c.n : 1} · Set thắng ${R.winsUs}–${R.winsThem}</div>
      <div class="cs" data-testid="run">${run.len ? `Chuỗi hiện tại: ${run.side === 'us' ? 'ta' : 'đối thủ'} ${run.len} điểm` : 'Chưa có pha'}</div>
      <div class="seg filt">
        <button data-act="filter" data-f="set" class="${ui.coachFilter === 'set' ? 'on' : ''}" data-testid="f-set">Set này</button>
        <button data-act="filter" data-f="match" class="${ui.coachFilter === 'match' ? 'on' : ''}" data-testid="f-match">Cả trận</button>
      </div>
    </div>
    <div class="cgrid">${coachBlocks(setN, setN != null && c && !c.over)}</div>
  </main>`;
}

// ---------- Tổng kết / lịch sử ----------
function viewSummary(id) {
  const m = id === (match && match.id) ? match : store.loadMatch(id);
  if (!m) return `<header class="top"><button class="back" data-act="nav" data-to="#/history">‹</button><h1>Không tìm thấy trận</h1></header>`;
  const keepM = match, keepR = R;
  match = m; R = L.replay(m);
  const sets = R.sets.map((s) => `<td>${s.us}–${s.them}</td>`).join('');
  const html = `
  <header class="top noprint"><button class="back" data-act="nav" data-to="#/history">‹</button><h1>Tổng kết</h1></header>
  <main class="page summary">
    <h2 class="stitle">${esc(m.teamName)} ${R.winsUs}–${R.winsThem} ${esc(m.opponent)}</h2>
    <p>${X.TYPE_LABEL[m.type]} · ${X.fmtDate(m.date)} · ${R.rallies.length} pha${m.status === 'live' ? ' · <b>đang ghi</b>' : ''}</p>
    <table class="tbl sets"><tr><th>Set</th>${R.sets.map((s) => `<th>${s.n}</th>`).join('')}</tr><tr><th>Tỉ số</th>${sets}</tr></table>
    <div class="actions noprint">
      <button class="btn" data-act="print">In / PDF</button>
      <button class="btn primary" data-act="share" data-id="${m.id}" data-testid="share">Chia sẻ</button>
      <button class="btn" data-act="csv" data-id="${m.id}" data-testid="csv">Xuất CSV</button>
      <button class="btn" data-act="json" data-id="${m.id}" data-testid="json">Xuất JSON</button>
      ${m.status === 'live' ? `<button class="btn" data-act="resume" data-id="${m.id}">Tiếp tục ghi</button>` : ''}
    </div>
    <div class="cgrid">${coachBlocks(null, false)}</div>
  </main>`;
  match = keepM; R = keepR;
  return html;
}
function viewHistory() {
  const list = store.listMatches().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const rows = list.map((x) => `<div class="hrow">
      <button class="hmain" data-act="nav" data-to="#/summary/${esc(x.id)}"><b>${esc(x.opp)}</b><span>${esc(X.fmtDate(String(x.date || '')))} · ${X.TYPE_LABEL[x.type] || ''} · ${esc(x.winsUs)}–${esc(x.winsThem)}${x.status === 'live' ? ' · đang ghi' : ''}</span><small>${esc((x.sets || []).map((s) => s.join('–')).join(', '))}</small></button>
      ${x.status === 'live' ? `<button class="btn-sm" data-act="resume" data-id="${esc(x.id)}">Tiếp tục</button>` : ''}
      <button class="btn-sm danger" data-act="delMatch" data-id="${esc(x.id)}" aria-label="Xoá trận">Xoá</button></div>`).join('');
  return `<header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Lịch sử trận</h1></header>
  <main class="page">${rows || '<p class="hint">Chưa có trận nào.</p>'}</main>`;
}

// ---------- chia sẻ / xuất ----------
async function share(m) {
  const text = X.shareText(m, m.teamName);
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép tổng kết — dán vào Zalo.');
  } catch {
    openSheet('text', { text });
  }
}
function importFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const d = X.parseImport(await inp.files[0].text()); // kiểm hết trước khi ghi
      const have = new Set(store.listMatches().map((x) => x.id));
      const dup = d.matches.filter((m) => have.has(m.id));
      const live = match && d.matches.some((m) => m.id === match.id);
      let list = d.matches;
      if (dup.length && !confirm(`${dup.length} trận trong file đã có trên máy${live ? ' (gồm trận đang ghi)' : ''}. Ghi đè bằng bản trong file?\nChọn Huỷ để chỉ nhập trận mới.`)) {
        list = d.matches.filter((m) => !have.has(m.id));
      }
      list.forEach((m) => store.saveMatch(m, L.replay(m)));
      if (match && list.some((m) => m.id === match.id)) loadCurrent();
      if (d.team && confirm('File có danh sách đội. Thay đội hiện tại bằng đội trong file?')) { team = d.team; store.saveTeam(team); }
      toast(`Đã nhập ${list.length} trận.`);
      render();
    } catch (e) {
      alert('Không nhập được: ' + e.message);
    }
  };
  inp.click();
}

// Ưu tiên bản trong bộ nhớ: vẫn xuất được khi máy không cho lưu.
const byId = (id) => (match && match.id === id ? match : store.loadMatch(id));

// ---------- sự kiện ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = el.dataset.act;
  const d = el.dataset;
  switch (a) {
    case 'nav': closeSheet(); go(d.to); break;
    case 'how': onHow(d.how); break;
    case 'pickP': commitRally(ui.pickHow, d.pid || null); break;
    case 'closeSheet': closeSheet(); break;
    case 'more': openSheet('more'); break;
    case 'openSheet': openSheet(d.s, { chk: null }); break;
    case 'undo': undo(); break;
    case 'rc': match.events[ui.recvFor].rc = +d.rc; save(); break;
    case 'rp': match.events[ui.recvFor].rp = d.rp; save(); break;
    case 'timeout':
      closeSheet();
      push({ t: 'to', side: d.side });
      ui.coachFilter = 'set';
      go('#/coach');
      break;
    case 'startSet': openSheet('startSet'); break;
    case 'fix':
      push(d.rot ? { t: 'fix', rot: +d.rot } : { t: 'fix', serve: d.serve });
      renderSheet();
      toast('Đã chỉnh. Có thể hoàn tác.');
      break;
    case 'fixPoint': ui.recvFor = null; push({ t: 'r', how: d.how, p: null }); closeSheet(); toast('Đã thêm điểm không rõ cách.', true); break;
    case 'endSet':
      if (confirm(`Kết thúc set ${R.cur.n} với tỉ số ${R.cur.us}–${R.cur.them}?`)) { closeSheet(); push({ t: 'endset' }); }
      break;
    case 'endMatch':
      if (confirm('Kết thúc trận? (Có thể hoàn tác)')) { closeSheet(); push({ t: 'endmatch' }); }
      break;
    case 'filter': ui.coachFilter = d.f; render(); break;
    case 'edit': openSheet('edit', { editIdx: +d.i }); break;
    case 'editHow': {
      const ev = match.events[ui.editIdx];
      const h = L.HOW[d.how];
      ev.how = d.how;
      if (h.who === 'none') ev.p = null;
      if (h.who === 'server') { const rec = R.rallies.find((r) => r.i === ui.editIdx); if (rec && rec.server) ev.p = rec.server; }
      save();
      break;
    }
    case 'editP': match.events[ui.editIdx].p = d.pid || null; save(); break;
    case 'editRc': match.events[ui.editIdx].rc = d.rc === '' ? null : +d.rc; save(); break;
    case 'delEvent':
      if (confirm('Xoá pha này? Tỉ số và xoay vòng phía sau sẽ tính lại.')) {
        match.events.splice(ui.editIdx, 1);
        ui.recvFor = null;
        closeSheet();
        save();
      }
      break;
    case 'delIgnored': if (confirm('Xoá sự kiện này?')) { match.events.splice(+d.i, 1); save(); } break;
    case 'addPlayer': {
      const num = Math.max(0, ...team.players.map((p) => p.num)) + 1;
      team.players.push({ id: 'p' + store.uid(), num, name: '', pos: '' });
      saveTeam(); render();
      break;
    }
    case 'delPlayer': {
      const p = team.players[+d.i];
      if (confirm(`Xoá VĐV số ${p.num}?`)) { team.players.splice(+d.i, 1); saveTeam(); render(); }
      break;
    }
    case 'print': window.print(); break;
    case 'share': share(byId(d.id)); break;
    case 'csv': {
      const m = byId(d.id);
      X.download(`scout_${X.slug(m.opponent)}_${m.date}.csv`, X.toCSV(m), 'text/csv;charset=utf-8');
      break;
    }
    case 'json': {
      const m = byId(d.id);
      X.download(`scout_${X.slug(m.opponent)}_${m.date}.json`, JSON.stringify(X.backup(null, [m]), null, 1), 'application/json');
      break;
    }
    case 'backup': {
      const all = store.listMatches().map((x) => store.loadMatch(x.id)).filter(Boolean);
      X.download(`scout_saoluu_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(X.backup(team, all), null, 1), 'application/json');
      break;
    }
    case 'import': importFile(); break;
    case 'resume': store.setCurrent(d.id); loadCurrent(); ui.recvFor = null; go('#/live'); break;
    case 'delMatch':
      if (confirm('Xoá vĩnh viễn trận này khỏi máy?')) {
        store.deleteMatch(d.id);
        if (match && match.id === d.id) { match = null; R = null; }
        render();
      }
      break;
  }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'setup') submitSetup(f);
  else if (f.id === 'subForm') {
    const out = f.elements.out.value, inn = f.elements.in.value;
    if (!inn) return;
    closeSheet();
    push({ t: 'sub', out, in: inn });
    toast(`Thay người: ${L.playerLabel(match, inn)} vào, ${L.playerLabel(match, out)} ra.`, true);
  } else if (f.id === 'setForm') {
    const lu = readLineup(f);
    if (lu.err) return ($('#setErr').textContent = lu.err);
    closeSheet();
    push({ t: 'start', lineup: lu.lineup, libero: lu.libero, server: f.elements.server.value });
  } else if (f.id === 'chkForm') {
    const us = +f.elements.us.value, them = +f.elements.them.value;
    const c = R.cur;
    const ok = us === c.us && them === c.them;
    ui.chk = { ok, us, them, appUs: c.us, appThem: c.them };
    push({ t: 'chk', us, them, ok });
  }
});

for (const t of ['input', 'change']) {
  document.addEventListener(t, (e) => {
    if (e.target.dataset.field && document.body.dataset.route === 'team') onTeamInput(e.target);
  });
}

// Giữ màn hình sáng khi đang ghi trận.
let lock = null;
async function wake(on) {
  try {
    if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => wake(document.body.dataset.route === 'live'));

// ---------- khởi động ----------
try {
  loadCurrent();
} catch (e) {
  match = null; R = null; // dữ liệu trận hỏng: vẫn mở được app, trận khác không ảnh hưởng
}
try {
  render();
} catch (e) {
  match = null; R = null;
  location.hash = '#/';
  render();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* bỏ qua */ }
