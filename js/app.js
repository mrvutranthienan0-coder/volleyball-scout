// Giao diện. Mọi thay đổi dữ liệu đi qua push()/save() → tính lại từ nhật ký → lưu → vẽ lại.
import * as L from './logic.js';
import * as store from './store.js';
import * as X from './export.js';
import * as AI from './ai.js';
import * as V from './video.js';
import * as AIL from './ai-live.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const sheetEl = $('#sheet');

let team = null; // nạp lúc khởi động (cần DATA.roster cho lần mở đầu tiên)
let match = null; // trận đang mở (đang ghi hoặc vừa xong)
let R = null; // kết quả replay(match)
const ui = { coachFilter: 'set', recvFor: null, sheet: null, pickHow: null, editIdx: null, chk: null, editPid: null, luSel: null };
// Dữ liệu tĩnh đi kèm app (service worker cache sẵn → dùng được khi offline).
const DATA = { roster: null, opp: null, scout: null };
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
// Biểu tượng lấy từ sprite Tabler Icons nhúng sẵn trong index.html (chạy offline).
const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
// Ảnh VĐV: chỉ nhận data URL ảnh do app tự tạo (JPEG/PNG/WebP base64) — chặn chuỗi lạ từ file nhập.
const photoOk = (s) => typeof s === 'string' && s.length < 400000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
// Nguồn ảnh theo thứ tự ưu tiên: ảnh HLV tự thêm → ảnh đi kèm app có giấy phép (data/photos/<số>.jpg,
// ghi công trong credits.json) → ảnh xem thử trên máy (data/photos-local, chỉ khi chạy localhost) → số áo.
// Ảnh đi kèm chỉ áp cho danh sách nạp sẵn (khớp số áo, và tên nếu credits có ghi tên).
function bundled(p) {
  if (!p || !team || !DATA.roster || team.preset !== DATA.roster.label) return null;
  const c = DATA.photos && DATA.photos[String(p.num)];
  if (c && (!c.name || norm(c.name) === norm(p.name))) return { src: `data/photos/${p.num}.jpg`, credit: c };
  const l = DATA.localPhotos.get(+p.num);
  if (l && (!l.name || norm(l.name) === norm(p.name))) return { src: `data/photos-local/${l.file}`, credit: null, local: l };
  return null;
}
const photoOf = (p) => (p && photoOk(p.photo) ? { src: p.photo, credit: null } : p && p.photo === undefined ? bundled(p) : null);
// Ảnh tròn nếu có, không thì huy hiệu số áo. Ảnh đi kèm lỗi tải (vd offline) → tự về số áo.
const avatar = (p, cls = '') => {
  const ph = photoOf(p);
  return ph
    ? `<span class="ava ${cls}" data-num="${p.num}"><img src="${esc(ph.src)}" alt="Ảnh ${esc(p.name || 'VĐV số ' + p.num)}" ${ph.src.startsWith('data:') ? '' : 'data-fallback="1"'}></span>`
    : `<span class="ava ava-num ${cls}">${p ? esc(p.num) : '?'}</span>`;
};
const noPhoto = ({ photo, ...rest }) => rest; // ảnh chỉ nằm ở danh sách đội, không chép vào trận

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

const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return ''; } };
function render() {
  const h = location.hash || '#/';
  const [, route, arg] = h.split('/');
  document.body.dataset.route = route || 'home';
  if (route === 'team' && arg) ui.selPid = safeDecode(arg);
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
  else if (route === 'data') html = viewData();
  else if (route === 'scout') html = viewScout();
  else if (route === 'tactics') html = viewTactics();
  else html = viewHome();
  const warn = store.lastError
    ? `<div class="banner" role="alert">Không lưu được vào máy (${esc(store.lastError.name)}). Hãy xuất JSON ngay để tránh mất dữ liệu.</div>` : '';
  app.innerHTML = shell(route || 'home', warn, html);
  if (route === 'team' && arg && ui.scrollTop) { window.scrollTo(0, 0); ui.scrollTop = false; }
  if (route === 'video') mountPlayer();
  mountModule(route, arg);
  if (route === 'data') { const h = $('#ail-settings-host'); if (h) AIL.mountSettings(h, { onSave: () => {} }); }
  if (route === 'live') mountVoiceBox();
  drawLineup();
  if (ui.sheet) renderSheet();
  wake(route === 'live');
}

// ---------- Khung (phong cách C · Khối mềm): thanh trên có nút viên thuốc (≥1024px) + thanh tab (điện thoại) ----------
// Màn ghi trận là chế độ tập trung: không thanh điều hướng — giữ trọn chỗ cho nút ghi pha.
const ACTIVE = { home: 'home', setup: 'live', live: 'live', rallies: 'live', coach: 'coach', team: 'team', history: 'home', summary: 'home', video: 'home', opp: 'scout', scout: 'scout', tactics: 'tactics', data: 'data' };
function navItems() {
  const live = match && match.status === 'live';
  return [
    ['home', '#/', 'Trận tới', 'calendar-event'],
    ['scout', '#/scout', 'Đối thủ', 'shield-half'],
    ['tactics', '#/tactics', 'Chiến thuật', 'target'],
    ['live', live ? '#/live' : '#/setup', 'Ghi trận', 'ball-volleyball', live],
    ['coach', '#/coach', 'Hội ý', 'clipboard-list', false, !match],
    ['team', '#/team', 'Cầu thủ', 'users'],
  ];
}
const LOGO = '<span class="logo" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3 4 6 4 9s-1 6-4 9M3.6 8.5c4 .5 8 3 10 7M20.4 8.5c-4 0-8.5 2-10.5 6"/></svg></span>';
function shell(route, warn, html) {
  if (route === 'live') return warn + html;
  const act = ACTIVE[route] || 'home';
  const items = navItems();
  const dot = (on) => (on ? '<i class="livedot" title="Đang ghi trận"></i>' : '');
  const seg = items.map(([k, to, label, , live, dis]) => `<button class="seg-i ${act === k ? 'on' : ''}" data-act="nav" data-to="${to}" ${dis ? 'disabled' : ''} ${act === k ? 'aria-current="page"' : ''}>${label}${dot(live)}</button>`).join('');
  const bar = `<div class="appbar"><div class="appbar-in">
    <button class="brand" data-act="nav" data-to="#/" aria-label="Sổ tay HLV — về màn Trận tới">${LOGO}<b>Sổ tay HLV</b></button>
    <nav class="segnav" data-testid="sidenav" aria-label="Các màn chính">${seg}</nav>
    <button class="gear ${act === 'data' ? 'on' : ''}" data-act="nav" data-to="#/data" aria-label="Cài đặt: đội, trợ lý AI, sao lưu" data-testid="nav-settings">${ic('settings')}<span>Cài đặt</span></button>
  </div></div>`;
  const tabs = `<nav class="tabbar" data-testid="tabbar" aria-label="Các màn chính">${items.filter(([k]) => k !== 'coach').map(([k, to, label, icon, live, dis]) => `<button class="tab ${act === k ? 'on' : ''}" data-act="nav" data-to="${to}" ${dis ? 'disabled' : ''} ${act === k ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${dot(live)}</button>`).join('')}</nav>`;
  return `${bar}<div class="content">${warn}${html}</div>${tabs}`;
}
// Tiêu đề màn: tên + một câu nói màn này để làm gì (viết cho HLV).
function pageHead(title, sub, o = {}) {
  const back = o.back ? `<button class="back" data-act="nav" data-to="${o.back}" aria-label="${o.backLabel || 'Quay lại'}"${o.backId ? ` data-testid="${o.backId}"` : ''}>${ic('chevron-left')}${o.backText ? `<span>${o.backText}</span>` : ''}</button>` : '';
  return `<header class="top${o.cls ? ' ' + o.cls : ''}">${back}<div class="ttl"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${o.actions ? `<div class="top-acts">${o.actions}</div>` : ''}</header>`;
}

// ---------- Phần tử hình dùng chung ----------
const TONE = { lav: '#6A55D8', mint: '#2E8B57', peach: '#D9653B', sky: '#2F6FD1' };
// Vòng tiến độ n/d (d = 0 → vòng rỗng). label mặc định "n/d".
function ring(n, d, tone = 'mint', size = 92, label = null) {
  const C = 251.3, f = d > 0 ? Math.max(0, Math.min(1, n / d)) : 0;
  return `<div class="ring" style="--rs:${size}px" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--ring-track)" stroke-width="10"/>`
    + `<circle cx="50" cy="50" r="40" fill="none" stroke="${TONE[tone]}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C}" transform="rotate(-90 50 50)"/></svg><b>${label == null ? `${n}/${d}` : label}</b></div>`;
}
// Câu có [[đoạn nhấn]] → nền tím nhạt như mẫu C.
const hl = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="mk">$1</span>');

// ---------- Trận tới (lịch + tóm tắt đối thủ lấy từ data/scout/*.json) ----------
function nextMatch() {
  const s = DATA.scout;
  const m = s && s.match;
  if (!m || Number.isNaN(Date.parse(m.start))) return null;
  return { ...m, sum: s.summary || {}, plans: Array.isArray(s.plans) ? s.plans.length : 0, tend: Array.isArray(s.tendencies) ? s.tendencies.length : 0, vids: Array.isArray(s.videosUsed) ? s.videosUsed.length : 0 };
}
const vnDay = (t) => Math.floor((t + 7 * 3600e3) / 86400e3); // ngày theo giờ Việt Nam
function countdownText(iso, now = Date.now()) {
  const d = vnDay(Date.parse(iso)) - vnDay(now);
  return d > 1 ? `Còn ${d} ngày` : d === 1 ? 'Ngày mai' : d === 0 ? 'Hôm nay' : 'Đã đấu';
}
function vnWhen(iso) {
  const d = new Date(Date.parse(iso) + 7 * 3600e3);
  const wd = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][d.getUTCDay()];
  const p = (n) => String(n).padStart(2, '0');
  return `${wd}, ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const savedPlans = () => { try { const v = JSON.parse(localStorage.getItem('vbs.tactics.plans') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

function viewHome() {
  const live = match && match.status === 'live';
  const nm = nextMatch();
  const list = store.listMatches().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const recent = list.slice(0, 4).map((x) => `<button class="mrow" data-act="nav" data-to="#/summary/${esc(x.id)}">
      <span class="tbadge muted-b">${esc(initials(x.opp))}</span>
      <span class="mrow-main"><b>${esc(x.opp)}</b><small>${esc(X.fmtDate(String(x.date || '')))} · ${X.TYPE_LABEL[x.type] || ''}${x.status === 'live' ? ' · đang ghi' : ''}</small></span>
      <span class="mrow-res ${x.winsUs > x.winsThem ? 'w' : x.winsUs < x.winsThem ? 'l' : ''}">${esc(x.winsUs)}–${esc(x.winsThem)}</span>${ic('chevron-right')}</button>`).join('');
  const done = list.filter((x) => x.status !== 'live');
  const W = done.filter((x) => x.winsUs > x.winsThem).length, Lz = done.filter((x) => x.winsUs < x.winsThem).length;

  // Ô 1: trận tới (đếm ngược) — hoặc tỉ số trận đang ghi.
  let first;
  if (live) {
    const c = R.cur;
    first = `<section class="t tile-sky match-tile" data-testid="live-tile">
      <div class="lab"><span class="livedot"></span>Đang ghi · Set ${R.sets.length || 1}</div>
      <div class="teams"><span>${esc(team.name)}</span><span>${esc(match.opponent)}</span></div>
      <div class="sc"><b>${c ? c.us : 0}</b><i>–</i><b class="them">${c ? c.them : 0}</b></div>
      <p class="muted">Set thắng ${R.winsUs}–${R.winsThem} · ${esc(X.TYPE_LABEL[match.type] || '')} · ${esc(X.fmtDate(match.date))}</p>
      <div class="acts"><button class="pill-btn dark" data-act="nav" data-to="#/coach">Mở màn hội ý</button><button class="pill-btn" data-act="nav" data-to="#/setup" data-testid="new-match">Trận mới</button></div>
    </section>`;
  } else if (nm) {
    first = `<section class="t tile-sky match-tile" data-testid="next-match">
      <div class="lab">Trận tới · ${esc(nm.competition || '')}</div>
      <div class="mvs"><b>${esc(nm.home || team.name)}</b><i>gặp</i><b>${esc(nm.opponent)}</b></div>
      <div class="count" data-testid="home-countdown">${esc(countdownText(nm.start))}</div>
      <p>${esc(vnWhen(nm.start))}<br>${esc(nm.venue || '')}</p>
    </section>`;
  } else {
    first = `<section class="t tile-sky match-tile"><div class="lab">Trận tới</div><div class="count">Chưa có lịch</div><p>Thêm báo cáo đối thủ vào <b>data/scout/</b> để thấy đếm ngược tới trận.</p></section>`;
  }
  // Ô 2: tóm lại về đối thủ — một câu kết luận.
  const sum = nm ? nm.sum : {};
  const concl = nm && sum.sentence ? `<section class="t concl">
      <div class="lab">Tóm lại về ${esc(nm.opponent)}</div>
      <h2>${hl(sum.sentence)}</h2>
      ${Array.isArray(sum.chips) && sum.chips.length ? `<div class="chips-s">${sum.chips.slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    </section>`
    : `<section class="t concl"><div class="lab">Tóm lại</div><h2>Chưa có báo cáo đối thủ. Bấm <span class="mk">Bắt đầu ghi trận</span> để bắt đầu ghi, số liệu sẽ tự thành nhận định.</h2></section>`;
  // Ba bước trước trận — mỗi ô là một nút lớn, đúng việc HLV cần làm.
  const nSaved = savedPlans().filter((p) => p && p.source !== 'ai').length;
  const steps = `<section class="steps">
    <button class="t step tile-lav" data-act="nav" data-to="#/scout" data-testid="home-scout">
      <span class="k">Bước 1 · Trước trận</span><b>Xem báo cáo đối thủ</b>
      <small>${nm ? `${nm.tend} điều về cách ${esc(nm.opponent)} chơi, kèm đoạn video làm bằng chứng.` : 'Đối thủ chơi thế nào, kèm bằng chứng video.'}</small><span class="go">${ic('chevron-right')}</span></button>
    <button class="t step tile-mint" data-act="nav" data-to="#/tactics" data-testid="home-tactics">
      <span class="k">Bước 2 · Soạn phương án</span><b>Mở bàn chiến thuật</b>
      <small>${nm && nm.plans ? `${nm.plans} phương án AI đề xuất chờ HLV duyệt` : 'Xếp người, vẽ đường chạy, trình chiếu cho đội'}${nSaved ? ` · ${nSaved} phương án HLV đã lưu` : ''}.</small><span class="go">${ic('chevron-right')}</span></button>
    ${live ? `<button class="t step tile-peach" data-act="nav" data-to="#/live" data-testid="continue">
      <span class="k">Bước 3 · Trong trận</span><b>Tiếp tục ghi trận</b>
      <small>${esc(team.name)} gặp ${esc(match.opponent)} · lúc hội ý mở màn Hội ý.</small><span class="go">${ic('chevron-right')}</span></button>`
    : `<button class="t step tile-peach" data-act="nav" data-to="#/setup" data-testid="new-match">
      <span class="k">Bước 3 · Trong trận</span><b>Bắt đầu ghi trận</b>
      <small>Ghi mỗi pha bằng 1–3 chạm${AIL.isConfigured() ? ' hoặc giọng nói' : ''}. Lúc hội ý mở màn Hội ý.</small><span class="go">${ic('chevron-right')}</span></button>`}
  </section>`;
  // Cầu thủ ghi nhiều điểm: tấn công + chắn + phát bóng ăn điểm, gộp mọi trận đã lưu.
  const agg = teamAgg();
  const lead = team.players.map((p) => ({ p, a: agg.per[p.id] })).filter((x) => x.a && x.a.k + x.a.b + x.a.ace > 0)
    .map((x) => ({ ...x, pts: x.a.k + x.a.b + x.a.ace })).sort((x, y) => y.pts - x.pts).slice(0, 4);
  const lmax = lead.length ? lead[0].pts : 1;
  const leaders = `<section class="t leaders"><div class="lab">Ghi nhiều điểm nhất · ${list.length} trận</div>
    ${lead.length ? `<ol class="lead">${lead.map(({ p, a, pts }) => `<li><button class="lrow" data-act="selPlayer" data-pid="${esc(p.id)}">${avatar(p)}<span class="lr-main"><b>${esc(p.name || '#' + p.num)}</b><small>${esc(POS_NAME[p.pos || ''])} · số ${p.num}</small><span class="bar"><i style="width:${((pts / lmax) * 100).toFixed(1)}%"></i></span></span><span class="lr-v" title="${a.k} tấn công · ${a.b} chắn · ${a.ace} phát bóng ăn điểm"><b class="num">${pts}</b><small>điểm</small></span></button></li>`).join('')}</ol>`
    : '<p class="muted">Chưa có số liệu. Ghi trận có chọn cầu thủ để thấy ai ghi điểm nhiều nhất.</p>'}
  </section>`;
  const recentT = `<section class="t recent"><div class="lab-row"><div class="lab">Trận gần đây · ${W} thắng, ${Lz} thua</div><button class="link-btn" data-act="nav" data-to="#/history" data-testid="history">Tất cả trận ${ic('chevron-right')}</button></div>
      ${recent || '<p class="muted">Chưa có trận nào. Bấm <b>Bắt đầu ghi trận</b> để ghi trận đầu tiên.</p>'}</section>`;
  const links = `<section class="t links"><div class="lab">Mở nhanh</div>
      <button class="qlink" data-act="nav" data-to="#/team" data-testid="team">${ic('users')}<span><b>Cầu thủ</b><small>${team.players.length} người · mạnh ở đâu, nên chuyền cho ai</small></span></button>
      <button class="qlink" data-act="nav" data-to="#/video" data-testid="home-video">${ic('video')}<span><b>Xem lại video</b><small>Khớp từng pha đã ghi với video trận</small></span></button>
      <button class="qlink" data-act="nav" data-to="#/opp" data-testid="home-opp">${ic('shield-half')}<span><b>Các đội trong giải</b><small>Nhận xét có nguồn về từng đội</small></span></button>
      <div class="row2 backup-row"><button class="btn" data-act="backup">${ic('download')}Sao lưu</button><button class="btn" data-act="import">Nhập file</button></div>
    </section>`;
  const bottom = live
    ? `<section class="t today"><span>Đang ghi trận gặp ${esc(match.opponent)} · set ${R.sets.length || 1}, tỉ số ${R.cur ? `${R.cur.us}–${R.cur.them}` : '0–0'}.</span><button class="pill-btn" data-act="nav" data-to="#/coach">Mở màn hội ý</button></section>`
    : nm ? `<section class="t today"><span>${esc(countdownText(nm.start))} tới trận gặp ${esc(nm.opponent)}${sum.bottomLine ? ' · ' + esc(sum.bottomLine) : ''}</span><button class="pill-btn" data-act="nav" data-to="#/scout">Xem báo cáo đối thủ</button></section>` : '';
  return `${pageHead('Trận tới', 'Việc cần làm trước trận: đọc báo cáo đối thủ, soạn phương án, rồi ghi trận.')}
  <main class="home bento">
    ${first}${concl}${steps}${recentT}${leaders}${links}${bottom}
  </main>`;
}
function dataCard() {
  return `<section class="t datacard"><div class="lab">Sao lưu dữ liệu</div>
    <p class="muted">Dữ liệu chỉ nằm trên máy này. Nên sao lưu sau mỗi trận. File sao lưu có cả ảnh cầu thủ nên có thể nặng.</p>
    <div class="row2">
      <button class="btn" data-act="import">Nhập file sao lưu</button>
      <button class="btn primary" data-act="backup">Sao lưu toàn bộ</button>
    </div></section>`;
}
function viewData() {
  return `${pageHead('Cài đặt', 'Đội của bạn, trợ lý AI và sao lưu dữ liệu trên máy này.', { back: '#/' })}
  <main class="page settings bento">
    <section class="t"><div class="lab">Đội</div>
      <button class="teamname" data-act="openSheet" data-s="teamName"><span class="tbadge">${esc(initials(team.name))}</span><span><b>${esc(team.name)}</b><small>${team.players.length} cầu thủ · bấm để đổi tên đội</small></span></button>
      <button class="btn" data-act="nav" data-to="#/team">Mở danh sách cầu thủ</button>
    </section>
    <section class="t tile-lav"><div class="lab">Trợ lý AI · ${AIL.isConfigured() ? 'đã kết nối' : 'chưa kết nối'}</div>
      <p class="muted">Ghi pha bằng giọng nói và hỏi AI lúc hội ý. Cần địa chỉ máy chủ AI và mã đội do người quản lý đưa. Không có mạng thì vẫn ghi tay như thường.</p>
      <div id="ail-settings-host"></div>
    </section>
    ${dataCard()}
  </main>`;
}

// ---------- Đối thủ (báo cáo scout) + Bàn chiến thuật: module riêng, gắn vào khung app ----------
// Nút trong module do module tự xử lý; app chỉ giữ nguyên nút đã gắn khi vẽ lại cùng màn (không mất nét vẽ/hoàn tác).
function viewScout() {
  const nm = nextMatch();
  return `${pageHead('Đối thủ', nm ? `${esc(nm.opponent)} trước trận ${esc(vnWhen(nm.start).slice(vnWhen(nm.start).indexOf(', ') + 2, vnWhen(nm.start).indexOf(', ') + 7))}: họ chơi thế nào, bằng chứng video, phương án AI đề xuất — HLV quyết.` : 'Đối thủ chơi thế nào, bằng chứng video, phương án AI đề xuất — HLV quyết.',
    { actions: '<button class="pill-btn" data-act="nav" data-to="#/opp" data-testid="scout-league">Các đội khác</button>' })}
  <div id="mod-host" class="sr-page sr-host" data-testid="scout-host"><p class="muted mod-wait">Đang mở báo cáo đối thủ…</p></div>`;
}
function viewTactics() {
  return `${pageHead('Bàn chiến thuật', 'Xếp người theo xoay vòng, vẽ đường chạy, lưu phương án và trình chiếu cho đội lúc hội ý.')}
  <div id="mod-host" class="tx-host" data-testid="tactics-host"><p class="muted mod-wait">Đang mở bàn chiến thuật…</p></div>`;
}
let MOD = { key: null, node: null, api: null };
function dropModule() {
  try { if (MOD.api && MOD.api.destroy) MOD.api.destroy(); } catch { /* bỏ qua */ }
  MOD = { key: null, node: null, api: null };
}
async function mountModule(route, arg) {
  const ph = $('#mod-host');
  if (!ph || (route !== 'scout' && route !== 'tactics')) { if (MOD.node) dropModule(); return; }
  const key = route + '/' + (arg || '');
  if (MOD.node && MOD.key === key) { ph.replaceWith(MOD.node); return; }
  dropModule();
  const node = ph;
  const mine = (MOD = { key, node, api: null });
  try {
    if (route === 'tactics') {
      const tx = await import('./tactics.js');
      if (MOD !== mine) return;
      node.innerHTML = '';
      mine.api = await tx.mountTactics(node);
      if (MOD !== mine) { mine.api.destroy(); return; }
      if (arg && !mine.api.loadPlan(safeDecode(arg))) toast('Không tìm thấy phương án này trên máy.');
    } else {
      const sr = await import('./scout-report.js');
      if (MOD !== mine) return;
      mine.api = await sr.mountScoutReport(node, { url: 'data/scout/xmls-thanh-hoa.json' });
      if (MOD !== mine) { mine.api.destroy(); return; }
    }
  } catch (e) {
    if (MOD === mine) node.innerHTML = `<section class="t"><div class="lab">Chưa mở được</div><p>${route === 'tactics' ? 'Bàn chiến thuật' : 'Báo cáo đối thủ'} chưa có trên máy này. Mở lại khi có mạng.</p><p class="muted">${esc(e.message)}</p></section>`;
  }
}
// "Mở trên bàn chiến thuật" trong báo cáo: lưu phương án AI rồi mở ngay trong app (không rời sang trang riêng).
app.addEventListener('click', async (e) => {
  const a = e.target.closest && e.target.closest('#mod-host a[data-plan], #mod-host a[href="tactics.html"]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const id = a.dataset.plan;
  if (!id) return go('#/tactics');
  const data = MOD.api && MOD.api.data;
  const P = data && Array.isArray(data.plans) ? data.plans.find((x) => x && x.plan && x.plan.id === id) : null;
  if (P) { try { (await import('./tactics.js')).savePlan({ ...P.plan, source: 'ai' }); } catch { /* bàn chưa sẵn sàng */ } }
  go('#/tactics/' + encodeURIComponent(id));
}, true);

// "Mở phương án" ở màn hội ý: phương án AI chỉ có trong báo cáo đối thủ → lưu vào bàn trước khi mở (giống nút trong báo cáo).
async function openPlan(id) {
  if (!id) return go('#/tactics');
  const P = DATA.scout && Array.isArray(DATA.scout.plans) ? DATA.scout.plans.find((x) => x && x.plan && x.plan.id === id) : null;
  if (P && !savedPlans().some((x) => x && x.id === id)) { try { (await import('./tactics.js')).savePlan({ ...P.plan, source: 'ai' }); } catch { /* bàn chưa sẵn sàng */ } }
  go('#/tactics/' + encodeURIComponent(id));
}

// Nút "Giữ để nói" trên màn ghi trận — chỉ hiện khi đã nối máy chủ AI (Cài đặt). Pha nói ra đi qua đúng push().
let voice = null;
function mountVoiceBox() {
  const h = $('#voice-host');
  if (!h) { if (voice) { voice.destroy(); voice = null; } return; }
  if (voice) { if (voice.el !== h) h.replaceWith(voice.el); return; }
  voice = AIL.mountVoice(h, {
    getContext: () => AIL.contextFromMatch(match, R),
    onRally: (ev) => { const serveThem = R.cur && R.cur.serve === 'them'; push({ t: 'r', how: ev.how, p: ev.p || null }); ui.recvFor = serveThem && ev.how !== 'rer' ? match.events.length - 1 : null; render(); },
    onManual: () => {},
  });
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

// Số liệu một VĐV gộp từ MỌI trận đã lưu trên máy (tính lại từ nhật ký, không lưu riêng).
// per[pid]: tổng + chuỗi theo trận (series) + kết quả theo xoay vòng (rot) cho sơ đồ sân.
const SKILL = {
  atk: { label: 'Tấn công', kinds: [['atk', 'w', 'Ghi điểm'], ['aer', 'e', 'Lỗi'], ['bkd', 'b', 'Bị chắn']] },
  srv: { label: 'Phát bóng', kinds: [['ace', 'w', 'Ăn điểm'], ['ser', 'e', 'Lỗi']] },
  blk: { label: 'Chắn bóng', kinds: [['blk', 'w', 'Ghi điểm']] },
  rcv: { label: 'Đỡ bước 1', kinds: [['good', 'w', 'Tốt (2–3)'], ['bad', 'e', 'Kém (0–1)']] },
};
function teamAgg() {
  const per = {};
  const A = (pid) => (per[pid] ||= { m: 0, k: 0, ae: 0, bd: 0, b: 0, ace: 0, se: 0, re: 0, xe: 0, sv: 0, rn: 0, rsum: 0, series: [], rot: {}, log: [] });
  const list = store.listMatches().slice().sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
  for (const x of list) {
    const m = byId(x.id);
    if (!m) continue;
    let R2;
    try { R2 = L.replay(m); } catch { continue; }
    const st = L.stats(m, R2, null);
    const seen = new Set();
    // log: pha gần nhất theo kỹ năng (cho khung "Pha gần nhất" cạnh sơ đồ sân).
    const cnt = (pid, r, sk, kind) => {
      const a = A(pid); const z = (a.rot[r.rot] ||= {}); const q = (z[sk] ||= {}); q[kind] = (q[kind] || 0) + 1;
      a.log.push({ sk, kind, rot: r.rot, set: r.set, us: r.usA, them: r.themA, date: m.date, opp: m.opponent });
    };
    for (const r of R2.rallies) {
      [r.p, r.rp, r.server].forEach((pid) => pid && seen.add(pid));
      if (r.server) A(r.server).sv++;
      if (r.p) for (const [sk, def] of Object.entries(SKILL)) if (def.kinds.some(([k]) => k === r.how)) cnt(r.p, r, sk, r.how);
      if (r.rp && typeof r.rc === 'number') cnt(r.rp, r, 'rcv', r.rc >= 2 ? 'good' : 'bad');
    }
    seen.forEach((pid) => A(pid).m++);
    const one = {};
    for (const q of st.players) { const a = A(q.pid); ['k', 'ae', 'bd', 'b', 'ace', 'se', 're', 'xe'].forEach((f) => (a[f] += q[f])); one[q.pid] = q.k + q.b + q.ace; }
    const pass = {};
    for (const q of st.passers) { const a = A(q.pid); a.rn += q.n; a.rsum += q.sum; pass[q.pid] = q.avg; }
    seen.forEach((pid) => A(pid).series.push({ id: m.id, date: m.date, opp: m.opponent, pts: one[pid] || 0, recv: pass[pid] ?? null }));
  }
  const maxB = Math.max(0, ...Object.values(per).map((a) => a.b));
  // Trung bình đội từng trục: chỉ tính VĐV có dữ liệu cho trục đó.
  const axes = Object.values(per).map((a) => skills(a, maxB));
  const avg = [0, 1, 2, 3, 4].map((i) => { const v = axes.map((x) => x[i][2]).filter((y) => y != null); return v.length ? v.reduce((s2, y) => s2 + y, 0) / v.length : null; });
  return { per, maxB, avg };
}
// 5 trục kỹ năng, thang 0–1. null = chưa có dữ liệu cho trục đó (vẽ ở tâm, ghi "–").
const pct01 = (v) => (v == null ? '–' : Math.round(v * 100) + '%');
function skills(a, maxB) {
  const e = a.ae + a.bd, err = e + a.se + a.re + a.xe, acts = a.k + a.b + a.ace + err;
  const ax = [
    ['atk', 'Tấn công', a.k + e ? a.k / (a.k + e) : null],
    ['srv', 'Phát bóng', a.sv ? (a.sv - a.se) / a.sv : null],
    ['rcv', 'Đỡ bước 1', a.rn ? a.rsum / a.rn / 3 : null],
    ['blk', 'Chắn bóng', maxB ? a.b / maxB : null],
    ['cons', 'Ổn định', acts ? 1 - err / acts : null],
  ];
  return ax.map((x) => [...x, pct01(x[2])]);
}
// Radar 5 trục: đa giác đặc màu nhấn trên lưới nét đứt; nhãn % lớn + chú thích nhỏ quanh biểu đồ.
const RCX = 180, RCY = 158, RR = 88;
const rpt = (i, r) => { const t = (-90 + i * 72) * Math.PI / 180; return [RCX + r * Math.cos(t), RCY + r * Math.sin(t)]; };
const rpoly = (f) => [0, 1, 2, 3, 4].map((i) => rpt(i, f(i)).map((v) => v.toFixed(1)).join(',')).join(' ');
const rgrid = () => [0.25, 0.5, 0.75, 1].map((k) => `<polygon class="rg" points="${rpoly(() => RR * k)}"/>`).join('')
  + [0, 1, 2, 3, 4].map((i) => { const [x, y] = rpt(i, RR); return `<line class="rg" x1="${RCX}" y1="${RCY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
function radar(ax, avg) {
  const cl = (v) => RR * Math.max(0, Math.min(1, v || 0));
  const team = avg && avg.some((v) => v != null) ? `<polygon class="rt" points="${rpoly((i) => cl(avg[i]))}"/>` : '';
  const dots = ax.map((a, i) => { const [x, y] = rpt(i, cl(a[2])); return a[2] == null ? '' : `<circle class="rd" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`; }).join('');
  // Vị trí nhãn: đỉnh trên → phía trên; hai đỉnh ngang → hai bên; hai đỉnh dưới → phía dưới.
  const place = [[0, -RR - 40, 'middle'], [RR + 10, -42, 'start'], [RR * 0.59 + 8, RR * 0.81 + 22, 'start'], [-RR * 0.59 - 8, RR * 0.81 + 22, 'end'], [-RR - 10, -42, 'end']];
  const labels = ax.map(([k, name, , txt], i) => {
    const [dx, dy, anchor] = place[i];
    const x = (RCX + dx).toFixed(1), y = (RCY + dy).toFixed(1);
    return `<text class="rl" data-axis="${k}" x="${x}" y="${y}" text-anchor="${anchor}"><tspan class="rv" x="${x}">${esc(txt)}</tspan><tspan class="rc" x="${x}" dy="17">${name}</tspan></text>`;
  }).join('');
  return `<svg class="radar" viewBox="0 8 360 280" role="img" aria-label="Chỉ số kỹ năng: ${ax.map((a) => `${a[1]} ${a[3]}`).join(', ')}" data-testid="radar">
    ${rgrid()}<polygon class="ra" points="${rpoly((i) => cl(ax[i][2]))}"/>${team}${dots}${labels}</svg>`;
}
const ghostRadar = () => `<svg class="radar ghost" viewBox="0 0 360 300" aria-hidden="true">${rgrid()}</svg>`;
// Biểu đồ đường "Điểm ghi theo trận": đường cong mượt, lưới ngang, huy hiệu đội bạn trên mỗi điểm.
const fmtShort = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}` : ''; };
// Chấm minh hoạ trong từng vùng: app không ghi toạ độ pha bóng nên vị trí chấm là giả lập cố định
// (băm theo vùng + loại + thứ tự), chỉ số lượng là thật.
const jit = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
function scopeLabel() {
  const ms = store.listMatches();
  const off = ms.filter((x) => x.type === 'official').length;
  return !ms.length ? 'Chưa có trận' : off === ms.length ? 'VĐQG' : off === 0 ? 'Đấu tập' : 'VĐQG + đấu tập';
}
function courtCard(a, sk) {
  const def = SKILL[sk];
  const tot = (key) => (a ? Object.values(a.rot).reduce((s2, r) => s2 + Object.values(r[key] || {}).reduce((x, y) => x + y, 0), 0) : 0);
  const chips = Object.entries(SKILL).map(([k, d]) => `<button class="fchip ${k === sk ? 'on' : ''}" data-act="courtSkill" data-sk="${k}" aria-pressed="${k === sk}" data-testid="cs-${k}">${d.label} <b class="num">${tot(k)}</b></button>`).join('');
  const n = tot(sk);
  const zoneTot = (z) => Object.values((a && a.rot['P' + z] && a.rot['P' + z][sk]) || {}).reduce((x, y) => x + y, 0);
  const cell = (z) => {
    const r = (a && a.rot['P' + z] && a.rot['P' + z][sk]) || {};
    const parts = def.kinds.map(([k, cls, lbl]) => (r[k] ? `<span class="od ${cls}" title="${lbl}"><i></i>${r[k]}</span>` : '')).join('');
    let seed = z * 97;
    const dots = def.kinds.flatMap(([k, cls], ki) => Array.from({ length: Math.min(r[k] || 0, 9) }, (_, j) => {
      seed += 1;
      return `<i class="dot ${cls}" style="left:${(10 + jit(seed + ki * 31) * 78).toFixed(1)}%;top:${(46 + jit(seed * 7 + j) * 42).toFixed(1)}%"></i>`;
    })).join('');
    return `<div class="cz" data-testid="cz-P${z}"><span class="cz-k">P${z}</span><span class="cz-v">${parts || '<span class="cz-0">–</span>'}</span>${dots}</div>`;
  };
  const best = n ? [1, 2, 3, 4, 5, 6].reduce((b, z) => (zoneTot(z) > zoneTot(b) ? z : b), 1) : null;
  const cnt = (k) => (a ? Object.values(a.rot).reduce((s2, r) => s2 + ((r[sk] || {})[k] || 0), 0) : 0);
  // Dải tóm tắt kiêm chú giải màu chấm (bỏ hàng chú giải riêng cho gọn).
  const sum = [['Tổng pha', n, ''], ...def.kinds.map(([k, cls, lbl]) => [lbl, cnt(k), cls]), ['Vùng nhiều nhất', best ? 'P' + best : '–', '']].slice(0, 4);
  const last = a ? a.log.filter((x) => x.sk === sk).pop() : null;
  const kindLbl = (k) => (def.kinds.find(([kk]) => kk === k) || [])[2] || '';
  const lastHtml = last ? `<div class="lp-head"><span class="tbadge sm muted-b">${esc(initials(last.opp))}</span><span>${esc(last.opp || 'Đối thủ')} <small class="num">${esc(fmtShort(last.date))}</small></span></div>
      <dl class="lastplay"><dt>Kết quả</dt><dd>${esc(kindLbl(last.kind))}</dd><dt>Vùng</dt><dd>${esc(last.rot)}</dd><dt>Tỉ số</dt><dd class="num">Set ${last.set} · ${last.us}–${last.them}</dd></dl>`
    : '<p class="muted">Chưa có pha nào.</p>';
  return `<section class="card courtcard">
    <div class="cc-top"><b>Mùa 2026</b><i class="vsep"></i><span class="tbadge sm">VĐ</span><span>${scopeLabel()}</span></div>
    <div class="cc-body">
      <div class="cc-main">
        <div class="cc-h"><h2>Kết quả theo xoay vòng</h2><p class="sub">${def.label} · ${n} pha · <span class="acc">vị trí minh hoạ theo vùng xoay vòng</span></p></div>
        ${n ? `<div class="halfcourt" data-testid="halfcourt"><div class="net">Lưới</div>${[4, 3, 2, 5, 6, 1].map(cell).join('')}</div>
          <div class="sumstrip" style="--n:${sum.length}">${sum.map(([l, v, cls]) => `<div><b class="num">${v}</b><span${cls ? ` class="od ${cls}"` : ''}>${cls ? '<i></i>' : ''}${l}</span></div>`).join('')}</div>`
        : `<div class="empty-state"><b>Chưa có pha ${def.label.toLowerCase()}</b><span>Ghi trận có chọn cầu thủ để thấy kết quả theo từng xoay vòng.</span></div>`}
      </div>
      <div class="cc-side">
        <h3>Pha gần nhất</h3>${lastHtml}
        <h3>Bộ lọc</h3><div class="chips-f wrap" role="group" aria-label="Chọn kỹ năng">${chips}</div>
      </div>
    </div>
  </section>`;
}
function credit(p) {
  const ph = photoOf(p);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  if (ph && ph.local) {
    const h = /^https?:\/\//i.test(ph.local.page_url || '') ? host(ph.local.page_url) : '';
    return `<p class="credit" data-testid="photo-credit">Ảnh xem thử trên máy này${h ? ` · nguồn: <a href="${esc(ph.local.page_url)}" target="_blank" rel="noopener noreferrer">${esc(h)}</a>` : ''}</p>`;
  }
  if (!ph || !ph.credit) return '';
  const c = ph.credit;
  const lic = c.license ? `, ${esc(c.license)}` : '';
  const who = /^https?:\/\//i.test(c.source || '') ? `<a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">${esc(c.author || 'nguồn')}</a>` : esc(c.author || 'không rõ tác giả');
  return `<p class="credit" data-testid="photo-credit">Ảnh: ${who}${lic}</p>`;
}
// Ba ô nhận xét cho HLV (Điểm mạnh nhất / Nên chuyền nhiều / Cần để ý), tính từ số liệu đã ghi — câu nói thường, không công thức.
function playerNotes(p, a, agg) {
  if (!a || a.k + a.ae + a.bd + a.b + a.ace + a.se + a.rn === 0) return null;
  const m = Math.max(1, a.m);
  const per = (v) => L.dec(v / m);
  const vals = (f) => team.players.map((q) => agg.per[q.id]).filter(Boolean).map(f);
  const rankOf = (f) => 1 + vals(f).filter((v) => v > f(a)).length;
  // Điểm mạnh nhất: kỹ năng xếp hạng cao nhất trong đội (có số liệu thật, > 0).
  const cand = [
    ['b', a.b, rankOf((x) => x.b), `Chắn bóng${rankOf((x) => x.b) === 1 ? ' tốt nhất đội' : ''}: ${a.b} điểm chắn sau ${a.m} trận.`, `Khoảng ${per(a.b)} điểm chắn mỗi trận. Giữ ở giữa lưới khi đối thủ đánh nhanh.`],
    ['k', a.k, rankOf((x) => x.k), `Tấn công ghi ${a.k} điểm${rankOf((x) => x.k) === 1 ? ' — nhiều nhất đội' : ''}.`, `Khoảng ${per(a.k)} điểm tấn công mỗi trận.`],
    ['ace', a.ace, rankOf((x) => x.ace), `Phát bóng ăn điểm trực tiếp ${a.ace} lần.`, `Khoảng ${per(a.ace)} lần mỗi trận. Để phát khi cần gỡ điểm.`],
    ['rcv', a.rn >= 3 ? a.rsum / a.rn : 0, rankOf((x) => (x.rn >= 3 ? x.rsum / x.rn : 0)), `Đỡ bước 1 chắc: trung bình ${a.rn ? L.dec(a.rsum / a.rn) : '–'} trên thang 3.`, `Sau ${a.rn} lần đỡ. Có thể giao đỡ vùng rộng hơn.`],
  ].filter((x) => x[1] > 0).sort((x, y) => x[2] - y[2] || y[1] - x[1]);
  const best = cand[0] ? { k: 'Điểm mạnh nhất', title: cand[0][3], text: cand[0][4] } : { k: 'Điểm mạnh nhất', title: 'Chưa thấy điểm nổi bật.', text: 'Cần thêm trận có chọn người ghi điểm.' };
  const e = a.ae + a.bd, att = a.k + e;
  const atk = att >= 3
    ? { k: a.k / att >= 0.5 ? 'Nên chuyền nhiều' : 'Tấn công', tone: a.k / att >= 0.5 ? 'mint' : 'sky', title: `Tấn công thành điểm ${a.k}/${att} lần.`, text: a.k / att >= 0.5 ? `${Math.round((a.k / att) * 100)}% — cứ 2 lần chuyền cho người này thì ít nhất 1 lần thành điểm.` : `${Math.round((a.k / att) * 100)}% — dưới một nửa, chỉ chuyền khi bóng đẹp.` }
    : { k: 'Tấn công', tone: 'sky', title: `Mới có ${att} lần tấn công kết thúc pha.`, text: 'Chưa đủ để nói có nên chuyền nhiều hay không.' };
  // Cần để ý: tỉ lệ hỏng cao nhất trong các việc đã làm đủ nhiều lần.
  const rc = Object.values(a.rot).reduce((s2, r) => [s2[0] + ((r.rcv || {}).bad || 0), s2[1] + ((r.rcv || {}).good || 0)], [0, 0]);
  const bad = rc[0], rcN = rc[0] + rc[1];
  const risks = [
    a.sv >= 5 && a.se ? [a.se / a.sv, `Phát bóng hỏng ${a.se}/${a.sv} lần.`, `Cứ khoảng ${Math.round(a.sv / a.se)} lần phát thì hỏng 1. Nên phát an toàn khi đang dẫn sát.`] : null,
    att >= 3 && e ? [e / att, `Tấn công hỏng ${e}/${att} lần.`, `Đánh ra ngoài hoặc lưới ${a.ae} lần, bị chắn ${a.bd} lần.`] : null,
    rcN >= 3 && bad > 0 ? [bad / rcN, `Đỡ bước 1 hỏng hoặc kém ${bad}/${rcN} lần.`, 'Kém = bóng đỡ không cho chuyền hai chuyền đẹp. Cho libero ôm rộng hơn.'] : null,
  ].filter(Boolean).sort((x, y) => y[0] - x[0]);
  const risk = risks[0] ? { k: 'Cần để ý', title: risks[0][1], text: risks[0][2] } : { k: 'Cần để ý', title: 'Chưa thấy lỗi lặp lại.', text: 'Số liệu hiện tại chưa có việc nào hỏng nhiều.' };
  return [{ tone: 'lav', icon: 'award', ...best }, { icon: 'target', ...atk }, { tone: 'peach', icon: 'info-circle', ...risk }];
}
// Biểu đồ cột điểm mỗi trận (cột cuối đậm), mỗi cột có class .ld để đếm số trận.
function pointsChart(series) {
  const W = 320, H = 170, pb = 22, pt = 20, n = series.length;
  const max = Math.max(4, ...series.map((x) => x.pts));
  const gap = 8, bw = Math.min(40, (W - gap * (n - 1)) / Math.max(n, 1));
  const x0 = (W - (bw * n + gap * (n - 1))) / 2;
  const bars = series.map((x, i) => {
    const h = Math.max(4, ((H - pt - pb) * x.pts) / max), X = x0 + i * (bw + gap), Y = H - pb - h;
    return `<g class="ld${i === n - 1 ? ' last' : ''}"><rect x="${X.toFixed(1)}" y="${Y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="10"/><text class="bv" x="${(X + bw / 2).toFixed(1)}" y="${(Y - 6).toFixed(1)}" text-anchor="middle">${x.pts}</text><text class="bx" x="${(X + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(fmtShort(x.date))}</text><title>${esc(x.opp || '')} ${esc(fmtShort(x.date))}: ${x.pts} điểm</title></g>`;
  }).join('');
  return `<svg class="bchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Điểm mỗi trận: ${series.map((x) => x.pts).join(', ')}" data-testid="pts-chart">${bars}</svg>`;
}
const RADAR_HELP = 'Tấn công: số lần ghi trên số lần tấn công kết thúc pha. Phát bóng: lượt phát không hỏng. Đỡ bước 1: điểm trung bình trên thang 3. Chắn bóng: so với người chắn nhiều nhất đội. Ổn định: pha kết thúc không do lỗi của người này.';
function playerProfile(p, agg) {
  const a = agg.per[p.id];
  const ax = a ? skills(a, agg.maxB) : null;
  const has = ax && ax.some((x) => x[2] != null);
  // Đường so sánh: trung bình người cùng vị trí (trừ chính người này); chưa ai cùng vị trí có số liệu → trung bình đội.
  const peers = team.players.filter((q) => q.id !== p.id && (q.pos || '') === (p.pos || '') && agg.per[q.id]).map((q) => skills(agg.per[q.id], agg.maxB));
  const pAvg = [0, 1, 2, 3, 4].map((i) => { const v = peers.map((x) => x[i][2]).filter((y) => y != null); return v.length ? v.reduce((s2, y) => s2 + y, 0) / v.length : null; });
  const byPos = p.pos && pAvg.some((v) => v != null);
  const cmpAvg = byPos ? pAvg : agg.avg;
  const cmpLbl = byPos ? `so với ${POS_NAME[p.pos].toLowerCase()} khác` : 'so với trung bình đội';
  const e = a ? a.ae + a.bd : 0;
  const ser = a ? a.series : [];
  const pts = ser.map((x) => x.pts);
  const total = a ? a.k + a.b + a.ace : 0;
  const unv = p.unv && p.unv.length;
  const notes = playerNotes(p, a, agg);
  const hlTiles = notes
    ? notes.map((x) => `<section class="t hl tile-${x.tone}"><div class="ic-b">${ic(x.icon)}</div><div><div class="k">${esc(x.k)}</div><p>${esc(x.title)}<small>${esc(x.text)}</small></p></div></section>`).join('')
    : `<section class="t hl hl-empty"><div class="ic-b">${ic('chart-bar')}</div><div><div class="k">Chưa có số liệu</div><p>Chưa ghi trận nào có chọn người này.<small>Ghi 1 trận, bấm chọn người ghi điểm/mất điểm — 3 ô nhận xét sẽ tự hiện: điểm mạnh nhất, có nên chuyền nhiều không, cần để ý gì.</small></p></div></section>`;
  const attN = a ? a.k + e : 0;
  const ringT = `<section class="t ringt">${ring(a ? a.k : 0, attN, 'mint', 104, attN ? `${Math.round((a.k / attN) * 100)}%` : '–')}
    <div><div class="lab">Tấn công thành điểm</div><p>${attN ? `<strong>${a.k} trên ${attN} lần.</strong> Hỏng ${e} lần (đánh hỏng ${a.ae}, bị chắn ${a.bd}).` : 'Chưa có pha tấn công nào kết thúc.'}</p></div></section>`;
  const mix = `<section class="t mix"><div class="lab">Tổng điểm ${a ? a.m : 0} trận</div>
    <div class="big">${total}<span>${a && a.m ? `khoảng ${L.dec(total / a.m)} mỗi trận` : 'điểm'}</span></div>
    <div class="pills">${total ? `<i style="flex:${a.k};background:var(--sky-d)"></i><i style="flex:${a.b};background:var(--lav-d)"></i><i style="flex:${a.ace};background:var(--peach-d)"></i>` : '<i style="flex:1;background:var(--line-2)"></i>'}</div>
    <div class="leg"><div><span style="--c:var(--sky-d)">Tấn công</span><b>${a ? a.k : 0}</b></div><div><span style="--c:var(--lav-d)">Chắn bóng</span><b>${a ? a.b : 0}</b></div><div><span style="--c:var(--peach-d)">Phát bóng ăn điểm</span><b>${a ? a.ace : 0}</b></div></div></section>`;
  const trend = pts.length >= 2 ? pts[pts.length - 1] - pts[pts.length - 2] : null;
  const tiles = [
    ['Trận gần nhất', pts.length ? pts[pts.length - 1] : '–'],
    ['Cao nhất', pts.length ? Math.max(...pts) : '–'],
    ['Thấp nhất', pts.length ? Math.min(...pts) : '–'],
    ['So với trận trước', trend == null ? '–' : `${trend > 0 ? '+' : ''}${trend}`, trend > 0 ? 'c-win' : trend < 0 ? 'c-lose' : ''],
  ].map(([l, v, cls]) => `<div><span>${l}</span><b class="num ${cls || ''}">${v}</b></div>`).join('');
  const bars = `<section class="t barst"><div class="lab">Điểm mỗi trận</div>
    ${pts.length ? pointsChart(ser) : '<p class="muted">Mỗi trận đã ghi sẽ thành một cột.</p>'}</section>`;
  const last = ser.length ? ser[ser.length - 1] : null;
  const lastLog = a && last ? a.log.filter((x) => x.date === last.date && x.opp === last.opp) : [];
  const today = last
    ? `<section class="t today"><span>Trận gần nhất (${esc(fmtShort(last.date))} gặp ${esc(last.opp || 'đối thủ')}): ghi ${last.pts} điểm${lastLog.length ? ` (${lastLog.filter((x) => x.sk === 'atk' && x.kind === 'atk').length} tấn công, ${lastLog.filter((x) => x.sk === 'blk').length} chắn, ${lastLog.filter((x) => x.kind === 'ace').length} phát bóng)` : ''}.</span>${match && match.status === 'live' ? '<button class="pill-btn" data-act="nav" data-to="#/coach">Mở màn hội ý</button>' : `<button class="pill-btn" data-act="nav" data-to="#/summary/${esc(last.id)}">Xem trận đó</button>`}</section>`
    : `<section class="t today"><span>Chưa ghi trận nào có ${p.name ? esc(p.name) : 'người này'}.</span><button class="pill-btn" data-act="nav" data-to="#/setup">Bắt đầu ghi trận</button></section>`;
  const strip = [
    ['eff', 'Tấn công: (ghi − hỏng) chia số lần', a && a.k + e ? L.dec((a.k - e) / (a.k + e), 2) : '–'],
    ['srv', 'Phát bóng ăn điểm / hỏng', a ? `${a.ace} / ${a.se}` : '0 / 0'],
    ['recv', 'Đỡ bước 1 trung bình (thang 3)', a && a.rn ? L.dec(a.rsum / a.rn) : '–'],
  ].map(([k, l, v]) => `<div><span>${l}</span><b class="num" data-testid="ps-${k}">${v}</b></div>`).join('');
  return `<div class="pgrid-c">
    <section class="t profile" data-testid="profile" data-pid="${esc(p.id)}">
      <div class="ph">${avatar(p, 'ava-xl')}${credit(p)}</div>
      <div class="in">
        <span class="chip">Số ${p.num}</span><span class="chip">${esc(POS_NAME[p.pos || ''])}</span>
        <h2 data-testid="profile-name">${p.name ? esc(p.name) : 'Chưa có tên'}</h2>
        <p>${fmtH(p.h) ? `Cao ${fmtH(p.h)} · ` : ''}${esc(team.name)}</p>
        ${unv ? `<p class="q-note">${qmark(p, p.unv[0])} ${esc(p.note || 'Chưa xác minh')}</p>` : ''}
        <button class="pill-btn" data-act="editPlayer" data-pid="${esc(p.id)}" data-testid="edit-player">${ic('edit')}Sửa hồ sơ</button>
      </div>
      <div class="mini"><div><b data-testid="ps-matches">${a ? a.m : 0}</b>trận</div><div><b data-testid="ps-pts">${total}</b>điểm</div><div><b>${a ? a.b : 0}</b>điểm chắn</div></div>
    </section>
    ${hlTiles}${ringT}${mix}${bars}${today}
    <section class="t radar-card"><div class="lab-row"><div class="lab">Năm kỹ năng, ${cmpLbl} (nét đứt) <span class="info" tabindex="0" title="${RADAR_HELP}" aria-label="Cách tính: ${RADAR_HELP}">${ic('info-circle')}</span></div></div>
      ${has ? radar(ax, cmpAvg) : `<div class="empty-state chart" data-testid="radar-empty">${ghostRadar()}<b>Chưa có dữ liệu</b><span>Ghi 1 trận để thấy biểu đồ.</span></div>`}
      <details class="more-nums"><summary>Số liệu đầy đủ cho người ghi</summary><div class="kv" data-testid="stat-strip">${strip}</div><div class="ktiles" data-testid="pts-tiles">${tiles}</div></details>
    </section>
    ${courtCard(a, ui.courtSkill || 'atk')}
  </div>`;
}
const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function viewTeam() {
  const agg = teamAgg();
  const sorted = POS_ORDER.flatMap((k) => team.players.filter((p) => (p.pos || '') === k).sort((a, b) => a.num - b.num));
  const sel = team.players.find((p) => p.id === ui.selPid) || sorted[0] || null;
  const card = (p) => `<button class="pcard ${sel && sel.id === p.id ? 'on' : ''}" data-act="selPlayer" data-pid="${esc(p.id)}" data-testid="pc-${esc(p.id)}" ${sel && sel.id === p.id ? 'aria-current="true"' : ''}>
      ${avatar(p)}
      <span class="pc-main"><span class="pc-name">${p.name ? esc(p.name) : '<i>Chưa có tên</i>'}${qmark(p, 'name')}</span>
        <span class="pc-sub">${posChip(p.pos)}${qmark(p, 'pos')}<span class="pc-h">${fmtH(p.h)}</span></span></span>
      ${photoOf(p) ? `<span class="pc-no num">${p.num}</span>` : ''}
    </button>`;
  const groups = POS_ORDER.map((k) => {
    const ps = team.players.filter((p) => (p.pos || '') === k).sort((a, b) => a.num - b.num);
    return ps.length ? `<section class="pgroup"><h3>${POS_NAME[k]} <small>${ps.length}</small></h3><div class="pcards">${ps.map(card).join('')}</div></section>` : '';
  }).join('');
  const unvN = team.players.filter((p) => p.unv && p.unv.length).length;
  return `
  ${pageHead('Cầu thủ', 'Mỗi người mạnh ở đâu, có nên chuyền nhiều không, cần để ý gì — tính từ các trận đã ghi.', { back: '#/' })}
  <main class="page team">
    ${sel ? playerProfile(sel, agg) : ''}
    <section class="t roster">
      <div class="teamhead">
        <button class="teamname" data-act="openSheet" data-s="teamName" data-testid="team-name"><span class="tbadge">${esc(initials(team.name))}</span><span><b>${esc(team.name)}</b><small>${team.players.length} cầu thủ · chọn một người để xem ở trên</small></span></button>
        ${team.preset ? `<span class="srcbadge" data-testid="src-badge">${esc(team.preset)}</span>` : ''}
        <button class="pill-btn dark" data-act="editPlayer" data-pid="" data-testid="add-player">${ic('plus')}Thêm cầu thủ</button>
      </div>
      ${unvN ? `<p class="hint">Dấu <span class="q">?</span> = hai nguồn công khai ghi khác nhau (${unvN} VĐV). Chọn người đó rồi bấm <b>Sửa hồ sơ</b> để xem và sửa.</p>` : ''}
      ${groups || '<p class="empty">Chưa có VĐV nào.</p>'}
      <p class="hint">Chọn một người để xem ở trên; <b>Sửa hồ sơ</b> để đổi số áo, tên, vị trí, chiều cao, ảnh.</p>
      ${DATA.roster ? '<button class="btn" data-act="presetLP" data-testid="preset-lp">Nạp lại danh sách LPBank Ninh Bình (nguồn công khai)</button>' : ''}
    </section>
  </main>`;
}
function playerSheet() {
  const p = team.players.find((x) => x.id === ui.editPid) || null;
  const v = p || { num: Math.max(0, ...team.players.map((x) => x.num)) + 1, name: '', pos: '', h: null };
  const ph = photoOk(v.photo) ? v.photo : '';
  return `<h3>${p ? `Sửa VĐV số ${p.num}` : 'Thêm VĐV'}</h3>
    ${p && p.unv ? `<p class="warnline" data-testid="pf-note">Chưa xác minh: ${esc(p.note || '')} Lưu = HLV đã kiểm.</p>` : ''}
    <form id="playerForm" class="form">
      <div class="photo-row"><span id="pfAva">${avatar({ ...v, photo: ph || undefined }, 'ava-lg')}</span>
        <div class="photo-btns">
          <label class="btn filebtn">${ic('camera')}<span id="pfPhotoLbl">${ph ? 'Đổi ảnh' : 'Thêm ảnh'}</span><input type="file" accept="image/*" capture="environment" data-testid="pf-photo" aria-label="Chụp hoặc chọn ảnh VĐV"></label>
          <button class="btn" type="button" data-act="pfPhotoDel" data-testid="pf-photo-del" ${ph ? '' : 'hidden'}>${ic('trash')}Xoá ảnh</button>
        </div>
        <input type="hidden" name="photo" value="${ph}"></div>
      <p class="hint">Ảnh chỉ lưu trên máy này, cắt vuông 320 px. Không gửi vào Hỏi AI hay CSV.</p>
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
// Ảnh chọn/chụp → cắt giữa thành hình vuông 320px, JPEG 0,8 (~15–30 KB) để vừa localStorage.
async function pfPhoto(file) {
  const f = $('#playerForm');
  if (!file || !f) return;
  const err = $('#pfErr');
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 320;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    URL.revokeObjectURL(url);
    setPfPhoto(cv.toDataURL('image/jpeg', 0.8));
    err.textContent = '';
  } catch {
    err.textContent = 'Không đọc được ảnh này. Thử ảnh JPEG hoặc PNG khác.';
  }
}
function setPfPhoto(ph) {
  const f = $('#playerForm');
  f.elements.photo.value = ph;
  $('#pfAva').innerHTML = avatar({ num: f.elements.num.value, name: f.elements.name.value, photo: ph || undefined }, 'ava-lg');
  $('#pfPhotoLbl').textContent = ph ? 'Đổi ảnh' : 'Thêm ảnh';
  $('[data-testid=pf-photo-del]').hidden = !ph;
}
function submitPlayer(f) {
  const num = parseInt(f.elements.num.value, 10);
  const hs = f.elements.h.value.trim().replace(',', '.');
  const h = hs ? parseFloat(hs) : null;
  const err = $('#pfErr');
  if (!(num >= 0 && num <= 99)) return (err.textContent = 'Số áo từ 0 đến 99.');
  if (hs && !(h >= 1 && h <= 2.5)) return (err.textContent = 'Chiều cao ghi theo mét, ví dụ 1,75.');
  if (team.players.some((x) => x.num === num && x.id !== ui.editPid)) return (err.textContent = `Đã có VĐV số ${num}.`);
  const ph = f.elements.photo.value;
  const val = { num, name: f.elements.name.value.trim(), pos: f.elements.pos.value, h };
  const before = JSON.stringify(team);
  const p = team.players.find((x) => x.id === ui.editPid);
  let pid = p && p.id;
  if (p) { Object.assign(p, val); delete p.unv; delete p.note; } else { pid = 'p' + store.uid(); team.players.push({ id: pid, ...val }); }
  const q = team.players.find((x) => x.id === pid);
  if (photoOk(ph)) q.photo = ph; else delete q.photo;
  if (!saveTeam()) {
    // Máy không cho lưu (thường do ảnh làm đầy bộ nhớ): trả đội về như cũ, giữ bảng sửa mở.
    team = JSON.parse(before);
    store.saveTeam(team);
    return (err.textContent = photoOk(ph) ? 'Không lưu được: bộ nhớ máy đã đầy, ảnh quá nặng. Xoá bớt ảnh VĐV khác hoặc sao lưu rồi thử lại.' : 'Không lưu được vào máy. Hãy sao lưu JSON rồi thử lại.');
  }
  ui.selPid = pid;
  closeSheet();
  render();
}
function saveTeam() {
  if (!store.saveTeam(team)) return false;
  // Đồng bộ tên/số/vị trí sang trận đang ghi (giữ nguyên id nên nhật ký không lệch). Ảnh không chép vào trận.
  if (match && match.status === 'live') {
    for (const p0 of team.players) {
      const p = noPhoto(p0);
      const q = P(p.id);
      if (q) Object.assign(q, p);
      // VĐV mới vào dự bị — trừ khi trùng số áo với người đã có trong trận (vd sau khi nạp lại danh sách giữa trận).
      else if (!match.players.some((x) => x.num === p.num)) match.players.push({ ...p });
    }
    match.teamName = team.name;
    R = L.replay(match);
    store.saveMatch(match, R);
  }
  return true;
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
  ${pageHead('Trận mới', 'Chọn đối thủ và đội hình ra sân, rồi bắt đầu ghi từng pha.', { back: '#/' })}
  <main class="page setup">
    <form id="setup" class="form setup-grid">
      <section class="card form">
        <h2>Trận đấu</h2>
        <div class="field">Loại trận ${radio('type', 'official', [['practice', 'Đấu tập'], ['official', 'Chính thức']])}</div>
        ${lg.length ? `<label class="field">Đối thủ<select name="oppPick" data-testid="opp-pick"><option value="">Chọn đối thủ</option>
          ${lg.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}<option value="__other">Đội khác…</option></select></label>` : ''}
        <label class="field" id="oppOther" ${lg.length ? 'hidden' : ''}>${lg.length ? 'Tên đội khác' : 'Đối thủ'}<input name="opp" type="text" maxlength="60" placeholder="Tên đội bạn" data-testid="opp"></label>
        <div id="oppInfo" data-testid="opp-info"></div>
        <label class="field">Ngày<input name="date" type="date" value="${today}"></label>
        <div class="field">Thể thức ${radio('bestOf', '5', [['5', '5 set (thắng 3)'], ['3', '3 set (thắng 2)']])}</div>
        <div class="field">Phát bóng trước ${radio('server', 'us', [['us', esc(team.name)], ['them', 'Đối thủ']])}</div>
      </section>
      <section class="card form">
        <h2>Đội hình xuất phát set 1</h2>
        ${lineupFields(sg.lineup, sg.libero, 'Đề xuất đội hình 5-1 theo vị trí đã khai: chuyền hai P1, chủ công P2/P5, phụ công P3/P6, đối chuyền P4.')}
      </section>
      <div class="setup-go">
        <p class="err" id="setupErr" role="alert"></p>
        <button class="big primary" type="submit" data-testid="start-match">Bắt đầu ghi</button>
      </div>
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
    players: team.players.map(noPhoto),
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
        <div class="col"><div class="colh win">Ta ghi điểm</div>${wins}</div>
        <div class="col"><div class="colh lose">Ta mất điểm</div>${loses}</div>
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
    <button class="back" data-act="nav" data-to="#/" aria-label="Về Trận tới">${ic('chevron-left')}</button>
    <div class="meta"><b data-testid="set-no">Set ${s.n}</b> · Set thắng <b data-testid="sets">${R.winsUs}–${R.winsThem}</b><small>Ghi trận · bấm cách pha kết thúc</small></div>
    <button class="pill-btn" data-act="more" data-testid="more">Thêm ${ic('chevron-down')}</button>
  </header>
  ${warn}
  <main class="live ${rp ? 'has-recv' : ''}">
    <section class="board">
      <div class="score">
        <div class="side us ${c && c.serve === 'us' ? 'serving' : ''}"><span class="tn">${esc(match.teamName)}</span><span class="pts" data-testid="score-us">${s.us}</span>${c && c.serve === 'us' ? '<span class="sv" data-testid="serve-us">● Đang phát</span>' : ''}</div>
        <div class="side them ${c && c.serve === 'them' ? 'serving' : ''}"><span class="tn">${esc(match.opponent)}</span><span class="pts" data-testid="score-them">${s.them}</span>${c && c.serve === 'them' ? '<span class="sv" data-testid="serve-them">● Đang phát</span>' : ''}</div>
      </div>
      ${c ? `<div class="rotline"><span>Xoay vòng <b data-testid="rot">${'P' + (c.order.indexOf(c.ref) + 1)}</b></span><span>Hội ý: ta còn ${tl}, đối còn ${2 - c.to.them}</span></div>${court(c)}` : ''}
      ${AIL.isConfigured() && !R.over && !R.needStart ? `<div class="lastrow">${lastLine}<div id="voice-host" class="voice" data-testid="voice-host"></div></div>` : lastLine}${rp}
    </section>
    <section class="entry">${body}</section>
  </main>
  <nav class="bottombar">
    <button data-act="undo" data-testid="undo">Hoàn tác</button>
    <button data-act="timeout" data-side="us" ${!c || c.over || tl <= 0 ? 'disabled' : ''} data-testid="timeout">Hội ý ta</button>
    <button class="coachbtn" data-act="nav" data-to="#/coach" data-testid="coach">Hội ý</button>
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
  const ah = $('#ail-ask-host');
  if (ah) { const m = byId(ui.aiId), n = ui.aiSet; AIL.mountAsk(ah, { getStats: () => AI.aiData(m, n) }); }
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
  ${pageHead(`Các pha (${R.rallies.length})`, 'Bấm một pha để sửa hoặc xoá nếu lúc nãy ghi nhầm.', { back: '#/live' })}
  <main class="page"><p class="hint">Bấm vào một pha để sửa hoặc xoá. Tỉ số, xoay vòng và thống kê tự tính lại.</p>${ign}<div class="rlist">${rows || '<p>Chưa có pha nào.</p>'}</div></main>`;
}

// ---------- Màn HLV ----------
// Ô số liệu chính (side-out, break-point, đỡ bước 1, chuỗi điểm): nằm trong dải dưới của khung nhấn màn HLV.
function kpiCells(st, run) {
  const recvAvg = st.recv.n ? L.dec(st.recv.sum / st.recv.n) : '–';
  const kpi = (label, id, val, sub, cls = '') => `<div class="kpi ${cls}"><span>${label}</span><p><b class="num" ${id ? `data-testid="${id}"` : ''}>${val}</b></p><small>${sub}</small></div>`;
  return kpi('Khi đối thủ phát, ta giành', 'so', L.pct(st.soW, st.soN), `${st.soW}/${st.soN} pha`)
    + kpi('Lượt ta phát, ta ăn', 'bp', L.pct(st.bpW, st.bpN), `${st.bpW}/${st.bpN} điểm`)
    + kpi('Đỡ bước 1 trung bình', 'recv-avg', recvAvg, `${st.recv.n} lần chấm · thang 0–3`)
    + (run ? `<div class="kpi hi"><span>Chuỗi điểm</span><p><b class="num ${run.len ? (run.side === 'us' ? 'c-win' : 'c-lose') : ''}">${run.len ? (run.side === 'us' ? '▲ ' : '▼ ') + run.len : '–'}</b></p><small data-testid="run">${run.len ? `Chuỗi hiện tại: ${run.side === 'us' ? 'ta' : 'đối thủ'} ${run.len} điểm` : 'Chưa có pha'}</small></div>`
      : kpi('Điểm', '', `${st.won}–${st.lost}`, `${st.n} pha`, 'hi'));
}
// So sánh hai đội bằng thanh đôi (ta · nhãn · đối thủ). Điểm của đối thủ suy ra từ các pha ta mất điểm.
function vsBars(s) {
  const rows = [
    ['Tấn công ghi điểm', s.atk, s.oat],
    ['Chắn bóng ghi điểm', s.blk, s.bkd],
    ['Phát bóng ăn điểm / đỡ hỏng', s.ace, s.rer],
    ['Điểm từ lỗi bên kia', s.oer, s.aer + s.ser + s.xer],
  ];
  return `<div class="vs" data-testid="vs-bars"><div class="vs-h"><span class="us">Ta</span><span>Điểm ghi theo cách</span><span class="op">Đối thủ</span></div>
    ${rows.map(([l, u, o]) => { const t = u + o || 1; return `<div class="vs-r"><b class="num">${u}</b><span>${l}</span><b class="num">${o}</b><i class="vs-bar"><i class="u" style="width:${((u / t) * 100).toFixed(1)}%"></i><i class="o" style="width:${((o / t) * 100).toFixed(1)}%"></i></i></div>`; }).join('')}</div>`;
}
function insightsCard(st, setN, isCur) {
  const ins = L.insights(match, st, isCur);
  return `<section class="t insights" data-testid="insights"><div class="lab-row"><div class="lab">Số liệu nói gì · tự tính từ các pha đã ghi, ${setN ? 'set ' + setN : 'cả trận'}</div></div><ol>${ins.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol>${vsBars(st.src)}</section>`;
}
function coachBlocks(setN, isCur, run, heroKpis = false, noIns = false) {
  const st = L.stats(match, R, setN);
  const rotBy = Object.fromEntries(st.rot.map((x) => [x.k, x]));
  const cell = (k) => {
    const x = rotBy[k];
    const h = x.n ? Math.min(1, Math.abs(x.diff) / Math.max(4, x.n / 2)) : 0;
    return `<div data-testid="rot-${x.k}" class="hz ${x.diff > 0 ? 'up' : x.diff < 0 ? 'down' : ''} ${st.worst && st.worst.k === x.k ? 'worst' : ''}" style="--h:${h.toFixed(2)}">
      <span class="hz-k">${x.k}</span><b class="num" data-c="diff">${x.diff > 0 ? '+' : ''}${x.diff}</b><span class="hz-wl" title="Thắng–thua"><span class="num" data-c="wl">${x.won}–${x.lost}</span> pha</span>
      <span class="hz-r">Đỡ phát <span class="num" data-c="so">${L.pct(x.soW, x.soN)}<small>${x.soN ? ` ${x.soW}/${x.soN}` : ''}</small></span></span>
      <span class="hz-r">Ta phát <span class="num" data-c="bp">${L.pct(x.bpW, x.bpN)}<small>${x.bpN ? ` ${x.bpW}/${x.bpN}` : ''}</small></span></span></div>`;
  };
  const passRows = st.passers.map((q) => `<tr data-testid="pass-${q.pid}"><th>${pname(q.pid)}</th><td data-c="avg">${L.dec(q.avg)}</td><td data-c="n">${q.n}</td></tr>`).join('');
  const atk = st.players.filter((p) => p.k + p.e > 0).map((p) => `<tr data-testid="atk-${p.pid}"><th>${pname(p.pid)}</th><td data-c="k">${p.k}</td><td data-c="e">${p.e}</td><td data-c="eff">${p.eff == null ? '–' : L.dec(p.eff, 2)}</td><td data-c="b">${p.b}</td></tr>`).join('');
  const srv = st.players.filter((p) => p.ace + p.se > 0).map((p) => `<tr data-testid="srv-${p.pid}"><th>${pname(p.pid)}</th><td data-c="ace">${p.ace}</td><td data-c="se">${p.se}</td></tr>`).join('');
  const s = st.src;
  const bars = (keys, cls) => {
    const mx = Math.max(1, ...keys.map(([k]) => s[k]));
    return keys.map(([k, lbl]) => `<li><span class="bl">${lbl}</span><span class="bar ${cls}"><i style="width:${((s[k] / mx) * 100).toFixed(1)}%"></i></span><b class="num" data-testid="src-${k}">${s[k]}</b></li>`).join('');
  };
  return `
  ${heroKpis ? '' : `<section class="kpis">${kpiCells(st, run)}</section>`}
  ${noIns ? '' : insightsCard(st, setN, isCur)}
  <section class="card rotcard"><div class="card-h"><div><h2>Điểm theo xoay vòng</h2><p class="sub">Hiệu số điểm theo vị trí chuyền hai</p></div></div>
    <div class="heat" data-testid="rot-grid"><div class="net">Lưới</div>${['P4', 'P3', 'P2', 'P5', 'P6', 'P1'].map(cell).join('')}</div>
    <p class="hint">Xoay vòng = vị trí của chuyền hai (P1–P6). Số lớn = hiệu số điểm. Viền cam = vòng kém nhất. "Đỡ phát" = khi đối thủ phát, ta giành được bao nhiêu pha; "Ta phát" = lượt ta phát ăn bao nhiêu điểm.</p></section>
  <section class="card srccard"><div class="card-h"><div><h2>Nguồn điểm</h2><p class="sub">Ta ghi và mất điểm bằng cách nào</p></div></div><div class="src">
    <div class="for"><p class="src-h">Ta ghi <b class="num" data-testid="won">${st.won}</b></p><ul>${bars([['atk', 'Tấn công'], ['blk', 'Chắn bóng'], ['ace', 'Phát bóng ăn điểm'], ['oer', 'Đối thủ lỗi'], ...(s.uw ? [['uw', 'Không rõ cách']] : [])], 'win')}</ul></div>
    <div class="against"><p class="src-h">Ta mất <b class="num" data-testid="lost">${st.lost}</b></p><ul>${bars([['aer', 'Lỗi tấn công'], ['bkd', 'Bị chắn'], ['ser', 'Lỗi phát bóng'], ['rer', 'Đỡ hỏng / bị ace'], ['xer', 'Lỗi khác'], ['oat', 'Đối thủ tấn công'], ...(s.ul ? [['ul', 'Không rõ cách']] : [])], 'lose')}</ul></div>
  </div></section>
  <section class="card"><h2>Tấn công</h2>${atk ? `<table class="tbl"><thead><tr><th>Cầu thủ</th><th>Ghi</th><th>Hỏng</th><th>Ghi trừ hỏng</th><th>Chắn</th></tr></thead><tbody>${atk}</tbody></table>` : '<p class="empty">Chưa có pha tấn công kết thúc.</p>'}
    <p class="hint">Hỏng = đánh hỏng + bị chắn. "Ghi trừ hỏng" chia cho số lần tấn công kết thúc pha: càng gần 1 càng tốt, âm là hỏng nhiều hơn ghi.</p></section>
  <section class="card"><h2>Đỡ bước 1 theo người</h2>${passRows ? `<table class="tbl"><thead><tr><th>Cầu thủ</th><th>Trung bình /3</th><th>Lần</th></tr></thead><tbody>${passRows}</tbody></table>` : '<p class="empty">Chưa chấm đỡ bước 1 theo người.</p>'}</section>
  <section class="card"><h2>Phát bóng</h2><p class="big-num">Ăn điểm <b class="num" data-testid="ace">${st.ace}</b><span class="sep"></span>Hỏng <b class="num" data-testid="se">${st.se}</b></p>
    ${srv ? `<table class="tbl"><thead><tr><th>Cầu thủ</th><th>Ăn điểm</th><th>Hỏng</th></tr></thead><tbody>${srv}</tbody></table>` : ''}</section>`;
}

// ---------- Hội ý: 1 câu kết luận + tối đa 3 thẻ (Đang yếu ở / Đang mạnh ở / Nên thử), chi tiết thu gọn ----------
const WIN_SRC = [['atk', 'tấn công'], ['blk', 'chắn bóng'], ['ace', 'phát bóng'], ['oer', 'đối thủ tự hỏng']];
const LOSE_SRC = [['oat', 'đối thủ tấn công'], ['aer', 'lỗi tấn công'], ['bkd', 'bị chắn'], ['ser', 'lỗi phát bóng'], ['rer', 'đỡ phát hỏng'], ['xer', 'lỗi khác']];
const numOf = (pid) => { const p = P(pid); return p ? `số ${p.num}` : 'một người'; };
// Phương án AI soạn trước trận — chỉ khi đang đấu đúng đội đã có báo cáo.
function scoutPlanFor(m) {
  const sm = DATA.scout && DATA.scout.match;
  const P = sm && m && norm(sm.opponent) === norm(m.opponent) && Array.isArray(DATA.scout.plans) && DATA.scout.plans[0];
  return P && P.plan && typeof P.plan.id === 'string' ? P.plan.id : null;
}
function coachCards(st) {
  if (st.n < 6) return [];
  const s = st.src;
  const out = [];
  // Đang yếu ở: chọn vấn đề nặng nhất (cùng thang ưu tiên với phần nhận định tự động).
  const weak = [];
  let bad = null;
  for (const p of st.players) if (p.e >= 3 && p.e > p.k && (!bad || p.e - p.k > bad.e - bad.k)) bad = p;
  if (bad) weak.push([6 + (bad.e - bad.k) * 2, { n: bad.e, d: bad.k + bad.e, title: `${numOf(bad.pid).replace(/^s/, 'S')} tấn công hỏng ${bad.e}/${bad.k + bad.e} lần`, text: `Nên hạn chế chuyền cho ${numOf(bad.pid)} lúc này.`, tip: `Bớt chuyền cho ${numOf(bad.pid)}.` }]);
  const w = st.worst;
  if (w && w.n >= 4 && w.diff <= -2) weak.push([10 + (w.lost - w.won) * 2, { n: w.lost, d: w.n, title: `Xoay vòng ${w.k}: mất ${w.lost}/${w.n} pha`, text: `Khi chuyền hai đứng ở vị trí ${w.k.slice(1)}, ta mất điểm nhiều nhất. Cân nhắc thay người hoặc đổi cách đỡ phát ở vòng này.`, tip: `Để ý xoay vòng ${w.k}.` }]);
  let wp = null;
  for (const p of st.passers) if (p.n >= 4 && p.avg < 1.5 && (!wp || p.avg < wp.avg)) wp = p;
  if (wp) weak.push([7 + Math.round((1.5 - wp.avg) * 10), { n: Math.round(wp.avg * 10) / 10, d: 3, label: `${L.dec(wp.avg)}/3`, title: `${numOf(wp.pid).replace(/^s/, 'S')} đỡ bước 1 chỉ ${L.dec(wp.avg)} trên thang 3`, text: 'Cho libero ôm rộng sang phía người này khi đối thủ phát.', tip: `Kèm đỡ phát cho ${numOf(wp.pid)}.` }]);
  if (st.se >= 3 && st.se > st.ace * 2) weak.push([6 + st.se - st.ace, { n: st.se, d: st.bpN, title: `Phát bóng hỏng ${st.se}/${st.bpN} lượt`, text: 'Phát an toàn hơn, nhất là khi đang sát điểm.', tip: 'Phát an toàn hơn.' }]);
  const own = s.aer + s.ser + s.xer;
  if (st.lost >= 6 && own / st.lost >= 0.5) weak.push([4 + own, { n: own, d: st.lost, title: `Ta tự hỏng ${own}/${st.lost} điểm mất`, text: 'Đối thủ chưa phải ép nhiều — bớt đánh mạo hiểm.', tip: 'Bớt tự hỏng.' }]);
  weak.sort((a, b) => b[0] - a[0]);
  if (weak[0]) out.push({ tone: 'peach', k: 'Đang yếu ở', ...weak[0][1] });
  // Đang mạnh ở: cách ghi điểm nhiều nhất + người góp nhiều nhất.
  const top = WIN_SRC.filter(([k]) => s[k] > 0).sort((a, b) => s[b[0]] - s[a[0]])[0];
  if (top) {
    const f = { atk: 'k', blk: 'b', ace: 'ace' }[top[0]];
    const star = f ? st.players.filter((p) => p[f] > 0).sort((a, b) => b[f] - a[f])[0] : null;
    const title = { atk: `Tấn công: ta ghi ${s.atk} điểm`, blk: `Chắn bóng: ta ăn ${s.blk} điểm`, ace: `Phát bóng ăn trực tiếp ${s.ace} điểm`, oer: `Đối thủ tự hỏng ${s.oer} điểm` }[top[0]];
    out.push({ tone: 'mint', k: 'Đang mạnh ở', n: s[top[0]], d: st.won, title, text: star ? `Riêng ${numOf(star.pid)} góp ${star[f]} trong ${s[top[0]]} điểm đó. Giữ ${numOf(star.pid)} trên sân.` : `${s[top[0]]} trong ${st.won} điểm ta ghi.` });
  }
  // Nên thử: người đang tấn công tốt (không trùng người đang yếu), hoặc xoay vòng đang thắng, hoặc phương án soạn trước trận.
  const hot = st.players.filter((p) => p.k >= 3 && p.eff != null && p.eff >= 0.3 && (!bad || p.pid !== bad.pid)).sort((a, b) => b.k - a.k)[0];
  const bestR = st.rot.filter((x) => x.n >= 4 && x.diff >= 2).sort((a, b) => b.diff - a.diff)[0];
  const pid = scoutPlanFor(match);
  const plan = pid && DATA.scout.plans[0].plan;
  if (hot) out.push({ tone: 'lav', k: 'Nên thử', n: hot.k, d: hot.k + hot.e, title: `Chuyền nhiều hơn cho ${numOf(hot.pid)}`, text: `${numOf(hot.pid).replace(/^s/, 'S')} tấn công ghi ${hot.k}/${hot.k + hot.e} lần kết thúc pha.` });
  else if (bestR) out.push({ tone: 'lav', k: 'Nên thử', n: bestR.won, d: bestR.n, title: `Giữ đội hình như ở xoay vòng ${bestR.k}`, text: `Ta thắng ${bestR.won}/${bestR.n} pha ở vòng này — cách đỡ phát ở đây đang chạy tốt.` });
  else if (plan) out.push({ tone: 'lav', k: 'Nên thử', plan: plan.id, title: plan.name, text: 'Phương án AI soạn trước trận — HLV quyết. Bấm Mở phương án để xem trên sân.' });
  return out.slice(0, 3);
}
function coachSentence(st, cards) {
  if (st.n < 6) return `Mới có ${st.n} pha — chưa đủ để kết luận. Cứ ghi tiếp, từ pha thứ 6 sẽ có nhận xét.`;
  const s = st.src, d = st.won - st.lost;
  const win = WIN_SRC.filter(([k]) => s[k] > 0).sort((a, b) => s[b[0]] - s[a[0]])[0];
  const lose = LOSE_SRC.filter(([k]) => s[k] > 0).sort((a, b) => s[b[0]] - s[a[0]])[0];
  let lead;
  if (d > 0) lead = `Ta hơn ${d} điểm${win ? ` nhờ <span class="mk">${win[1]}</span>` : ''}.`;
  else if (d < 0) lead = `Ta kém ${-d} điểm${lose ? `, mất nhiều nhất vì <span class="mk">${lose[1]}</span>` : ''}.`;
  else lead = `Hai đội đang ngang điểm${win ? `, ta ghi nhiều nhất bằng <span class="mk">${win[1]}</span>` : ''}.`;
  const weak = cards.find((c) => c.tone === 'peach');
  return `${lead}${weak ? ' ' + esc(weak.tip) : ''}`;
}
// Đường chênh lệch điểm qua từng pha (trên 0 = ta dẫn).
function worm(rs) {
  if (rs.length < 2) return '';
  const W = 340, H = 60, d = rs.map((r) => r.usA - r.themA), m = Math.max(3, ...d.map(Math.abs));
  const X = (i) => (i * W) / (d.length - 1), Y = (v) => H / 2 - (v / m) * (H / 2 - 4);
  const path = d.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg class="worm" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chênh lệch điểm qua ${d.length} pha"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="w0"/><path d="${path} L${W},${H / 2} L0,${H / 2} Z" class="wa"/><path d="${path}" class="wl"/></svg>`;
}
function viewCoach() {
  const c = R.cur;
  const setN = ui.coachFilter === 'set' && c ? c.n : null;
  const run = L.currentRun(R.rallies.filter((r) => !c || r.set === c.n));
  const st = L.stats(match, R, setN);
  const cards = coachCards(st);
  const setRs = R.rallies.filter((r) => !c || r.set === c.n);
  const streak = run && run.len >= 2 ? `${run.side === 'us' ? 'Ta' : 'Đối thủ'} vừa ghi ${run.len} điểm liên tiếp` : setRs.length ? `${setRs.length} pha trong set này` : 'Chưa có pha nào';
  const card = (x) => `<section class="t act tile-${x.tone}"><div class="hd"><span class="k">${x.k}</span>${x.plan ? `<span class="ic-b">${ic('target')}</span>` : ring(x.n, x.d, x.tone, 92, x.label || null)}</div><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></section>`;
  const scope = setN ? `set ${setN}` : 'cả trận';
  return `
  ${pageHead('Hội ý', 'Đọc trong 30 giây: đang yếu ở đâu, đang mạnh ở đâu, nên thử gì.', { back: '#/live', backId: 'coach-back', backText: 'Ghi trận', backLabel: 'Quay lại ghi trận',
    actions: `<span class="live-pill"><i class="livedot"></i>Đang hội ý · Set ${c ? c.n : 1}</span>` })}
  <main class="page coach bento">
    <section class="t tile-sky score-t">
      <div class="teams"><span>${esc(match.teamName)}</span><span>${esc(match.opponent)}</span></div>
      <div class="sc"><b>${c ? c.us : 0}</b><i>–</i><b class="them">${c ? c.them : 0}</b></div>
      <div class="streak">${esc(streak)}</div>
      <div class="worm-box">${worm(setRs)}</div>
      <p class="muted sets-line">Set thắng ${R.winsUs}–${R.winsThem}${R.sets.length > 1 ? ` · các set: ${esc(L.setScores(R).join(', '))}` : ''}</p>
    </section>
    <section class="t concl">
      <div class="lab-row"><div class="lab">Tóm lại · ${scope}</div>
        <div class="chips-f" role="group" aria-label="Phạm vi số liệu">
          <button data-act="filter" data-f="set" class="fchip ${ui.coachFilter === 'set' ? 'on' : ''}" data-testid="f-set" aria-pressed="${ui.coachFilter === 'set'}">Set này</button>
          <button data-act="filter" data-f="match" class="fchip ${ui.coachFilter === 'match' ? 'on' : ''}" data-testid="f-match" aria-pressed="${ui.coachFilter === 'match'}">Cả trận</button>
        </div></div>
      <h2 data-testid="coach-sentence">${coachSentence(st, cards)}</h2>
      <div class="chips-s"><span>Lượt ta phát: ăn ${st.bpW}/${st.bpN} điểm</span><span>Khi đối thủ phát: giành ${st.soW}/${st.soN} pha</span></div>
      <div class="acts"><button class="pill-btn dark" data-act="ai" data-id="${match.id}" data-set="${setN || ''}" data-testid="ai-coach">Hỏi AI</button><button class="pill-btn" data-act="openPlan" data-id="${esc(scoutPlanFor(match) || '')}" data-testid="open-plan">Mở phương án</button></div>
    </section>
    ${cards.map(card).join('')}
    ${insightsCard(st, setN, setN != null && c && !c.over)}
    <details class="t more">
      <summary>Xem chi tiết ${scope}<span class="p"><span>số liệu đầy đủ</span><i>${ic('chevron-down')}</i></span></summary>
      <div class="more-in">
        <section class="kpis">${kpiCells(st, run)}</section>
        ${coachBlocks(setN, setN != null && c && !c.over, run, true, true)}
      </div>
    </details>
  </main>`;
}

// ---------- Tổng kết / lịch sử ----------
function viewSummary(id) {
  const m = id === (match && match.id) ? match : store.loadMatch(id);
  if (!m) return pageHead('Không tìm thấy trận', 'Trận này không còn trên máy.', { back: '#/history' });
  const keepM = match, keepR = R;
  match = m; R = L.replay(m);
  const sets = R.sets.map((s) => `<td>${s.us}–${s.them}</td>`).join('');
  const html = `
  ${pageHead('Tổng kết trận', 'Kết quả, số liệu cả trận; in, chia sẻ hoặc xuất file cho người phân tích.', { back: '#/history', cls: 'noprint' })}
  <main class="page summary">
    <section class="hero sumhead">
    <span class="hero-mark" aria-hidden="true">${esc(initials(m.teamName))}</span>
    <div class="hero-main">
    <div class="hl-head"><span class="pill live-pill">${R.winsUs > R.winsThem ? 'Thắng' : R.winsUs < R.winsThem ? 'Thua' : 'Hoà'}</span><span>${X.TYPE_LABEL[m.type]} · ${X.fmtDate(m.date)} · ${R.rallies.length} pha${m.status === 'live' ? ' · <b>đang ghi</b>' : ''}</span></div>
    <h2 class="stitle">${esc(m.teamName)} ${R.winsUs}–${R.winsThem} ${esc(m.opponent)}</h2>
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
    </div>
    </section>
    <div class="cgrid">${coachBlocks(null, false)}</div>
  </main>`;
  match = keepM; R = keepR;
  return html;
}
function viewHistory() {
  const list = store.listMatches().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const rows = list.map((x) => `<div class="hrow">
      <button class="hmain" data-act="nav" data-to="#/summary/${esc(x.id)}"><span class="tbadge muted-b">${esc(initials(x.opp))}</span><span class="hm-main"><b>${esc(x.opp)}</b><span>${esc(X.fmtDate(String(x.date || '')))} · ${X.TYPE_LABEL[x.type] || ''}${x.status === 'live' ? ' · đang ghi' : ''}</span><small>${esc((x.sets || []).map((s) => s.join('–')).join(', '))}</small></span><span class="mrow-res ${x.winsUs > x.winsThem ? 'w' : x.winsUs < x.winsThem ? 'l' : ''}">${esc(x.winsUs)}–${esc(x.winsThem)}</span></button>
      ${x.status === 'live' ? `<button class="btn-sm" data-act="resume" data-id="${esc(x.id)}">Tiếp tục</button>` : ''}
      <button class="btn-sm danger" data-act="delMatch" data-id="${esc(x.id)}" aria-label="Xoá trận">Xoá</button></div>`).join('');
  const done = list.filter((x) => x.status !== 'live');
  const W = done.filter((x) => x.winsUs > x.winsThem).length, Lz = done.filter((x) => x.winsUs < x.winsThem).length;
  const cell = (l, v, hi) => `<div class="${hi ? 'hi' : ''}"><span>${l}</span><p><b class="num">${v}</b></p></div>`;
  return `${pageHead('Lịch sử trận', 'Mọi trận đã ghi trên máy này. Bấm một trận để xem tổng kết.', { back: '#/' })}
  <main class="page history">
    <section class="hero slim-hero"><span class="hero-mark" aria-hidden="true">${esc(initials(team.name))}</span>
      <div class="hero-main"><span class="eyebrow">${esc(team.name)}</span><h2 class="hero-name">Mùa 2026</h2><p class="hero-sub"><span>Bấm một trận để xem tổng kết, xuất CSV/JSON hoặc hỏi AI</span></p></div>
      <div class="strip">${cell('Trận đã lưu', list.length)}${cell('Chính thức', list.filter((x) => x.type === 'official').length)}${cell('Đấu tập', list.filter((x) => x.type === 'practice').length)}${cell('Thắng – thua', `${W}–${Lz}`, true)}</div>
    </section>
    <section class="card hlist"><div class="card-h"><div><h2>Tất cả trận</h2><p class="sub">Mới nhất trước</p></div></div>${rows || '<p class="hint">Chưa có trận nào.</p>'}</section>
  </main>`;
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
    ${AIL.isConfigured() ? `<div class="ask-box"><p class="hint">Hỏi thẳng trợ lý AI của đội (cần mạng). Câu trả lời chỉ để tham khảo — HLV quyết.</p><div id="ail-ask-host"></div></div><p class="hint"><b>Hoặc</b> sao chép số liệu để dán vào trang AI khác:</p>` : ''}
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
  // Đối đầu với ta: 5 trận đã lưu gần nhất gặp đội này (không có trận nào thì không hiện).
  const h2h = store.listMatches().filter((x) => x.status !== 'live' && norm(x.opp) === norm(t.name))
    .sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 5);
  const form = h2h.length ? `<p class="h2h" data-testid="opp-form"><span>Đối đầu với ta</span>${h2h.map((x) => { const w = x.winsUs > x.winsThem; return `<i class="fc ${w ? 'w' : 'l'}" title="${esc(X.fmtDate(String(x.date || '')))}: ${x.winsUs}–${x.winsThem}">${w ? 'T' : 'B'}</i>`; }).join('')}</p>` : '';
  return `<details class="card oppteam" data-testid="opp-team" data-id="${esc(t.id)}" ${open ? 'open' : ''}>
    <summary><span class="tbadge">${esc(initials(t.name))}</span><span class="sm-main"><b>${esc(t.name)}</b><small>${t.coach ? 'HLV ' + esc(t.coach) + ' · ' : ''}${t.tendencies.length} nhận xét · độ tin cậy ${esc(t.confidence)}</small></span>${ic('chevron-down')}</summary>
    ${form}<p>${esc(t.summary)}</p>
    <h3>Cầu thủ có nguồn</h3>${ps ? `<ul class="opl">${ps}</ul>` : '<p class="hint">Chưa có danh sách cầu thủ từ báo/Wikipedia.</p>'}
    <h3>Xu hướng theo bình luận viên</h3>${td ? `<ul class="otd">${td}</ul>` : '<p class="hint">Chưa có video phân tích lối chơi.</p>'}
    ${srcs.length ? `<p class="hint">Nguồn: ${srcs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join(', ')}</p>` : ''}
  </details>`;
}
function viewOpp(id) {
  const d = DATA.opp;
  const head = pageHead('Các đội trong giải', 'Nhận xét có nguồn về từng đội, kèm link video đúng đoạn.', { back: '#/scout' });
  if (!d) return head + '<main class="page"><p class="err">Chưa tải được dữ liệu hồ sơ (cần mở app có mạng ít nhất một lần).</p></main>';
  const nTd = d.teams.reduce((s2, t) => s2 + t.tendencies.length, 0);
  const nPl = d.teams.reduce((s2, t) => s2 + t.players.length, 0);
  const cell = (l, v, hi) => `<div class="${hi ? 'hi' : ''}"><span>${l}</span><p><b class="num">${v}</b></p></div>`;
  return `${head}<main class="page opp">
    <section class="hero slim-hero"><span class="hero-mark" aria-hidden="true">VĐ</span>
      <div class="hero-main"><span class="eyebrow">VĐQG 2026 · cập nhật ${X.fmtDate(d.generated)}</span><h2 class="hero-name">Hồ sơ đối thủ</h2>
        <p class="srcnote" data-testid="opp-label"><b>${esc(d.label)}</b> · cập nhật ${X.fmtDate(d.generated)}</p></div>
      <div class="strip">${cell('Đội có hồ sơ', d.teams.length)}${cell('Cầu thủ có nguồn', nPl)}${cell('Nhận xét lối chơi', nTd)}${cell('Đội trong giải', ((d.league && d.league.teams) || []).length || '–', true)}</div>
    </section>
    <p class="hint">${esc(d.method)} Mở link YouTube cần có mạng.</p>
    <div class="oppgrid">${d.teams.map((t, i) => teamBrief(t, id ? t.id === id : i === 0)).join('')}</div>
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
  const head = pageHead('Xem lại video', 'Mở video trận, khớp với các pha đã ghi để xem lại đúng đoạn.', { back: '#/' });
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

function doBackup() {
  const all = store.listMatches().map((x) => store.loadMatch(x.id)).filter(Boolean);
  X.download(`scout_saoluu_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(X.backup(team, all), null, 1), 'application/json');
}

// ---------- sự kiện ----------
document.addEventListener('click', (e) => {
  // Nút của module (bàn chiến thuật, báo cáo, trợ lý AI) do module tự xử lý — kể cả khi module đã vẽ lại nút đó
  // trước khi sự kiện tới đây (nút đã rời trang), nên xét đường đi của sự kiện chứ không xét vị trí hiện tại.
  if (e.composedPath().some((n) => n.id && /^(mod-host|voice-host|ail-settings-host|ail-ask-host)$/.test(n.id))) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = el.dataset.act;
  const d = el.dataset;
  switch (a) {
    case 'nav': closeSheet(); go(d.to); break;
    case 'openPlan': openPlan(d.id); break;
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
    case 'selPlayer': ui.selPid = d.pid; ui.scrollTop = true; go('#/team/' + encodeURIComponent(d.pid)); break;
    case 'pfPhotoDel': setPfPhoto(''); break;
    case 'courtSkill': ui.courtSkill = d.sk; render(); break;
    case 'navBackup': doBackup(); break;
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
    case 'backup': doBackup(); break;
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
  else if (el.dataset.testid === 'pf-photo') { pfPhoto(el.files && el.files[0]); el.value = ''; }
  else if (el.dataset.top === 'match' && el.value) go('#/summary/' + el.value);
  else if (el.dataset.top === 'search') {
    const p = team.players.find((x) => `#${x.num} ${x.name || ''}` === el.value)
      || team.players.find((x) => (x.name || '').toLowerCase().includes(el.value.trim().toLowerCase()) && el.value.trim());
    if (p) go('#/team/' + encodeURIComponent(p.id));
  }
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

// ---------- ảnh đi kèm ----------
// credits.json nhận 2 dạng: { "11": {author, license, source, name} } hoặc [{ num: 11, author, … }].
function normCredits(d) {
  const out = {};
  const list = Array.isArray(d) ? d : d && Array.isArray(d.photos) ? d.photos : d && typeof d === 'object' ? Object.entries(d).map(([k, v]) => ({ num: k, ...v })) : [];
  for (const c of list) if (c && Number.isFinite(+c.num) && typeof c === 'object') out[String(+c.num)] = c;
  return out;
}
// Ảnh xem thử (data/photos-local, không đưa lên mạng, không vào bộ nhớ đệm offline): chỉ đọc khi chạy
// trên máy (localhost) và không phải test tự động; danh sách lấy từ sources.json nên không dò file thiếu.
async function loadLocalPhotos() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || window.__SCOUT_TEST) return;
  const list = await loadJSON('data/photos-local/sources.json');
  for (const c of Array.isArray(list) ? list : []) {
    if (c && Number.isFinite(+c.num) && /^[\w-]+\.(jpe?g|png|webp)$/i.test(c.file || '')) DATA.localPhotos.set(+c.num, c);
  }
  if (DATA.localPhotos.size) render();
}
// Ảnh đi kèm tải lỗi (mất mạng, file thiếu) → thay bằng huy hiệu số áo, không làm vỡ bố cục.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
  const box = img.parentElement;
  box.classList.add('ava-num');
  box.textContent = box.dataset.num || '?';
}, true);

// ---------- khởi động ----------
[DATA.roster, DATA.opp, DATA.photos, DATA.scout] = await Promise.all([loadJSON('data/roster-lpbank.json'), loadJSON('data/opponents.json'), loadJSON('data/photos/credits.json'), loadJSON('data/scout/xmls-thanh-hoa.json')]);
DATA.photos = normCredits(DATA.photos);
DATA.localPhotos = new Map();
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
loadLocalPhotos();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* bỏ qua */ }
