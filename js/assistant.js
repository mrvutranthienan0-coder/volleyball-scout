// Trợ lý hội ý: bảng bên phải (≥1024px, trang bên trái vẫn dùng được) hoặc bảng trượt gần kín màn (điện thoại).
// Mỗi câu hỏi → một thẻ trả lời tự tính trên máy (chạy offline, không cần AI). Có máy chủ AI thì thêm nhận xét
// của AI dưới thẻ; AI lỗi / mất mạng / chậm → giữ câu trả lời trên máy, ghi chú nhỏ. App không giữ khoá AI.
// Thẻ chỉ sống trong phiên (bộ nhớ), không đổi lược đồ trận đã lưu.
import * as A from './analysis.js';
import { artChart, metaLine } from './charts.js';
import { replay } from './logic.js';
import * as AIL from './ai-live.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const X_ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

export const OPTIONS = [
  { k: 'rot', q: 'Xoay vòng nào đang mất điểm?', sub: 'Side-out / break-point theo P1–P6', icon: 'chart-bar' },
  { k: 'recv', q: 'Đỡ bước 1 theo từng người', sub: 'Điểm đỡ 0–3 và side-out sau bóng tốt / xấu', icon: 'hand-stop' },
  { k: 'scor', q: 'Ai đang gánh điểm, ai mắc lỗi / bị chắn', sub: 'Điểm ghi và lỗi từng VĐV', icon: 'users' },
  { k: 'opp', q: 'Đối thủ ghi điểm bằng cách nào', sub: 'Điểm ta mất chia theo cách', icon: 'shield-half' },
  { k: 'runs', q: 'Chuỗi mất điểm gần đây', sub: 'Các đoạn mất ≥3 điểm liên tiếp', icon: 'trending-down' },
  { k: 'cmp', q: 'So sánh 2 phương án', sub: '2 xoay vòng hoặc 2 VĐV cùng vị trí', icon: 'target' },
];
const BUILD = { rot: A.artRot, recv: A.artRecv, scor: A.artScor, opp: A.artOpp, runs: A.artRuns };
const TAB = { rot: 'Xoay vòng', recv: 'Đỡ bước 1', scor: 'Ghi điểm / lỗi', opp: 'Đối thủ', runs: 'Chuỗi', cmp: 'So sánh', player: 'VĐV', overview: 'Tổng quan', notOurs: 'Không có số liệu' };

const S = { lastOpt: 0, lastK: '', el: null, open: false, getMatch: null, id: null, setDefault: null, scope: 'set', arts: new Map(), seq: 0, build: null, onToast: null, lastFocus: null };
const arts = () => { if (!S.arts.has(S.id)) S.arts.set(S.id, []); return S.arts.get(S.id); };
const curSet = () => { const m = S.getMatch(); if (!m) return null; const R = replay(m); return S.setDefault || (R.cur ? R.cur.n : R.sets.length || null); };
const setN = () => (S.scope === 'set' ? curSet() : null);

export const isOpen = () => S.open;

// opts: { getMatch(): match, id, setN (null = cả trận), toast(msg) }
export function openAssistant(opts) {
  if (!S.el) mountRoot();
  S.getMatch = opts.getMatch; S.id = opts.id; S.onToast = opts.toast;
  const m = S.getMatch();
  if (!m) return;
  const R = replay(m);
  S.setDefault = opts.setN || (R.cur ? R.cur.n : R.sets.length || null);
  S.scope = opts.setN ? 'set' : 'match';
  S.build = null;
  S.lastFocus = document.activeElement;
  S.open = true;
  document.body.classList.add('as-on');
  S.el.hidden = false;
  render();
  const x = S.el.querySelector('[data-testid=as-close]');
  if (x) x.focus({ preventScroll: true });
}
export function closeAssistant() {
  if (!S.open) return;
  S.open = false;
  S.build = null;
  document.body.classList.remove('as-on');
  if (S.el) { S.el.hidden = true; S.el.innerHTML = ''; }
  if (S.lastFocus && S.lastFocus.isConnected) try { S.lastFocus.focus({ preventScroll: true }); } catch { /* bỏ qua */ }
}

function mountRoot() {
  S.el = document.createElement('div');
  S.el.id = 'assist';
  S.el.hidden = true;
  document.body.appendChild(S.el);
  S.el.addEventListener('click', onClick);
  S.el.addEventListener('change', onChange);
  S.el.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open && !document.querySelector('#sheet:not([hidden])')) closeAssistant(); });
}

// ---------- vẽ ----------
function render() {
  const m = S.getMatch();
  if (!m) { closeAssistant(); return; }
  const sn = curSet();
  const list = arts();
  const conf = AIL.isConfigured();
  const scopeBtn = (v, l) => `<button type="button" class="fchip ${S.scope === v ? 'on' : ''}" data-as="scope" data-v="${v}" aria-pressed="${S.scope === v}" data-testid="as-scope-${v}">${l}</button>`;
  S.el.innerHTML = `
  <div class="as-scrim" data-as="close" aria-hidden="true"></div>
  <aside class="as" role="dialog" aria-modal="false" aria-labelledby="as-title" data-testid="assist">
    <header class="as-h">
      <div class="as-hrow"><div class="as-ttl"><h2 id="as-title">Trợ lý hội ý</h2><p class="sub">${esc(m.teamName)} – ${esc(m.opponent)} · số tự tính trên máy</p></div>
        <button type="button" class="as-x" data-as="close" aria-label="Đóng trợ lý" data-testid="as-close">${X_ICON}</button></div>
      <div class="chips-f" role="group" aria-label="Phạm vi số liệu">${sn ? scopeBtn('set', `Set ${sn}`) : ''}${scopeBtn('match', 'Cả trận')}</div>
    </header>
    ${list.length ? `<nav class="as-tabs" aria-label="Các thẻ đã tạo" data-testid="as-tabs">${list.map((a, i) => `<button type="button" class="fchip" data-as="jump" data-id="${a.id}">${i + 1} · ${esc(TAB[a.kind] || a.kind)}</button>`).join('')}</nav>` : ''}
    <div class="as-body" id="as-body">
      <section class="as-opts ${list.length ? 'as-mini' : ''}" data-testid="as-options">
        <p class="lab">${list.length ? 'Hỏi tiếp' : 'Chọn một câu hỏi — số tự tính ngay trên máy, không cần mạng'}</p>
        <div class="as-og">${OPTIONS.map((o) => `<button type="button" class="as-opt" data-as="opt" data-k="${o.k}" data-testid="as-opt-${o.k}"><span class="as-oi">${ic(o.icon)}</span><span><b>${esc(o.q)}</b>${list.length ? '' : `<small>${esc(o.sub)}</small>`}</span></button>`).join('')}</div>
      </section>
      <div class="as-thread" data-testid="as-thread">${list.map(itemHtml).join('')}${S.build ? buildHtml() : ''}</div>
    </div>
    <form class="as-ask" data-testid="as-ask" autocomplete="off"><label class="vh" for="as-q">Hỏi thêm</label><input id="as-q" name="q" placeholder="Hỏi thêm… vd: số 12 đang thế nào?" maxlength="500"><button type="submit" class="pill-btn dark" data-testid="as-send">Hỏi</button></form>
    <p class="as-foot" data-testid="as-foot">${footText(conf)}</p>
  </aside>`;
}

// Chân bảng: trạng thái THẬT của lần gọi máy chủ AI gần nhất — chưa gọi thì không nói "đã nối".
function footText(conf) {
  if (!conf) return 'Số liệu tự tính trên máy. Nối máy chủ AI trong Cài đặt để có thêm nhận xét.';
  if (arts().some((a) => a.ai && a.ai.state === 'wait')) return 'Đang hỏi máy chủ AI… Số trên thẻ đã tính xong trên máy.';
  const L = AIL.lastCall();
  const hm = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (!L) return 'Đã cài máy chủ AI, chưa gọi lần nào — số trên thẻ tự tính trên máy; hỏi một câu để thử kết nối.';
  if (!L.ok) return `Máy chủ AI không phản hồi lần gọi lúc ${hm(L.at)} (${esc(L.msg)}) — đang dùng số liệu trên máy.`;
  return `Đã nối máy chủ AI (trả lời lúc ${hm(L.at)}): có thêm nhận xét của AI dưới mỗi thẻ.`;
}
function itemHtml(a) {
  const ai = a.ai;
  const aiHtml = !ai ? '' : ai.state === 'wait' ? '<p class="as-ai-wait" data-testid="as-ai-wait"><i class="dots" aria-hidden="true"></i>AI đang suy nghĩ…</p>'
    : ai.state === 'ok' ? `<div class="as-ai" data-testid="as-ai"><p class="lab">AI nhận xét — tham khảo, đối chiếu số bên trên</p><p>${esc(ai.answer)}</p>${ai.plan && ai.plan.items ? `<ol>${ai.plan.items.map((i) => `<li><b>${esc(i.label)}</b> — ${esc(i.detail)} <small>(${esc(i.evidence)})</small></li>`).join('')}</ol>` : ''}${ai.unverified && ai.unverified.length ? `<p class="warn">Số chưa đối chiếu được với số liệu trận: ${esc(ai.unverified.join(', '))} — HLV kiểm lại.</p>` : ''}</div>`
      : `<p class="as-ai-note" data-testid="as-ai-note">Trả lời bằng số liệu trên máy${ai.msg ? ` · ${esc(ai.msg)}` : ''}</p>`;
  const t = a.table;
  const tbl = t && t.rows.length ? `<div class="as-tw"><table class="tbl as-tbl"><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<article class="as-item" id="as-a-${a.id}" data-testid="as-art" data-kind="${a.kind}">
    <p class="as-q"><span>${esc(a.q)}</span></p>
    <section class="as-card">
      <div class="as-ch"><h3>${esc(a.title)}</h3><span class="as-sc">${esc(a.scope)}</span></div>
      <p class="as-ans" data-testid="as-answer">${esc(a.answer)}</p>
      <div class="as-chart">${artChart(a.chart)}</div>
      ${tbl}
      ${a.link ? `<p><a class="pill-btn" href="${esc(a.link.href)}" data-testid="as-link">${esc(a.link.text)}</a></p>` : ''}
      ${metaLine(a.nText, a.cert, a.note || '')}
      <div class="as-acts"><button type="button" class="pill-btn" data-as="copy" data-id="${a.id}" data-testid="as-copy">Sao chép</button><button type="button" class="pill-btn" data-as="del" data-id="${a.id}" data-testid="as-del">Xoá</button></div>
    </section>
    ${aiHtml}
  </article>`;
}

function buildHtml() {
  const b = S.build;
  const m = S.getMatch();
  const o = A.cmpOptions(m, replay(m), setN());
  const sel = (f, opts, v) => `<select data-as-f="${f}" data-testid="as-cmp-${f}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  let fields;
  if (b.type === 'rot') {
    const ro = o.rots.map((x) => [x.k, `${x.k} · ${x.n} pha`]);
    fields = `<label class="field">Phương án A${sel('a', ro, b.a)}</label><label class="field">Phương án B${sel('b', ro, b.b)}</label>`;
  } else if (!o.pos.length) {
    fields = '<p class="hint">Chưa có vị trí nào có từ 2 VĐV trong danh sách trận.</p>';
  } else {
    const pos = o.pos.find((x) => x.pos === b.pos) || o.pos[0];
    const po = pos.players.map((x) => [x.pid, `${x.label} · ${x.n} pha`]);
    fields = `<label class="field">Vị trí${sel('pos', o.pos.map((x) => [x.pos, x.label]), pos.pos)}</label><label class="field">VĐV A${sel('a', po, b.a)}</label><label class="field">VĐV B${sel('b', po, b.b)}</label>`;
  }
  return `<article class="as-item as-build" data-testid="as-compare">
    <p class="as-q"><span>So sánh 2 phương án</span></p>
    <section class="as-card"><div class="as-ch"><h3>Chọn 2 phương án để so</h3><span class="as-sc">${esc(A.scopeLabel(setN()))}</span></div>
      <p class="hint">So sánh những gì đã xảy ra trong trận — không phải dự đoán.</p>
      <div class="chips-f" role="group" aria-label="Loại so sánh"><button type="button" class="fchip ${b.type === 'rot' ? 'on' : ''}" data-as="ctype" data-v="rot" aria-pressed="${b.type === 'rot'}" data-testid="as-cmp-type-rot">Hai xoay vòng</button><button type="button" class="fchip ${b.type === 'player' ? 'on' : ''}" data-as="ctype" data-v="player" aria-pressed="${b.type === 'player'}" data-testid="as-cmp-type-player">Hai VĐV cùng vị trí</button></div>
      <div class="as-cf">${fields}</div>
      <p class="err" data-testid="as-cmp-err">${esc(b.err || '')}</p>
      <div class="as-acts"><button type="button" class="pill-btn dark" data-as="cmpgo" data-testid="as-cmp-go">So sánh</button><button type="button" class="pill-btn" data-as="cmpcancel">Huỷ</button></div>
    </section></article>`;
}

// ---------- hành động ----------
function scrollTo(id) {
  requestAnimationFrame(() => {
    const el = S.el && S.el.querySelector(id);
    const body = S.el && S.el.querySelector('#as-body');
    if (el && body) body.scrollTop = el.offsetTop - body.offsetTop - 8;
  });
}
function add(art, q) {
  const a = { ...art, id: ++S.seq, q };
  arts().push(a);
  S.build = null;
  render();
  scrollTo('#as-a-' + a.id);
  if (AIL.isConfigured() && a.kind !== 'notOurs') askAI(a);
  return a;
}
async function askAI(a) {
  const m = S.getMatch();
  a.ai = { state: 'wait' };
  rerenderKeepScroll();
  let r;
  try { r = await AIL.askAIForMatch(a.aiQ || a.q, m, a.setN); } catch { r = { ok: false, error: { message: '' } }; }
  if (!arts().includes(a)) return; // thẻ đã bị xoá / đổi trận trong lúc chờ
  a.ai = r && r.ok && r.answer
    ? { state: 'ok', answer: r.answer, plan: r.plan, unverified: r.unverified_numbers }
    : { state: 'fail', msg: String((r && r.error && r.error.message) || '').replace(/\s*—\s*ghi tay\s*$/, '') };
  if (S.open) { rerenderKeepScroll(); revealAI(a); }
}
// Câu trả lời AI của thẻ mới nhất: cuộn vừa đủ để thấy, không kéo người dùng khỏi chỗ đang đọc thẻ cũ.
function revealAI(a) {
  const l = arts();
  if (l[l.length - 1] !== a) return;
  const body = S.el.querySelector('#as-body');
  const it = S.el.querySelector('#as-a-' + a.id);
  if (!body || !it) return;
  const bottom = it.offsetTop - body.offsetTop + it.offsetHeight + 12;
  if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = Math.min(bottom - body.clientHeight, it.offsetTop - body.offsetTop - 8);
}
function rerenderKeepScroll() {
  if (!S.open) return;
  const body = S.el.querySelector('#as-body');
  const top = body ? body.scrollTop : 0;
  const act = document.activeElement && S.el.contains(document.activeElement) ? document.activeElement : null;
  const val = S.el.querySelector('#as-q') ? S.el.querySelector('#as-q').value : '';
  render();
  const b2 = S.el.querySelector('#as-body');
  if (b2) b2.scrollTop = top;
  const inp = S.el.querySelector('#as-q');
  if (inp) { inp.value = val; if (act && act.id === 'as-q') inp.focus({ preventScroll: true }); }
}
function runOption(k, q) {
  // Bấm đúp / bấm liền 2 lần cùng một lựa chọn → chỉ tạo 1 thẻ.
  // Chỉ chặn lần bấm lặp NGAY sau đó (không có thao tác nào khác xen giữa); "So sánh" mở lại khung chọn thì không tạo thẻ nên không cần chặn.
  const m = S.getMatch();
  if (!m) return;
  if (k === 'cmp') { S.lastK = ''; startBuild(); return; }
  if (S.lastK === k && Date.now() - S.lastOpt < 800) return;
  S.lastK = k; S.lastOpt = Date.now();
  const R = replay(m), sn = setN();
  const art = BUILD[k](m, R, sn);
  add({ ...art, setN: sn }, q || OPTIONS.find((o) => o.k === k).q);
}
function startBuild(err = '') {
  const m = S.getMatch();
  const o = A.cmpOptions(m, replay(m), setN());
  const top = o.rots.slice().sort((x, y) => y.n - x.n);
  S.build = { type: 'rot', a: top[0].k, b: top[1].k, err };
  render();
  scrollTo('[data-testid=as-compare]');
}
function copyText(text) {
  const done = () => S.onToast && S.onToast('Đã sao chép nội dung thẻ.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  }
  fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand && document.execCommand('copy');
  ta.remove();
  if (ok) done(); else S.onToast && S.onToast('Không sao chép được — giữ ngón tay trên chữ để chọn.');
}

function onClick(e) {
  const b = e.target.closest('[data-as]');
  if (!b || b.disabled) return;
  const act = b.dataset.as;
  if (act !== 'opt') S.lastK = ''; // thao tác khác xen giữa → lần bấm lựa chọn sau là câu hỏi mới thật
  if (act === 'close') closeAssistant();
  else if (act === 'scope') { S.scope = b.dataset.v; render(); }
  else if (act === 'opt') runOption(b.dataset.k);
  else if (act === 'jump') scrollTo('#as-a-' + b.dataset.id);
  else if (act === 'copy') { const a = arts().find((x) => x.id === +b.dataset.id); if (a) copyText(A.artText(a) + (a.ai && a.ai.state === 'ok' ? `\nAI nhận xét (tham khảo): ${a.ai.answer}` : '')); }
  else if (act === 'del') { const l = arts(); const i = l.findIndex((x) => x.id === +b.dataset.id); if (i >= 0) l.splice(i, 1); rerenderKeepScroll(); }
  else if (act === 'ctype') {
    const m = S.getMatch();
    const o = A.cmpOptions(m, replay(m), setN());
    if (b.dataset.v === 'rot') { const top = o.rots.slice().sort((x, y) => y.n - x.n); S.build = { type: 'rot', a: top[0].k, b: top[1].k }; }
    else { const p = o.pos[0]; S.build = { type: 'player', pos: p ? p.pos : '', a: p ? p.players[0].pid : '', b: p ? p.players[1].pid : '' }; }
    rerenderKeepScroll();
  } else if (act === 'cmpcancel') { S.build = null; rerenderKeepScroll(); }
  else if (act === 'cmpgo') {
    const bd = S.build;
    if (!bd || !bd.a || !bd.b) return;
    if (bd.a === bd.b) { bd.err = 'Chọn 2 phương án khác nhau.'; rerenderKeepScroll(); return; }
    const m = S.getMatch();
    const sn = setN();
    const art = A.artCmp(m, replay(m), sn, bd);
    add({ ...art, setN: sn, aiQ: `${art.title}: phương án nào đang hiệu quả hơn trong trận này? Chỉ dựa vào số, nói rõ nếu mẫu nhỏ.` }, art.title);
  }
}
function onChange(e) {
  const f = e.target.dataset.asF;
  if (!f || !S.build) return;
  if (f === 'pos') {
    const m = S.getMatch();
    const p = A.cmpOptions(m, replay(m), setN()).pos.find((x) => x.pos === e.target.value);
    S.build = { type: 'player', pos: e.target.value, a: p.players[0].pid, b: p.players[1].pid };
  } else { S.build[f] = e.target.value; S.build.err = ''; }
  rerenderKeepScroll();
}
function onSubmit(e) {
  e.preventDefault();
  const inp = e.target.elements.q;
  const q = inp.value.trim().slice(0, 500);
  if (!q) { inp.focus(); return; }
  inp.value = '';
  const m = S.getMatch();
  if (!m) return;
  const R = replay(m), sn = setN();
  const it = A.matchIntent(q, m);
  let art;
  if (it.k === 'cmpBuild') { startBuild(); return; }
  if (it.k === 'cmp') art = A.artCmp(m, R, sn, it.o);
  else if (it.k === 'player') art = A.artPlayer(m, R, sn, it.pid);
  else if (it.k === 'overview') art = A.artOverview(m, R, sn, true);
  else if (it.k === 'notOurs') art = A.artNotOurs(m, R, sn, it.num);
  else art = BUILD[it.k](m, R, sn);
  add({ ...art, setN: sn }, q);
}
