// Hồ sơ cầu thủ đối thủ ("sidekick") + ảnh đại diện trên thẻ cầu thủ.
//
// - avatarHtml(p, { photo, size }): ảnh tròn nếu có ảnh đã ghi công, không thì chữ cái đầu tên, kèm huy hiệu số áo.
// - loadCredits(teamKey): đọc data/photos/opp/<teamKey>/credits.json ([{num,name,author,license,source,file?}]) nếu teamKey có trong
//   data/photos/opp/index.json; thiếu → [].
// - sidekick: một khung duy nhất — màn ≥1024px là panel bên phải (trang vẫn thấy), hẹp hơn là bottom sheet.
//   Đóng bằng ✕, Esc, chạm ra ngoài; ← → hoặc nút mũi tên để sang người trước/sau.
// - thProfiles(D, P, credits): hồ sơ cầu thủ Thanh Hóa (báo cáo scout + data/scout/players-<đội>.json).
// - mountOppPlayers(root, opp): thẻ cầu thủ có ảnh đại diện + mở hồ sơ ở màn #/opp (dữ liệu data/opponents.json).
// Nguyên tắc: chỉ hiện điều có trong dữ liệu, mỗi ý kèm nguồn + độ chắc; "chỗ nên khai thác" chỉ suy từ một điểm yếu đã ghi
// và luôn là giả thuyết — dữ liệu sai không được biến thành lời khuyên chiến thuật sai.

// Giao diện riêng (css/player-panel.css) nạp kèm module; cssReady xong mới vẽ để không lộ giao diện nửa vời.
export const cssReady = typeof document === 'undefined' ? Promise.resolve() : new Promise((res) => {
  const had = document.querySelector('link[data-pp-css]');
  if (had) { if (had.sheet) res(); else { had.addEventListener('load', res); had.addEventListener('error', res); } return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/player-panel.css', import.meta.url).href;
  l.dataset.ppCss = '';
  l.addEventListener('load', res); l.addEventListener('error', res);
  setTimeout(res, 4000); // mạng chậm/không có: vẫn vẽ, không treo trang
  document.head.append(l);
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (v) => (Array.isArray(v) ? v : []);
const safeHref = (u) => (/^https?:\/\//.test(String(u || '')) ? String(u) : '#');
const YT = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/;
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const numOk = (n) => /^\d{1,3}$/.test(String(n ?? ''));

// ─── Ảnh đại diện ───
export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  const s = w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0];
  return s.toLocaleUpperCase('vi');
}
const PAL = [['#E6E1FA', '#6A55D8'], ['#DDF2E3', '#2E8B57'], ['#FDE4D6', '#D9653B'], ['#DDEBFA', '#2F6FD1'], ['#FBF1D6', '#8A6A12'], ['#F6DDEA', '#B0417A']];
function tone(name) {
  let h = 0;
  for (const ch of norm(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PAL[h % PAL.length];
}
export function normCredits(c) {
  return arr(c).filter((e) => e && (numOk(e.num) || e.file)).map((e) => ({ ...e, num: numOk(e.num) ? String(e.num) : '' }));
}
// Ảnh chỉ khi credits.json ghi đúng người (số áo, và tên nếu có ghi tên). Người chưa có số áo cần 'file' + tên khớp.
export function photoFor(p, credits, teamKey) {
  if (!p || !/^[a-z0-9-]{1,60}$/.test(String(teamKey || ''))) return null;
  const hit = arr(credits).find((e) => {
    const nameOk = e.name ? norm(e.name) === norm(p.name) : false;
    if (numOk(p.num) && e.num === String(p.num)) return !e.name || nameOk;
    return !e.num && e.file && nameOk;
  });
  if (!hit) return null;
  const file = hit.file ? String(hit.file) : `${p.num}.jpg`;
  if (!/^[\w-]{1,60}\.(jpe?g|png|webp)$/i.test(file)) return null;
  return { src: `data/photos/opp/${teamKey}/${file}`, credit: hit };
}
export function avatarHtml(p, { photo = null, size = 'sm' } = {}) {
  const [bg, fg] = tone(p && p.name);
  const num = p && numOk(p.num) ? String(p.num) : '';
  return `<span class="pp-ava pp-ava-${size}" style="--a-bg:${bg};--a-fg:${fg}" aria-hidden="true"><b class="pp-ini">${esc(initials(p && p.name))}</b>`
    + `${photo ? `<img src="${esc(photo.src)}" alt="" loading="lazy" data-pp-fb>` : ''}${num ? `<i class="pp-no">${esc(num)}</i>` : ''}</span>`;
}
export function creditHtml(photo) {
  if (!photo || !photo.credit) return '';
  const c = photo.credit;
  const who = /^https?:\/\//i.test(c.source || '') ? `<a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">${esc(c.author || 'nguồn')}</a>` : esc(c.author || 'không rõ tác giả');
  return `<p class="pp-credit" data-testid="pp-credit">Ảnh: ${who}${c.license ? `, ${esc(c.license)}` : ''}</p>`;
}
// Ảnh lỗi tải (offline, sai tên file) → gỡ ảnh, chữ cái đầu tên nằm sẵn bên dưới hiện ra.
if (typeof document !== 'undefined' && !window.__ppFb) {
  window.__ppFb = true;
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && (t.hasAttribute('data-pp-fb') || t.hasAttribute('data-thumb-fb'))) {
      if (t.hasAttribute('data-thumb-fb') && t.parentElement) t.parentElement.classList.add('is-nothumb');
      t.remove();
    }
  }, true);
}
const cache = new Map();
// data/photos/opp/index.json = danh sách thư mục đội đã có (["xmls-thanh-hoa", …]) — chỉ đọc credits của đội có trong đó,
// để đội chưa có thư mục không sinh lỗi 404. Thêm thư mục ảnh cho đội mới → thêm khoá đội vào index.json.
let teamIndex = null;
export async function loadCredits(teamKey) {
  if (!/^[a-z0-9-]{1,60}$/.test(String(teamKey || ''))) return [];
  if (!teamIndex) teamIndex = fetch('data/photos/opp/index.json').then((r) => (r.ok ? r.json() : [])).then(arr).catch(() => []);
  if (!(await teamIndex).includes(teamKey)) return [];
  if (!cache.has(teamKey)) {
    cache.set(teamKey, fetch(`data/photos/opp/${teamKey}/credits.json`).then((r) => (r.ok ? r.json() : [])).then(normCredits).catch(() => []));
  }
  return cache.get(teamKey);
}

// ─── Khung sidekick (dùng chung cho hồ sơ cầu thủ, clip, nguồn) ───
const SK = { el: null, list: [], i: 0, render: null, opener: null, link: null, onClose: null };
const wide = () => (typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)').matches : true);
function ensure() {
  if (SK.el && SK.el.isConnected) return SK.el;
  const scrim = document.createElement('div');
  scrim.className = 'pp-scrim';
  scrim.hidden = true;
  const el = document.createElement('aside');
  el.className = 'pp-sk';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'pp-title');
  el.setAttribute('data-testid', 'pp-panel');
  el.innerHTML = `<header class="pp-bar"><span class="pp-grab" aria-hidden="true"></span>
      <div class="pp-nav"><button type="button" class="pp-ib" data-pp-step="-1" aria-label="Trước" data-testid="pp-prev">‹</button>
        <span class="pp-pos" data-testid="pp-pos"></span>
        <button type="button" class="pp-ib" data-pp-step="1" aria-label="Sau" data-testid="pp-next">›</button></div>
      <button type="button" class="pp-ib pp-close" data-pp-close aria-label="Đóng" data-testid="pp-close">✕</button></header>
    <div class="pp-body" data-pp-body tabindex="-1"></div>`;
  document.body.append(scrim, el);
  el.__scrim = scrim;
  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-pp-close')) close();
    else if (b.dataset.ppStep) step(Number(b.dataset.ppStep));
  });
  scrim.addEventListener('click', () => close());
  SK.el = el;
  return el;
}
function paint() {
  const el = ensure();
  const it = SK.list[SK.i];
  const body = el.querySelector('[data-pp-body]');
  body.innerHTML = SK.render(it, SK.i, SK.list);
  body.scrollTop = 0;
  const n = SK.list.length;
  el.querySelector('[data-testid="pp-pos"]').textContent = n > 1 ? `${SK.i + 1}/${n}` : '';
  el.querySelector('[data-pp-step="-1"]').disabled = SK.i <= 0;
  el.querySelector('[data-pp-step="1"]').disabled = SK.i >= n - 1;
  el.querySelector('.pp-nav').hidden = n < 2;
  if (SK.link) setParam(SK.link(it));
}
function setParam(v) {
  try {
    const u = new URL(location.href);
    if (v) u.searchParams.set('pl', v); else u.searchParams.delete('pl');
    if (u.href !== location.href) history.replaceState(history.state, '', u.href);
  } catch { /* bỏ qua */ }
}
// open({ list, index, render(item,i,list) → html, opener, kind, link?(item) → giá trị ?pl= để mở lại đúng người })
export function open({ list, index = 0, render, opener = null, kind = 'player', link = null }) {
  if (!Array.isArray(list) || !list.length || typeof render !== 'function') return null;
  const el = ensure();
  if (SK.link && !link) setParam(null);
  Object.assign(SK, { list, i: Math.max(0, Math.min(list.length - 1, index)), render, link });
  if (opener) SK.opener = opener;
  el.dataset.kind = kind;
  el.hidden = false;
  el.__scrim.hidden = wide();
  document.documentElement.classList.add('pp-open');
  paint();
  const body = el.querySelector('[data-pp-body]');
  try { body.focus({ preventScroll: true }); } catch { /* bỏ qua */ }
  return el;
}
export function close() {
  if (!SK.el || SK.el.hidden) return;
  SK.el.hidden = true;
  SK.el.__scrim.hidden = true;
  SK.el.querySelector('[data-pp-body]').innerHTML = ''; // gỡ khung video → dừng phát
  document.documentElement.classList.remove('pp-open');
  if (SK.link) setParam(null);
  SK.link = null;
  const o = SK.opener;
  SK.opener = null;
  if (o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch { /* bỏ qua */ } }
}
export function step(d) {
  if (!SK.el || SK.el.hidden) return;
  const j = SK.i + d;
  if (j < 0 || j >= SK.list.length) return;
  SK.i = j;
  paint();
}
export const isOpen = () => !!(SK.el && !SK.el.hidden);
if (typeof document !== 'undefined' && !window.__ppKeys) {
  window.__ppKeys = true;
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.defaultPrevented) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return; // hộp sa bàn đang mở thì để nó xử lý
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  // Chạm ra ngoài panel (không phải một thẻ mở panel) → đóng.
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (!t || !t.closest || SK.el.contains(t) || t.closest('[data-pp-open]') || t.closest('.pp-scrim')) return;
    if (!t.isConnected) return; // phần tử vừa bị vẽ lại (vd. chip lọc) — không tính là chạm ra ngoài
    close();
  });
  window.addEventListener('hashchange', () => close());
}

// ─── Nhãn nguồn + độ chắc ───
const CONF = { cao: ['Chắc chắn', 'hi'], 'vừa': ['Khá chắc', 'mid'], 'thấp': ['Cần kiểm', 'lo'] };
const SRC = { phude: 'Bình luận viên', gemini: 'AI tóm phụ đề', dem: 'Video tự đo (bảng điểm)', bao: 'Báo', roster: 'Danh sách đội', profile: 'Hồ sơ quốc tế' };
const confTag = (c) => { const x = CONF[c] || CONF['thấp']; return `<span class="pp-conf pp-conf-${x[1]}">${x[0]}</span>`; };
const srcTag = (m) => `<span class="pp-src">${esc(SRC[m] || m || 'Không rõ nguồn')}</span>`;
const evA = (e) => (e && YT.test(String(e.url || ''))
  ? `<a class="pp-ev" href="${esc(e.url)}" target="_blank" rel="noopener" data-evidence>${esc(e.label || 'Xem video')}</a>` : '');
const HYPO = 'Giả thuyết — cần kiểm bằng video/trận thật';

// Ghép một ý (điểm mạnh/yếu) với nguồn gốc của nó trong báo cáo. Trỏ sai → null (bỏ ý, không đoán).
function resolve(item, D) {
  if (!item || !item.text) return null;
  const ref = String(item.ref || '');
  if (ref.startsWith('run:')) {
    const c = D.counts || {};
    const r = arr(c.runs)[Number(ref.slice(4))];
    if (!r) return null;
    return { text: item.text, src: item.src || 'dem', conf: item.conf || c.confidence || 'vừa', ev: r.evidence ? [r.evidence] : [], id: item.id };
  }
  if (ref === 'roster') return { text: item.text, src: item.src || 'roster', conf: item.conf || 'vừa', ev: [], id: item.id };
  const t = arr(D.tendencies).find((x) => x && x.id === ref);
  if (!t) return null;
  const ev = arr(item.ev).map((k) => arr(t.evidence)[k]).filter(Boolean);
  return { text: item.text, src: item.src || t.method, conf: item.conf || t.confidence, ev, id: item.id, tend: t.title };
}
const pointLi = (x) => `<li class="pp-pt"><p>${esc(x.text)}</p><div class="pp-tags">${srcTag(x.src)}${confTag(x.conf)}</div>`
  + `${x.ev.length ? `<div class="pp-evs">${x.ev.map(evA).join('')}</div>` : ''}</li>`;

// ─── Hồ sơ cầu thủ Thanh Hóa (báo cáo scout) ───
const START_RE = /(\d+)\s*\/\s*(\d+)\s*trận xuất phát/;
// Danh sách theo thứ tự trên trang: đội hình quen thuộc → ngoại binh mới → dự bị.
export function thPlayers(D, P) {
  const R = (D && D.roster) || {};
  const prof = new Map(arr(P && P.players).filter((x) => x && x.name).map((x) => [norm(x.name), x]));
  const nf = arr(P && P.newForeign).filter((x) => x && x.name);
  const nfKeys = new Set(nf.map((x) => norm(x.name)));
  const mk = (p, group) => ({ ...p, isKey: p.key === true, group, prof: prof.get(norm(p.name)) || null });
  const start = arr(R.starting).filter((p) => p && p.name).map((p) => mk(p, 'start'));
  const benchAll = arr(R.bench).filter((p) => p && p.name);
  const bench = benchAll.filter((p) => !nfKeys.has(norm(p.name))).map((p) => mk(p, 'bench'));
  const fresh = nf.map((f) => {
    const b = benchAll.find((p) => norm(p.name) === norm(f.name)) || {};
    return { num: b.num ?? '?', name: f.name, role: f.role || b.role, h: f.h ?? b.h ?? null, tags: b.tags || [], note: b.note || '', isKey: false, group: 'new', prof: f };
  });
  const all = [...start, ...fresh, ...bench];
  const seen = new Set();
  for (const p of all) {
    let k = numOk(p.num) ? 'n' + p.num : norm(p.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    while (seen.has(k)) k += '-2';
    seen.add(k);
    p.pid = k;
  }
  return { start, fresh, bench, all };
}
export function playerCard(p, photo) {
  const h = p.h ? `${esc(p.h)} cm` : p.group === 'new' ? 'cao: chưa rõ' : '';
  return `<li class="sr-pl${p.isKey ? ' is-key' : ''}" data-testid="sr-player">
    <button type="button" class="pp-card" data-pp-open data-pl="${esc(p.pid)}" aria-label="Mở hồ sơ ${esc(p.name)}">${avatarHtml(p, { photo })}
    <div><b>${esc(p.name)}</b><small>${esc(p.role)}${h ? ` · ${h}` : ''}</small>${arr(p.tags).length ? `<em>${arr(p.tags).map(esc).join(' · ')}</em>` : ''}${p.note ? `<p>${esc(p.note)}</p>` : ''}</div>
    <span class="pp-more" aria-hidden="true">›</span></button></li>`;
}

export function thProfileHtml(p, D, ctx = {}) {
  const R = (D && D.roster) || {};
  const pr = p.prof || {};
  const photo = ctx.photo || null;
  const isNew = p.group === 'new';
  const starts = arr(p.tags).map((t) => START_RE.exec(t)).find(Boolean);
  const facts = [];
  if (numOk(p.num)) facts.push(`Số ${esc(p.num)}`); else facts.push('Chưa có số áo');
  if (p.role) facts.push(esc(p.role));
  facts.push(p.h ? `${esc(p.h)} cm` : 'Chiều cao: chưa rõ');
  const chips = [];
  if (pr.nationality) chips.push(`<span class="pp-chip${pr.foreign ? ' is-foreign' : ''}">${pr.foreign ? 'Ngoại binh · ' : ''}${esc(pr.nationality)}</span>`);
  if (starts) chips.push(`<span class="pp-chip" data-testid="pp-starts">${esc(starts[1])}/${esc(starts[2])} trận xuất phát</span>`);
  for (const t of arr(p.tags)) if (!START_RE.test(t)) chips.push(`<span class="pp-chip">${esc(t)}</span>`);
  const status = pr.status ? `<p class="pp-status" data-testid="pp-status">${esc(pr.status)}</p>` : '';
  const h = [`<div class="pp-head">${avatarHtml(p, { photo, size: 'lg' })}<div><div class="pp-lab">${esc(D.team || '')}${isNew ? ' · ngoại binh mới' : p.group === 'bench' ? ' · dự bị' : ''}</div>
    <h2 id="pp-title">${esc(p.name)}</h2><p class="pp-facts">${facts.join(' · ')}</p></div></div>
    ${pr.hNote ? `<p class="pp-fine">${esc(pr.hNote)}</p>` : ''}${creditHtml(photo)}
    ${chips.length ? `<div class="pp-chips">${chips.join('')}</div>` : ''}${status}`];

  // Chỉ số — chỉ số thật có trong dữ liệu
  const stats = [];
  if (starts) stats.push({ label: 'Xuất phát', value: `${starts[1]}/${starts[2]} trận`, date: 'tháng 3–4/2026', src: R.startingBasis || 'Đếm từ lời giới thiệu đội hình', conf: R.startingConfidence || 'vừa' });
  for (const s of arr(pr.stats)) if (s && s.label && s.value) stats.push(s);
  h.push(`<section class="pp-sec" data-testid="pp-stats"><h3>Chỉ số</h3>${stats.length
    ? `<ul class="pp-stats">${stats.map((s) => `<li><b>${esc(s.value)}</b><span>${esc(s.label)}${s.date ? ` · ${esc(s.date)}` : ''}</span>
        <div class="pp-tags"><span class="pp-src">${s.url ? `<a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener">${esc(s.src)}</a>` : esc(s.src || 'Không rõ nguồn')}</span>${confTag(s.conf)}</div></li>`).join('')}</ul>`
    : ''}${stats.length > (starts ? 1 : 0) ? '' : `<p class="pp-empty" data-testid="pp-nostats">${starts ? 'Ngoài số trận xuất phát, chưa' : 'Chưa'} có số đo riêng cho cầu thủ này.</p>`}
    <p class="pp-fine">Số tự đo từ video (phát bóng, đỡ theo từng người) chưa đủ tin để gắn cho từng cầu thủ — máy mới nhận đúng số áo khoảng một nửa số lần.</p></section>`);

  if (arr(pr.info).length) {
    h.push(`<section class="pp-sec"><h3>Thông tin</h3><dl class="pp-info">${arr(pr.info).map((x) => `<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl>
      <div class="pp-tags">${srcTag('profile')}${confTag('vừa')}</div></section>`);
  }

  const S = arr(pr.strengths).map((x) => resolve(x, D)).filter(Boolean);
  const W = arr(pr.weaknesses).map((x) => resolve(x, D)).filter(Boolean);
  const building = isNew ? `<p class="pp-empty">Đang dựng hồ sơ — chưa xem video của cô ấy${pr.videos ? ` (đã tìm được ${esc(pr.videos)} video để xem)` : ''}.</p>` : '';
  const none = (w) => building || `<p class="pp-empty">Chưa có ghi nhận ${w} riêng về cầu thủ này trong video và báo đã đọc.</p>`;
  h.push(`<section class="pp-sec" data-testid="pp-strengths"><h3>Ưu điểm</h3>${S.length ? `<ul class="pp-pts">${S.map(pointLi).join('')}</ul>` : none('ưu điểm')}</section>`);
  h.push(`<section class="pp-sec" data-testid="pp-weak"><h3>Điểm yếu</h3>${W.length ? `<ul class="pp-pts">${W.map(pointLi).join('')}</ul>` : none('điểm yếu')}</section>`);

  const plans = Object.fromEntries(arr(D.plans).filter((x) => x && x.plan).map((x) => [x.plan.id, x.plan]));
  const X = arr(pr.exploit).filter((x) => x && x.text && W.some((w) => w.id && w.id === x.from));
  h.push(`<section class="pp-sec pp-exploit" data-testid="pp-exploit"><h3>Chỗ nên khai thác</h3>${X.length
    ? `<ul class="pp-pts">${X.map((x) => { const w = W.find((y) => y.id === x.from); const pl = x.planId && plans[x.planId];
      return `<li class="pp-pt"><p>${esc(x.text)}</p><p class="pp-why">Suy từ điểm yếu: ${esc(w.text)}</p>
        <div class="pp-tags"><span class="pp-hypo" data-testid="pp-hypo">${HYPO}</span></div>
        ${pl ? `<a class="pp-btn pp-btn-ghost" data-plan="${esc(x.planId)}" href="tactics.html?plan=${encodeURIComponent(x.planId)}">Phương án: ${esc(pl.name)}</a>` : ''}</li>`; }).join('')}</ul>`
    : `<p class="pp-empty" data-testid="pp-noadvice">Chưa đủ dữ liệu để khuyên.</p>`}</section>`);

  const flags = [];
  if (!isNew && P_OLD(ctx)) flags.push(P_OLD(ctx));
  if (isNew) flags.push('Hợp đồng chưa công bố chính thức — chưa chắc có tên trong danh sách giai đoạn 2.');
  for (const f of arr(pr.flags)) flags.push(f);
  if (flags.length) h.push(`<section class="pp-sec" data-testid="pp-flags"><h3>Lưu ý</h3><ul class="pp-flags">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>`);

  const src = [];
  const add = (label, url) => { if (/^https?:\/\//.test(String(url || '')) && !src.some((x) => x.url === url)) src.push({ label, url }); };
  for (const x of arr(pr.sources)) add(x.label, x.url);
  for (const x of [...S, ...W]) for (const e of x.ev) add(e.label, e.url);
  if (!isNew) { const w = arr(D.sources).find((x) => x && /wikipedia/.test(String(x.url))); if (w) add(`${w.label} (số áo, chiều cao)`, w.url); }
  h.push(`<section class="pp-sec" data-testid="pp-sources"><h3>Nguồn</h3>${src.length
    ? `<ul class="pp-links">${src.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"${YT.test(x.url) ? ' data-evidence' : ''}>${esc(x.label)}</a></li>`).join('')}</ul>`
    : '<p class="pp-empty">Chưa có nguồn riêng.</p>'}</section>`);
  return h.join('');
}
const P_OLD = (ctx) => (ctx && ctx.oldLineup) || 'Đội hình cũ — có thể đã thay đổi.';

// ─── Các đội khác (data/opponents.json) ───
const OCONF = { HIGH: 'cao', MEDIUM: 'vừa', LOW: 'thấp' };
function aliases(name, foreign = false) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  const out = [w.join(' ')];
  if (w.length >= 3) out.push(w.slice(-2).join(' '), `${w[0]} ${w[w.length - 1]}`);
  if (w.length === 2) out.push(w[1]);
  if (foreign) for (const x of w) if (x.length >= 4) out.push(x); // ngoại binh hay được gọi bằng một chữ (García)
  return [...new Set(out.map(low))].filter((a) => a.length >= 3);
}
// So tên giữ nguyên dấu (Thu Thùy ≠ Thu Thủy); chỉ bỏ hoa/thường và dấu câu.
const low = (s) => String(s ?? '').normalize('NFC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function mentions(name, text, foreign = false) {
  const t = ' ' + low(text) + ' ';
  return aliases(name, foreign).some((a) => t.includes(' ' + a + ' '));
}
export function shortName(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 3 && /^(thị|văn)$/i.test(w[w.length - 2])) return w[w.length - 1];
  return w.slice(-2).join(' ');
}
function oppProfileHtml(p, t, d, photo) {
  const vids = (d && d.videos) || {};
  const conf = OCONF[String(t.confidence || '').toUpperCase()] || 'thấp';
  const ment = arr(t.tendencies).filter((x) => x && mentions(p.name, x.text, /ngoại binh/i.test(String(p.note || ''))));
  const facts = [numOk(p.num) ? `Số ${esc(p.num)}` : 'Chưa có số áo', p.pos ? esc(p.pos) : 'Vị trí: chưa rõ'];
  const hm = /cao\s+(\d)[,.](\d{2})\s*m/.exec(String(p.note || ''));
  facts.push(hm ? `${hm[1]}${hm[2]} cm` : 'Chiều cao: chưa rõ');
  const foreign = /ngoại binh/i.test(String(p.note || ''));
  const h = [`<div class="pp-head">${avatarHtml(p, { photo, size: 'lg' })}<div><div class="pp-lab">${esc(t.name)}</div>
    <h2 id="pp-title">${esc(p.name)}</h2><p class="pp-facts">${facts.join(' · ')}</p></div></div>${creditHtml(photo)}
    ${foreign || p.note ? `<div class="pp-chips">${foreign ? '<span class="pp-chip is-foreign">Ngoại binh</span>' : ''}${p.note ? `<span class="pp-chip">${esc(p.note)}</span>` : ''}</div>` : ''}`];
  h.push('<section class="pp-sec" data-testid="pp-stats"><h3>Chỉ số</h3><p class="pp-empty" data-testid="pp-nostats">Chưa có số đo riêng cho cầu thủ này.</p></section>');
  h.push(`<section class="pp-sec" data-testid="pp-mentions"><h3>Ưu điểm / Điểm yếu</h3>${ment.length
    ? `<p class="pp-fine">Chưa phân loại mạnh/yếu — dưới đây là nhận xét của bình luận viên có nhắc tên cô ấy.</p><ul class="pp-pts">${ment.map((x) => {
      const url = /^[\w-]{11}$/.test(String(x.v)) ? `https://www.youtube.com/watch?v=${x.v}&t=${Math.max(0, parseInt(x.t, 10) || 0)}s` : '';
      const v = vids[x.v] || {};
      return `<li class="pp-pt"><p>${esc(x.text)}</p><div class="pp-tags"><span class="pp-src">${esc(x.skill || '')}</span>${srcTag('phude')}${confTag(conf)}</div>
        ${url ? `<div class="pp-evs"><a class="pp-ev" href="${esc(url)}" target="_blank" rel="noopener" data-evidence>${esc(v.title || 'Xem video')}</a></div>` : ''}</li>`; }).join('')}</ul>`
    : '<p class="pp-empty">Chưa có ghi nhận ưu điểm hay điểm yếu riêng về cầu thủ này.</p>'}</section>`);
  h.push('<section class="pp-sec pp-exploit" data-testid="pp-exploit"><h3>Chỗ nên khai thác</h3><p class="pp-empty" data-testid="pp-noadvice">Chưa đủ dữ liệu để khuyên.</p></section>');
  h.push(`<section class="pp-sec" data-testid="pp-flags"><h3>Lưu ý</h3><ul class="pp-flags"><li>${esc(d.label || 'Nguồn cần kiểm')} — cập nhật ${esc(d.generated || '')}.</li></ul></section>`);
  const srcs = arr(t.sources).filter((u) => /^https?:\/\//i.test(u));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  h.push(`<section class="pp-sec" data-testid="pp-sources"><h3>Nguồn</h3>${srcs.length ? `<ul class="pp-links">${srcs.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a></li>`).join('')}</ul>` : '<p class="pp-empty">Chưa có nguồn riêng.</p>'}</section>`);
  return h.join('');
}

// Màn #/opp: đổi danh sách tên cầu thủ của từng đội thành thẻ có ảnh đại diện, bấm mở hồ sơ.
export async function mountOppPlayers(root, d) {
  if (!root || !d || !Array.isArray(d.teams)) return;
  await cssReady;
  const boxes = [...root.querySelectorAll('details.oppteam')];
  const creds = await Promise.all(d.teams.map((t) => loadCredits(t.id)));
  boxes.forEach((box, ti) => {
    const t = d.teams[ti];
    const ul = box.querySelector('ul.opl');
    if (!t || !ul || ul.dataset.pp) return;
    ul.dataset.pp = '1';
    ul.classList.add('pp-opl');
    ul.innerHTML = arr(t.players).map((p, i) => `<li><button type="button" class="pp-card" data-pp-open data-opp-pl="${ti}:${i}" data-testid="opp-player" aria-label="Mở hồ sơ ${esc(p.name)}">
      ${avatarHtml(p, { photo: photoFor(p, creds[ti], t.id) })}<div><b>${esc(p.name)}</b><small>${esc(p.pos || 'Chưa rõ vị trí')}${p.note ? ` · ${esc(p.note)}` : ''}</small></div><span class="pp-more" aria-hidden="true">›</span></button></li>`).join('');
  });
  if (root.__ppOpp) { root.__ppOpp.d = d; root.__ppOpp.creds = creds; return; }
  const st = (root.__ppOpp = { d, creds });
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-opp-pl]');
    if (!b) return;
    const [ti, pi] = b.dataset.oppPl.split(':').map(Number);
    const t = st.d.teams[ti];
    if (!t || !t.players[pi]) return;
    open({ list: t.players, index: pi, opener: b, kind: 'player',
      render: (p) => oppProfileHtml(p, t, st.d, photoFor(p, st.creds[ti], t.id)) });
  });
}
