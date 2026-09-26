// Giao diện. Mọi thay đổi dữ liệu đi qua push()/save() → tính lại từ nhật ký → lưu → vẽ lại.
import * as L from './logic.js';
import * as store from './store.js';
import * as X from './export.js';
import * as AI from './ai.js';
import * as V from './video.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const sheetEl = $('#sheet');

let team = null; // nạp lúc khởi động (cần DATA.roster cho lần mở đầu tiên)
let match = null; // trận đang mở (đang ghi hoặc vừa xong)
let R = null; // kết quả replay(match)
const ui = { coachFilter: 'set', recvFor: null, sheet: null, pickHow: null, editIdx: null, chk: null, editPid: null, luSel: null };
// Dữ liệu tĩnh đi kèm app (service worker cache sẵn → dùng được khi offline).
const DATA = { roster: null, opp: null };
async function loadJSON(path) {
  try { const r = await fetch(path); return r.ok ? await r.json() : null; } catch { return null; }
}

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
  else if (route === 'video') html = viewVideo(arg);
  else if (route === 'opp') html = viewOpp(arg);
  else html = viewHome();
  const warn = store.lastError
    ? `<div class="banner" role="alert">Không lưu được vào máy (${esc(store.lastError.name)}). Hãy xuất JSON ngay để tránh mất dữ liệu.</div>` : '';
  app.innerHTML = warn + html;
  if (route === 'video') mountPlayer();
  drawLineup();
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
      <button class="btn" data-act="nav" data-to="#/video" data-testid="home-video">Xem lại video</button>
      <button class="btn" data-act="nav" data-to="#/opp" data-testid="home-opp">Hồ sơ đối thủ</button>
    </div>
    <div class="row2">
      <button class="btn" data-act="import">Nhập dữ liệu (JSON)</button>
      <button class="btn" data-act="backup">Sao lưu toàn bộ</button>
    </div>
    <p class="hint">Dữ liệu chỉ nằm trên máy này. Sao lưu JSON sau mỗi trận.</p>
  </main>`;
}

// ---------- Đội ----------
const POS_ORDER = ['S', 'OH', 'OP', 'MB', 'L', ''];
const POS_NAME = Object.fromEntries(L.POSITIONS.map(([k, v]) => [k, k ? v : 'Chưa rõ vị trí']));
const posChip = (pos) => `<span class="poschip pos-${pos || 'X'}">${POS_NAME[pos || '']}</span>`;
// Dấu "?" cạnh trường nguồn công khai chưa khớp nhau (p.unv = ['name'|'pos'|…]).
const qmark = (p, f) => ((p.unv || []).includes(f) ? `<span class="q" title="${esc(p.note || 'Chưa xác minh')}" data-testid="q-${p.num}-${f}">?</span>` : '');
const fmtH = (h) => (Number.isFinite(h) && h > 0 ? `${L.dec(h, 2)} m` : '');

function presetTeam() {
  const r = DATA.roster;
  if (!r || !Array.isArray(r.players)) return null;
  return {
    name: r.team, preset: r.label,
    players: r.players.map((p) => ({ id: p.id, num: p.num, name: p.name, pos: p.pos, h: p.h, ...(p.unv ? { unv: p.unv, note: p.note } : {}) })),
  };
}

function viewTeam() {
  const card = (p) => `<button class="pcard" data-act="editPlayer" data-pid="${esc(p.id)}" data-testid="pc-${esc(p.id)}">
      <span class="pc-num">${p.num}</span>
      <span class="pc-main"><span class="pc-name">${p.name ? esc(p.name) : '<i>Chưa có tên</i>'}${qmark(p, 'name')}</span>
        <span class="pc-sub">${posChip(p.pos)}${qmark(p, 'pos')}<span class="pc-h">${fmtH(p.h)}</span></span></span>
    </button>`;
  const groups = POS_ORDER.map((k) => {
    const ps = team.players.filter((p) => (p.pos || '') === k).sort((a, b) => a.num - b.num);
    return ps.length ? `<section class="pgroup"><h2>${POS_NAME[k]} <small>${ps.length}</small></h2><div class="pcards">${ps.map(card).join('')}</div></section>` : '';
  }).join('');
  const unvN = team.players.filter((p) => p.unv && p.unv.length).length;
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Đội của tôi</h1>
    <button class="btn-sm" data-act="editPlayer" data-pid="" data-testid="add-player">+ Thêm VĐV</button></header>
  <main class="page team">
    <div class="teamhead">
      <button class="teamname" data-act="openSheet" data-s="teamName" data-testid="team-name"><b>${esc(team.name)}</b><small>${team.players.length} VĐV · bấm để đổi tên đội</small></button>
      ${team.preset ? `<span class="srcbadge" data-testid="src-badge">${esc(team.preset)}</span>` : ''}
    </div>
    ${unvN ? `<p class="hint">Dấu <span class="q">?</span> = hai nguồn công khai ghi khác nhau (${unvN} VĐV). Bấm vào VĐV để xem và sửa.</p>` : ''}
    ${groups || '<p class="hint">Chưa có VĐV nào.</p>'}
    <p class="hint">Bấm vào VĐV để sửa số áo, tên, vị trí, chiều cao. Xoay vòng P1–P6 tính theo vị trí của <b>chuyền hai</b>.</p>
    ${DATA.roster ? '<button class="btn" data-act="presetLP" data-testid="preset-lp">Nạp lại danh sách LPBank Ninh Bình (nguồn công khai)</button>' : ''}
  </main>`;
}
function playerSheet() {
  const p = team.players.find((x) => x.id === ui.editPid) || null;
  const v = p || { num: Math.max(0, ...team.players.map((x) => x.num)) + 1, name: '', pos: '', h: null };
  return `<h3>${p ? `Sửa VĐV số ${p.num}` : 'Thêm VĐV'}</h3>
    ${p && p.unv ? `<p class="warnline" data-testid="pf-note">Chưa xác minh: ${esc(p.note || '')} Lưu = HLV đã kiểm.</p>` : ''}
    <form id="playerForm" class="form">
      <div class="row2">
        <label class="field">Số áo<input name="num" type="number" inputmode="numeric" min="0" max="99" required value="${v.num}" data-testid="pf-num"></label>
        <label class="field">Chiều cao (m)<input name="h" type="text" inputmode="decimal" placeholder="1,75" value="${Number.isFinite(v.h) && v.h > 0 ? L.dec(v.h, 2) : ''}" data-testid="pf-h"></label>
      </div>
      <label class="field">Tên<input name="name" type="text" maxlength="40" value="${esc(v.name)}" placeholder="Họ tên" data-testid="pf-name"></label>
      <div class="field">Vị trí ${radio('pos', v.pos || '', L.POSITIONS.map(([k]) => [k, POS_NAME[k]]))}</div>
      <p class="err" id="pfErr" role="alert"></p>
      <div class="row2"><button class="btn primary" type="submit" data-testid="pf-ok">Lưu</button><button class="btn" type="button" data-act="closeSheet">Huỷ</button></div>
      ${p ? `<button class="btn danger wide" type="button" data-act="delPlayer" data-pid="${esc(p.id)}" data-testid="pf-del">Xoá VĐV này</button>` : ''}
    </form>`;
}
function submitPlayer(f) {
  const num = parseInt(f.elements.num.value, 10);
  const hs = f.elements.h.value.trim().replace(',', '.');
  const h = hs ? parseFloat(hs) : null;
  const err = $('#pfErr');
  if (!(num >= 0 && num <= 99)) return (err.textContent = 'Số áo từ 0 đến 99.');
  if (hs && !(h >= 1 && h <= 2.5)) return (err.textContent = 'Chiều cao ghi theo mét, ví dụ 1,75.');
  if (team.players.some((x) => x.num === num && x.id !== ui.editPid)) return (err.textContent = `Đã có VĐV số ${num}.`);
  const val = { num, name: f.elements.name.value.trim(), pos: f.elements.pos.value, h };
  const p = team.players.find((x) => x.id === ui.editPid);
  if (p) { Object.assign(p, val); delete p.unv; delete p.note; } else team.players.push({ id: 'p' + store.uid(), ...val });
  saveTeam();
  closeSheet();
  render();
}
function saveTeam() {
  store.saveTeam(team);
  // Đồng bộ tên/số/vị trí sang trận đang ghi (giữ nguyên id nên nhật ký không lệch).
  if (match && match.status === 'live') {
    for (const p of team.players) {
      const q = P(p.id);
      if (q) Object.assign(q, p);
      // VĐV mới vào dự bị — trừ khi trùng số áo với người đã có trong trận (vd sau khi nạp lại danh sách giữa trận).
      else if (!match.players.some((x) => x.num === p.num)) match.players.push({ ...p });
    }
    match.teamName = team.name;
    R = L.replay(match);
    store.saveMatch(match, R);
  }
}

// ---------- Thiết lập trận ----------
// Đội hình: 7 ô bấm (P1–P6 + libero) + hàng dự bị. Chạm một ô rồi chạm ô khác để đổi chỗ,
// hoặc chạm ô rồi chạm VĐV dự bị để thay. Giá trị nằm trong input ẩn p1..p6/libero của form.
function lineupFields(lineup, libero, note = '') {
  return `<div class="luw" data-testid="lineup">
    ${[1, 2, 3, 4, 5, 6].map((z) => `<input type="hidden" name="p${z}" value="${esc(lineup[z - 1] || '')}" data-testid="lu-p${z}">`).join('')}
    <input type="hidden" name="libero" value="${esc(libero || '')}" data-testid="lu-libero">
    ${note ? `<p class="hint" data-testid="lu-why">${note}</p>` : ''}
    <div class="luslots"></div></div>`;
}
const luPool = () => (ui.sheet === 'startSet' ? match.players : team.players);
function drawLineup() {
  const w = $('.luw');
  if (!w) return;
  const f = w.closest('form');
  const pool = luPool();
  const byId = (id) => pool.find((p) => p.id === id);
  const face = (id) => {
    const p = byId(id);
    return p ? `<span class="pnum">${p.num}</span><span class="pname">${esc(p.name || '')}</span>${p.pos ? posChip(p.pos) : ''}` : '<span class="pname">—</span>';
  };
  const slot = (s, label) => `<button type="button" class="luslot ${ui.luSel === s ? 'sel' : ''}" data-act="luTap" data-slot="${s}" data-testid="slot-${s}"><span class="zl">${label}</span>${face(f.elements[s].value)}</button>`;
  const inUse = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'libero'].map((s) => f.elements[s].value));
  const bench = pool.filter((p) => !inUse.has(p.id)).map((p) => `<button type="button" class="pchip ${ui.luSel === 'b:' + p.id ? 'on' : ''}" data-act="luTap" data-bench="${esc(p.id)}" data-testid="bench-${esc(p.id)}"><span class="pnum">${p.num}</span><span class="pname">${esc(p.name || L.POS_SHORT[p.pos] || '')}</span></button>`).join('');
  w.querySelector('.luslots').innerHTML = `
    <div class="lineup"><div class="net">LƯỚI</div>${[4, 3, 2, 5, 6, 1].map((z) => slot('p' + z, 'P' + z)).join('')}</div>
    <div class="lulib">${slot('libero', 'Libero')}${ui.luSel === 'libero' && f.elements.libero.value ? '<button type="button" class="pchip" data-act="luTap" data-bench="-" data-testid="bench-none">Không có libero</button>' : ''}</div>
    <div class="bench"><div class="hint">${ui.luSel ? 'Chạm ô hoặc VĐV để đổi chỗ' : 'Dự bị — chạm một ô rồi chạm ô khác / VĐV dự bị để đổi'}</div><div class="chips">${bench || '<span class="hint">Không còn ai</span>'}</div></div>`;
}
function luTap(d) {
  const f = $('.luw').closest('form');
  const put = (s, v) => (f.elements[s].value = v);
  const sel = ui.luSel;
  if (d.slot) {
    if (!sel || sel === d.slot) ui.luSel = sel === d.slot ? null : d.slot;
    else if (sel.startsWith('b:')) { put(d.slot, sel.slice(2)); ui.luSel = null; }
    else { const a = f.elements[sel].value; put(sel, f.elements[d.slot].value); put(d.slot, a); ui.luSel = null; }
  } else if (d.bench === '-') {
    put('libero', ''); ui.luSel = null;
  } else if (sel && !sel.startsWith('b:')) {
    put(sel, d.bench); ui.luSel = null;
  } else {
    ui.luSel = sel === 'b:' + d.bench ? null : 'b:' + d.bench;
  }
  drawLineup();
}
function readLineup(form) {
  const lineup = [1, 2, 3, 4, 5, 6].map((z) => form.elements['p' + z].value);
  const libero = form.elements.libero.value || null;
  if (!lineup.every(Boolean)) return { err: 'Còn ô trống trong P1–P6: cần đủ 6 VĐV (thêm VĐV ở "Đội của tôi").' };
  if (new Set(lineup).size !== 6) return { err: 'Đội hình P1–P6 phải là 6 VĐV khác nhau.' };
  if (libero && lineup.includes(libero)) return { err: 'Libero không được nằm trong 6 VĐV xuất phát.' };
  return { lineup, libero };
}
function radio(name, val, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
}
// Giải VĐQG trong data/opponents.json, bỏ chính đội mình.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const leagueTeams = () => ((DATA.opp && DATA.opp.league && DATA.opp.league.teams) || []).filter((t) => norm(t.name) !== norm(team.name));
const briefById = (id) => ((DATA.opp && DATA.opp.teams) || []).find((t) => t.id === id) || null;
function oppInfo(name) {
  const lt = leagueTeams().find((t) => t.name === name);
  if (!lt) return '';
  const b = lt.id ? briefById(lt.id) : null;
  if (!b) return '<p class="hint">Chưa có hồ sơ cho đội này.</p>';
  const ps = b.players.slice(0, 5).map((p) => `${p.num != null ? '#' + p.num + ' ' : ''}${esc(p.name)}${p.pos ? ' (' + esc(p.pos) + ')' : ''}`).join(' · ');
  return `<div class="oppinfo"><div>${b.coach ? `HLV ${esc(b.coach)}` : ''}${ps ? `${b.coach ? ' · ' : ''}Cầu thủ có nguồn: ${ps}` : ''}</div>
    <button type="button" class="btn-sm" data-act="oppSheet" data-id="${esc(b.id)}" data-testid="opp-brief">Xem hồ sơ đối thủ (${b.tendencies.length} nhận xét)</button></div>`;
}
function viewSetup() {
  const sg = L.suggestLineup(team.players);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const lg = leagueTeams();
  ui.luSel = null;
  return `
  <header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Trận mới</h1></header>
  <main class="page setup">
    <form id="setup" class="form">
      <div class="field">Loại trận ${radio('type', 'official', [['practice', 'Đấu tập'], ['official', 'Chính thức']])}</div>
      ${lg.length ? `<label class="field">Đối thủ<select name="oppPick" data-testid="opp-pick"><option value="">— Chọn đối thủ —</option>
        ${lg.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}<option value="__other">Đội khác…</option></select></label>` : ''}
      <label class="field" id="oppOther" ${lg.length ? 'hidden' : ''}>${lg.length ? 'Tên đội khác' : 'Đối thủ'}<input name="opp" type="text" maxlength="60" placeholder="Tên đội bạn" data-testid="opp"></label>
      <div id="oppInfo" data-testid="opp-info"></div>
      <label class="field">Ngày<input name="date" type="date" value="${today}"></label>
      <div class="field">Thể thức ${radio('bestOf', '5', [['5', '5 set (thắng 3)'], ['3', '3 set (thắng 2)']])}</div>
      <div class="field">Đội hình xuất phát set 1</div>
      ${lineupFields(sg.lineup, sg.libero, 'Đề xuất đội hình 5-1 theo vị trí đã khai: chuyền hai P1, chủ công P2/P5, phụ công P3/P6, đối chuyền P4.')}
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
  const pick = form.elements.oppPick ? form.elements.oppPick.value : '__other';
  const opp = pick && pick !== '__other' ? pick : form.elements.opp.value.trim();
  if (!opp) return (err.textContent = 'Chọn đối thủ hoặc nhập tên đội khác.');
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
      <form id="setForm" class="form">${lineupFields(prev.lineup, prev.libero)}
        <div class="field">Phát bóng trước ${radio('server', L.defaultServer(match, R), [['us', esc(match.teamName)], ['them', 'Đối thủ']])}</div>
        <p class="err" id="setErr"></p>
        <div class="row2"><button class="btn primary" type="submit" data-testid="set-ok">Bắt đầu</button><button class="btn" type="button" data-act="closeSheet">Huỷ</button></div></form>`;
  } else if (s === 'edit') {
    inner = editSheet();
  } else if (s === 'ai') {
    inner = aiSheet();
  } else if (s === 'player') {
    inner = playerSheet();
  } else if (s === 'teamName') {
    inner = `<h3>Tên đội</h3><form id="teamNameForm" class="form"><label class="field">Tên đội<input name="name" type="text" maxlength="60" required value="${esc(team.name)}" data-testid="tn-input"></label>
      <div class="row2"><button class="btn primary" type="submit" data-testid="tn-ok">Lưu</button><button class="btn" type="button" data-act="closeSheet">Huỷ</button></div></form>`;
  } else if (s === 'opp') {
    const b = briefById(ui.oppId);
    inner = (b ? `<p class="srcnote" data-testid="opp-sheet-label"><b>${esc(DATA.opp.label)}</b></p>` + teamBrief(b, true) : '<p>Không tìm thấy hồ sơ.</p>') + '<button class="btn wide" data-act="closeSheet">Đóng</button>';
  } else if (s === 'text') {
    inner = `<h3>Văn bản tổng kết</h3><p class="hint">Chọn tất cả rồi sao chép vào Zalo.</p><textarea readonly rows="12">${esc(ui.text)}</textarea><button class="btn" data-act="closeSheet">Đóng</button>`;
  }
  sheetEl.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-body" role="dialog" aria-modal="true">${inner}</div>`;
  sheetEl.hidden = false;
  if (s === 'startSet') drawLineup();
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
    return `<button class="rrow ign" data-act="${ev.t === 'r' ? 'edit' : 'delIgnored'}" data-i="${i}">Bị bỏ qua: ${ev.t === 'r' ? L.HOW[ev.how].label : esc(ev.t)} — bấm để ${ev.t === 'r' ? 'sửa/xoá' : 'xoá'}</button>`;
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
  <header class="top"><button class="back" data-act="nav" data-to="#/live" data-testid="coach-back">‹ Ghi trận</button><h1>Màn HLV</h1><button class="btn-sm" data-act="ai" data-id="${match.id}" data-set="${setN || ''}" data-testid="ai-coach">Hỏi AI</button></header>
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
      <button class="btn" data-act="ai" data-id="${m.id}" data-set="" data-testid="ai-summary">Hỏi AI</button>
      <button class="btn" data-act="nav" data-to="#/video/${m.id}" data-testid="summary-video">Xem lại video</button>
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

// ---------- Hỏi AI (không gọi API: sao chép rồi dán vào trang AI) ----------
function aiSheet() {
  const m = byId(ui.aiId);
  if (!m) return '<p>Không tìm thấy trận.</p><button class="btn" data-act="closeSheet">Đóng</button>';
  const R2 = L.replay(m);
  if (ui.aiSet && !R2.sets[ui.aiSet - 1]) ui.aiSet = null;
  ui.aiText = AI.aiPrompt(m, ui.aiSet);
  const opts = [['', 'Cả trận'], ...R2.sets.map((s) => [String(s.n), `Set ${s.n} (${s.us}–${s.them})`])];
  return `<h3>Hỏi AI về ${ui.aiSet ? 'set ' + ui.aiSet : 'cả trận'}</h3>
    <p class="hint">App không gửi dữ liệu đi đâu. Bấm <b>Sao chép</b>, mở một trang AI bên dưới rồi dán vào ô chat. Kết quả AI chỉ để tham khảo — đối chiếu với màn HLV.</p>
    <label class="field">Phạm vi<select data-ai="scope" data-testid="ai-scope">${opts.map(([v, l]) => `<option value="${v}" ${String(ui.aiSet || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <textarea readonly rows="9" data-testid="ai-prompt">${esc(ui.aiText)}</textarea>
    <p class="hint" data-testid="ai-len">${ui.aiText.length.toLocaleString('vi-VN')} ký tự</p>
    <div class="row2"><button class="btn primary" data-act="aiCopy" data-testid="ai-copy">Sao chép</button><button class="btn" data-act="closeSheet">Đóng</button></div>
    <div class="aisites">${AI.AI_SITES.map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener noreferrer" data-testid="ai-open-${n.toLowerCase()}">Mở ${n}</a>`).join('')}</div>`;
}
async function aiCopy() {
  try {
    await navigator.clipboard.writeText(ui.aiText);
  } catch {
    const ta = $('[data-testid=ai-prompt]');
    ta.select();
    if (!document.execCommand('copy')) return toast('Không sao chép được — giữ ngón tay trên ô chữ để chọn và sao chép.');
  }
  toast('Đã sao chép — mở trang AI rồi dán.');
}

// ---------- Hồ sơ đối thủ (dữ liệu tĩnh data/opponents.json) ----------
function teamBrief(t, open) {
  const vids = (DATA.opp && DATA.opp.videos) || {};
  const ps = t.players.map((p) => `<li>${p.num != null ? `<b>#${p.num}</b> ` : ''}${esc(p.name)}${p.pos ? ` — ${esc(p.pos)}` : ''}${p.note ? ` <small>(${esc(p.note)})</small>` : ''}</li>`).join('');
  const td = t.tendencies.map((x) => {
    const v = vids[x.v] || {};
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(x.v)}&t=${Math.max(0, parseInt(x.t, 10) || 0)}s`;
    return `<li><span class="tag">${esc(x.skill)}</span> ${esc(x.text)}
      <a class="yt" href="${url}" title="${esc(v.title || '')}" target="_blank" rel="noopener noreferrer" data-testid="opp-link">▶ ${V.fmtTime(x.t)} · video ${v.date ? X.fmtDate(v.date) : esc(x.v)}</a></li>`;
  }).join('');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const srcs = t.sources.filter((u) => /^https?:\/\//i.test(u)); // chỉ link web — chặn javascript:/data:
  return `<details class="card oppteam" data-testid="opp-team" data-id="${esc(t.id)}" ${open ? 'open' : ''}>
    <summary><b>${esc(t.name)}</b><small>${t.coach ? 'HLV ' + esc(t.coach) + ' · ' : ''}${t.tendencies.length} nhận xét · độ tin cậy ${esc(t.confidence)}</small></summary>
    <p>${esc(t.summary)}</p>
    <h3>Cầu thủ có nguồn</h3>${ps ? `<ul class="opl">${ps}</ul>` : '<p class="hint">Chưa có danh sách cầu thủ từ báo/Wikipedia.</p>'}
    <h3>Xu hướng theo bình luận viên</h3>${td ? `<ul class="otd">${td}</ul>` : '<p class="hint">Chưa có video phân tích lối chơi.</p>'}
    ${srcs.length ? `<p class="hint">Nguồn: ${srcs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join(', ')}</p>` : ''}
  </details>`;
}
function viewOpp(id) {
  const d = DATA.opp;
  const head = `<header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Hồ sơ đối thủ</h1></header>`;
  if (!d) return head + '<main class="page"><p class="err">Chưa tải được dữ liệu hồ sơ (cần mở app có mạng ít nhất một lần).</p></main>';
  return `${head}<main class="page opp">
    <p class="srcnote" data-testid="opp-label"><b>${esc(d.label)}</b> · cập nhật ${X.fmtDate(d.generated)}</p>
    <p class="hint">${esc(d.method)} Mở link YouTube cần có mạng.</p>
    ${d.teams.map((t, i) => teamBrief(t, id ? t.id === id : i === 0)).join('')}
  </main>`;
}

// ---------- Xem lại video: khớp pha đã ghi với video trên máy / YouTube ----------
// Trình phát nằm ngoài vòng vẽ lại (vid.el giữ nguyên) để đổi bộ lọc không làm dừng video.
const vid = { el: null, kind: null, url: null, yt: null, f: { res: '', p: '', rot: '' }, now: null };
function vMatch(id) {
  const want = id || (match && match.id) || (store.listMatches()[0] || {}).id;
  return want ? byId(want) : null;
}
function viewVideo(id) {
  const m = vMatch(id);
  const list = store.listMatches();
  if (m && !list.some((x) => x.id === m.id)) list.unshift({ id: m.id, opp: m.opponent, date: m.date });
  const head = `<header class="top"><button class="back" data-act="nav" data-to="#/">‹</button><h1>Xem lại video</h1></header>`;
  if (!m) return head + '<main class="page"><p class="hint">Chưa có trận nào để xem lại.</p></main>';
  vid.id = m.id;
  const sync = store.loadVideoSync(m.id);
  vid.off = sync.offset;
  const pl = m.players.slice().sort((a, b) => a.num - b.num);
  const sel = (k, opts) => `<select data-vf="${k}" data-testid="vf-${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${vid.f[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `${head}<main class="page video">
    <label class="field">Trận<select data-vf="match" data-testid="v-match">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${esc(x.opp || 'Đối thủ')} · ${esc(X.fmtDate(String(x.date || '')))}</option>`).join('')}</select></label>
    <div class="vsrc">
      <label class="btn filebtn">Chọn video trên máy<input type="file" accept="video/*" data-testid="v-file"></label>
      <form id="ytForm" class="ytform"><input name="yt" type="url" inputmode="url" placeholder="hoặc dán link YouTube" value="${esc(sync.yt)}" data-testid="v-yt"><button class="btn" type="submit" data-testid="v-yt-ok">Mở</button></form>
    </div>
    <div id="vplayer"></div>
    <form id="syncForm" class="syncform">
      <label class="field">Pha đầu tiên bắt đầu ở (phút:giây)<input name="off" type="text" inputmode="numeric" placeholder="12:34 · âm nếu quay muộn: -0:30" value="${vid.off != null ? V.fmtTime(vid.off) : ''}" data-testid="v-off"></label>
      <div class="row2"><button class="btn primary" type="submit" data-testid="v-off-ok">Đặt mốc</button><button class="btn" type="button" data-act="vNow" data-testid="v-now">Lấy lúc đang phát</button></div>
    </form>
    <p class="hint">Bấm một pha để tua tới đó (sớm ${V.LEAD} giây). Giờ mỗi pha lấy từ lúc scout bấm ghi, nên chỉ khớp khi trận được ghi trực tiếp.</p>
    <div class="vfilt">
      ${sel('res', [['', 'Mọi kết quả'], ['w', 'Ta ghi điểm'], ['l', 'Ta mất điểm']])}
      ${sel('p', [['', 'Mọi VĐV'], ...pl.map((p) => [p.id, `#${p.num} ${p.name || L.POS_SHORT[p.pos] || ''}`])])}
      ${sel('rot', [['', 'Mọi xoay vòng'], ...[1, 2, 3, 4, 5, 6].map((k) => ['P' + k, 'Xoay vòng P' + k])])}
    </div>
    <div id="vlist" class="rlist">${vListHtml()}</div>
  </main>`;
}
function vListHtml() {
  const m = byId(vid.id);
  const all = V.videoRallies(m, vid.off);
  const rows = V.filterRallies(all, vid.f);
  const nm = (pid) => esc(L.playerLabel(m, pid));
  return `<p class="hint" data-testid="v-count">${rows.length}/${all.length} pha${vid.off == null ? ' · chưa đặt mốc nên chưa tua được' : ''}</p>` + rows.map((r) => `
    <button class="rrow ${r.win ? 'w' : 'l'} ${vid.now === r.i ? 'now' : ''}" data-act="vSeek" data-i="${r.i}" data-sec="${r.sec ?? ''}" data-testid="v-rally-${r.set}-${r.no}" ${r.sec == null ? 'disabled' : ''}>
      <span class="rs">S${r.set} #${r.no}</span><span class="rsc">${r.usA}–${r.themA}</span>
      <span class="rh">${L.HOW[r.how].label}${r.p ? ' · ' + nm(r.p) : ''}</span>
      <span class="rx">${r.rot} · ${r.serve === 'us' ? 'ta phát' : 'đối phát'}${r.sec != null ? ` · <b>▶ ${V.fmtTime(r.sec)}</b>` : ''}</span>
    </button>`).join('');
}
const vRedrawList = () => { const el = $('#vlist'); if (el) el.innerHTML = vListHtml(); };
function mountPlayer() {
  if (!vid.el) { vid.el = document.createElement('div'); vid.el.className = 'vplayer'; vid.el.dataset.testid = 'v-player'; }
  const slot = $('#vplayer');
  if (slot) slot.replaceWith(vid.el);
  if (!vid.kind) vid.el.innerHTML = '<p class="hint">Chưa mở video.</p>';
}
function vOpenFile(file) {
  if (!file) return;
  if (vid.url) URL.revokeObjectURL(vid.url);
  vid.url = URL.createObjectURL(file); // chỉ đọc trên máy, không tải lên đâu
  vid.kind = 'file';
  vid.el.innerHTML = `<video controls playsinline preload="metadata" src="${vid.url}" data-testid="v-video"></video><p class="hint">${esc(file.name)}</p>`;
}
function ytFrame(sec, auto) {
  if (!navigator.onLine) {
    vid.el.innerHTML = '<p class="err" data-testid="v-offline">Đang mất mạng: YouTube cần có mạng. Video trên máy vẫn xem được khi offline.</p>';
    return;
  }
  vid.el.innerHTML = `<iframe src="${V.ytEmbed(vid.yt, sec, auto)}" title="Video YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen data-testid="v-iframe"></iframe>`;
}
function vOpenYT(url) {
  const id = V.ytId(url);
  if (!id) return toast('Link YouTube không hợp lệ.');
  vid.kind = 'yt'; vid.yt = id;
  store.saveVideoSync(vid.id, { offset: vid.off, yt: url.trim() });
  ytFrame(vid.off != null ? Math.max(0, vid.off - V.LEAD) : 0, false);
}
function vSetOffset(txt) {
  const sec = V.parseTime(txt);
  if (sec == null) return toast('Nhập mốc dạng phút:giây, ví dụ 12:34.');
  vid.off = sec;
  store.saveVideoSync(vid.id, { offset: sec, yt: store.loadVideoSync(vid.id).yt });
  $('[data-testid=v-off]').value = V.fmtTime(sec);
  vRedrawList();
  toast(`Đã đặt mốc: pha đầu tiên ở ${V.fmtTime(sec)}.`);
}
function vNow() {
  const v = vid.el && vid.el.querySelector('video');
  if (!v) return toast('Chỉ lấy được thời điểm khi đang xem video trên máy. Với YouTube, nhập phút:giây.');
  vSetOffset(V.fmtTime(v.currentTime));
}
function vSeek(i) {
  const r = V.videoRallies(byId(vid.id), vid.off).find((x) => x.i === i);
  if (!r || r.sec == null) return;
  vid.now = i;
  if (vid.kind === 'file') {
    const v = vid.el.querySelector('video');
    v.currentTime = r.sec;
    const p = v.play();
    if (p) p.catch(() => {});
  } else if (vid.kind === 'yt') ytFrame(r.sec, true);
  else toast('Chọn video trên máy hoặc dán link YouTube trước.');
  vRedrawList();
}
function vFilter(k, v) {
  if (k === 'match') {
    // Trận khác = video khác: gỡ video/YouTube đang mở và bộ lọc VĐV của trận cũ.
    if (vid.url) URL.revokeObjectURL(vid.url);
    Object.assign(vid, { now: null, kind: null, url: null, yt: null, f: { res: '', p: '', rot: '' } });
    if (vid.el) vid.el.innerHTML = '';
    return go('#/video/' + v);
  }
  vid.f[k] = v;
  vRedrawList();
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
    case 'startSet': openSheet('startSet', { luSel: null }); break;
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
    case 'editPlayer': openSheet('player', { editPid: d.pid || null }); break;
    case 'delPlayer': {
      const p = team.players.find((x) => x.id === d.pid);
      if (p && confirm(`Xoá VĐV số ${p.num}${p.name ? ' ' + p.name : ''}?`)) { team.players = team.players.filter((x) => x !== p); saveTeam(); closeSheet(); render(); }
      break;
    }
    case 'presetLP': {
      const t = presetTeam();
      if (t && confirm(`Thay danh sách hiện tại (${team.players.length} VĐV) bằng ${t.players.length} VĐV LPBank Ninh Bình từ nguồn công khai?\nTrận đã ghi không bị ảnh hưởng.`)) {
        team = t; store.saveTeam(team); render(); toast(`Đã nạp ${t.players.length} VĐV — HLV kiểm lại số áo, vị trí.`);
      }
      break;
    }
    case 'luTap': luTap(d); break;
    case 'oppSheet': openSheet('opp', { oppId: d.id }); break;
    case 'ai': openSheet('ai', { aiId: d.id, aiSet: d.set ? +d.set : null }); break;
    case 'aiCopy': aiCopy(); break;
    case 'vSeek': vSeek(+d.i); break;
    case 'vNow': vNow(); break;
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
  } else if (f.id === 'playerForm') submitPlayer(f);
  else if (f.id === 'teamNameForm') {
    team.name = f.elements.name.value.trim() || 'Đội nhà';
    saveTeam(); closeSheet(); render();
  } else if (f.id === 'ytForm') vOpenYT(f.elements.yt.value);
  else if (f.id === 'syncForm') vSetOffset(f.elements.off.value);
  else if (f.id === 'chkForm') {
    const us = +f.elements.us.value, them = +f.elements.them.value;
    const c = R.cur;
    const ok = us === c.us && them === c.them;
    ui.chk = { ok, us, them, appUs: c.us, appThem: c.them };
    push({ t: 'chk', us, them, ok });
  }
});


document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'oppPick') {
    $('#oppOther').hidden = el.value !== '__other';
    $('#oppInfo').innerHTML = oppInfo(el.value);
  } else if (el.dataset.ai === 'scope') { ui.aiSet = el.value ? +el.value : null; renderSheet(); }
  else if (el.dataset.vf) vFilter(el.dataset.vf, el.value);
  else if (el.dataset.testid === 'v-file') vOpenFile(el.files && el.files[0]);
});

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
[DATA.roster, DATA.opp] = await Promise.all([loadJSON('data/roster-lpbank.json'), loadJSON('data/opponents.json')]);
// Hồ sơ đối thủ do nghiên cứu cập nhật tay: thiếu trường nào thì coi là rỗng, không để cả màn trắng.
if (DATA.opp) {
  DATA.opp.teams = (Array.isArray(DATA.opp.teams) ? DATA.opp.teams : []).filter((t) => t && t.name)
    .map((t) => ({ ...t, players: t.players || [], tendencies: t.tendencies || [], sources: t.sources || [] }));
}
team = store.loadTeam();
if (!team) { team = presetTeam() || store.defaultTeam(); store.saveTeam(team); } // lần đầu mở: nạp sẵn đội
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
