// Báo cáo scout đối thủ (module độc lập, chưa nối vào app.js).
//
// const r = await mountScoutReport(el, { url: 'data/scout/xmls-thanh-hoa.json', now?: Date })
// → { data, render(), destroy() }
// Dữ liệu: xem data/scout/xmls-thanh-hoa.json (các khoá: match, summary, form, counts, roster, tendencies, plans, clips, sources).
// Mọi bằng chứng video là link YouTube có &t=<giây>s. "Mở trên bàn chiến thuật" lưu phương án vào bộ nhớ
// của bàn chiến thuật (js/tactics.js savePlan) rồi mở tactics.html?plan=<id>.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YT = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/;
export const isEvidenceUrl = (u) => YT.test(String(u || ''));
const safeHref = (u) => (/^https?:\/\//.test(String(u || '')) ? String(u) : '#');

const CONF = {
  cao: { label: 'Chắc chắn', cls: 'hi' },
  'vừa': { label: 'Khá chắc', cls: 'mid' },
  'thấp': { label: 'Cần kiểm', cls: 'lo' },
};
const METHOD = {
  dem: 'Đếm từ bảng điểm',
  phude: 'Bình luận viên nói',
  gemini: 'AI tóm, đã đối chiếu phụ đề',
  bao: 'Báo chí',
};
const AREA = {
  serve: 'Phát bóng', reception: 'Đỡ bước một', set: 'Chuyền hai', attack: 'Tấn công',
  block: 'Chắn & phòng thủ', rotation: 'Giai đoạn hay mất điểm', people: 'Nhân sự',
};
const TONE = { lav: 'lav', mint: 'mint', peach: 'peach', sky: 'sky' };
const PHASE = { recv: 'Đỡ phát bóng', serve: 'Phát bóng', attack: 'Tấn công', defense: 'Phòng thủ / chắn' };

function badge(conf) {
  const c = CONF[conf] || CONF['thấp'];
  return `<span class="sr-conf sr-conf-${c.cls}" data-testid="sr-conf">${c.label}</span>`;
}
function methodTag(m) {
  return m && METHOD[m] ? `<span class="sr-method">${METHOD[m]}</span>` : '';
}
function evLink(ev, text = 'Xem bằng chứng', cls = 'sr-btn') {
  if (!ev || !isEvidenceUrl(ev.url)) return '';
  return `<a class="${cls}" data-evidence href="${esc(ev.url)}" target="_blank" rel="noopener" title="${esc(ev.label || '')}">${esc(text)}</a>`;
}
function ring(n, d, color) {
  const C = 251.3; const f = d > 0 ? Math.max(0, Math.min(1, n / d)) : 0;
  n = Number(n) || 0; d = Number(d) || 0;
  return `<div class="sr-ring" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="10"/>`
    + `<circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C}" transform="rotate(-90 50 50)"/></svg><b>${n}/${d}</b></div>`;
}
const RING_COLOR = { lav: '#6A55D8', mint: '#2E8B57', peach: '#D9653B', sky: '#2F6FD1' };

export function countdown(startIso, now = new Date()) {
  const t = Date.parse(startIso);
  if (Number.isNaN(t) || !(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  const day = (d) => Math.floor((d.getTime() + 7 * 3600e3) / 86400e3); // theo ngày giờ Việt Nam
  const diff = day(new Date(t)) - day(now);
  if (diff > 1) return `Còn ${diff} ngày`;
  if (diff === 1) return 'Ngày mai';
  if (diff === 0) return t > now.getTime() ? 'Hôm nay' : 'Đang / đã đấu hôm nay';
  return 'Đã đấu';
}
function vnDate(iso) {
  if (Number.isNaN(Date.parse(iso))) return '';
  const d = new Date(Date.parse(iso) + 7 * 3600e3);
  const wd = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][d.getUTCDay()];
  const p = (n) => String(n).padStart(2, '0');
  return `${wd}, ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Sân thu nhỏ cho phương án (toạ độ mét như js/tactics.js: x 0–9, y 0 = cuối sân đối thủ, 9 = lưới, 18 = cuối sân ta).
function miniCourt(plan, nums) {
  const S = 13, X = (x) => (x + 1.5) * S, Y = (y) => (y + 2.5) * S, W = 12 * S, H = 23.5 * S;
  const out = [`<svg class="sr-court" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ ${esc(plan.name)}">`,
    `<rect x="${X(0)}" y="${Y(0)}" width="${9 * S}" height="${18 * S}" rx="4" class="c-floor"/>`,
    `<line x1="${X(-0.6)}" y1="${Y(9)}" x2="${X(9.6)}" y2="${Y(9)}" class="c-net"/>`,
    `<line x1="${X(0)}" y1="${Y(6)}" x2="${X(9)}" y2="${Y(6)}" class="c-line"/><line x1="${X(0)}" y1="${Y(12)}" x2="${X(9)}" y2="${Y(12)}" class="c-line"/>`];
  for (const d of plan.drawings || []) {
    if (d.type === 'zone') out.push(`<rect x="${X(d.x)}" y="${Y(d.y)}" width="${d.w * S}" height="${d.h * S}" rx="6" class="c-zone"/>`);
  }
  for (const d of plan.drawings || []) {
    if ((d.type === 'ball' || d.type === 'arrow') && d.from && d.to) {
      out.push(`<line x1="${X(d.from.x)}" y1="${Y(d.from.y)}" x2="${X(d.to.x)}" y2="${Y(d.to.y)}" class="${d.type === 'ball' ? 'c-ball' : 'c-run'}" marker-end="url(#sr-ah)"/>`);
    }
  }
  for (const o of plan.opponents || []) out.push(`<circle cx="${X(o.x)}" cy="${Y(o.y)}" r="${0.42 * S}" class="c-opp"/>`);
  for (const [pid, p] of Object.entries(plan.positions || {})) {
    out.push(`<g class="c-me${pid === plan.libero ? ' c-lib' : ''}"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${0.5 * S}"/><text x="${X(p.x)}" y="${Y(p.y) + 4}">${esc(nums[pid] ?? '?')}</text></g>`);
  }
  out.push('<defs><marker id="sr-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs></svg>');
  return out.join('');
}

const arr = (v) => (Array.isArray(v) ? v : []);
export function renderScoutReport(D, now = new Date()) {
  D = { ...D };
  const m = D.match || {}, s = D.summary || {};
  D.plans = arr(D.plans).filter((p) => p && p.plan && typeof p.plan === 'object');
  D.tendencies = arr(D.tendencies).filter(Boolean);
  D.clips = arr(D.clips).filter((g) => g && Array.isArray(g.items));
  D.form = D.form || {}; D.roster = D.roster || {};
  const plans = Object.fromEntries((D.plans || []).map((p) => [p.plan.id, p]));
  const planLink = (id, text = 'Mở trên bàn chiến thuật') => (plans[id] && /^[A-Za-z0-9_-]{1,40}$/.test(id)
    ? `<a class="sr-btn sr-btn-ghost" data-plan="${esc(id)}" href="tactics.html?plan=${encodeURIComponent(id)}">${esc(text)}</a>` : '');
  const h = [];

  h.push(`<header class="sr-top"><div class="sr-brand"><span class="sr-dot" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3 4 6 4 9s-1 6-4 9M3.6 8.5c4 .5 8 3 10 7M20.4 8.5c-4 0-8.5 2-10.5 6"/></svg></span>Sổ tay HLV</div>
    <div class="sr-pill">Báo cáo đối thủ · ${esc(D.label || 'Đề xuất của AI — HLV quyết')}</div></header>`);
  h.push('<main class="sr-grid">');

  // 1. Trận tới
  h.push(`<section class="sr-t sr-match" data-testid="sr-match">
    <div class="sr-lab">Trận tới · ${esc(m.competition)}</div>
    <div class="sr-vs"><b>${esc(m.home)}</b><i>gặp</i><b>${esc(m.opponent)}</b></div>
    <div class="sr-count" data-testid="sr-countdown">${esc(countdown(m.start, now))}</div>
    <div class="sr-when">${esc(vnDate(m.start))}<br>${esc(m.venue)}</div>
    <div class="sr-row">${badge(m.confidence)}<a class="sr-src" href="${esc(safeHref(m.source))}" target="_blank" rel="noopener">Nguồn lịch</a></div>
  </section>`);

  // 2. Tóm lại
  h.push(`<section class="sr-t sr-concl"><div><div class="sr-lab">Tóm lại về ${esc(D.team)}</div>
    <h1 data-testid="sr-sentence">${esc(s.sentence).replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>')}</h1></div>
    <div class="sr-chips">${(s.chips || []).map((c) => `<span>${esc(c)}</span>`).join('')}</div></section>`);

  // 3. Ba điều cần biết
  for (const it of arr(s.insights).filter(Boolean)) {
    const tone = TONE[it.tone] || 'lav';
    h.push(`<section class="sr-t sr-ins sr-${tone}" data-testid="sr-insight">
      <div class="sr-hd"><span class="sr-k">${esc(it.kicker)}</span>${it.ring ? ring(it.ring[0], it.ring[1], RING_COLOR[tone]) : ''}</div>
      <h3>${esc(it.title)}</h3><p>${esc(it.text)}</p>
      <div class="sr-row">${badge(it.confidence)}${methodTag(it.method)}</div>
      <div class="sr-acts">${evLink((it.evidence || [])[0])}${it.source ? `<a class="sr-btn" href="${esc(safeHref(it.source.url))}" target="_blank" rel="noopener">${esc(it.source.label || 'Đọc nguồn')}</a>` : ''}${it.planId ? planLink(it.planId) : ''}</div></section>`);
  }

  // 4. Phong độ
  const f = D.form;
  const chip = (r) => `<li class="sr-res sr-${r.result === 'W' ? 'w' : 'l'}"><b>${r.result === 'W' ? 'Thắng' : 'Thua'} ${esc(r.sets)}</b><span>${esc(r.opponent)}</span><small>${esc(r.dateLabel || r.date)}</small>${r.source ? `<a class="sr-mini" href="${esc(safeHref(r.source))}" target="_blank" rel="noopener">Báo</a>` : ''}</li>`;
  h.push(`<section class="sr-t sr-form" data-testid="sr-form"><div class="sr-lab">Phong độ gần đây</div>
    <div class="sr-big">${esc(f.record)}<span>${esc(f.recordNote || '')}</span></div>
    <ul class="sr-results">${arr(f.last5).map(chip).join('')}</ul>
    <p class="sr-note">${esc(f.note || '')}</p>
    <div class="sr-sub">Đối đầu với ${esc(m.home)}</div>
    <ul class="sr-h2h">${arr(f.h2h).map((r) => `<li><b>${r.sets && r.sets !== '—' ? `${esc(r.winner)} thắng ${esc(r.sets)}` : esc(r.winner)}</b> <span>${esc(r.dateLabel || r.date)} · ${esc(r.competition)}</span>${r.setPoints ? `<small>${esc(r.setPoints)}</small>` : ''}${r.video ? evLink(r.video, 'Xem video', 'sr-mini') : ''}</li>`).join('')}</ul>
    <div class="sr-row">${badge(f.confidence)}<span class="sr-method">${esc(f.method || '')}</span></div></section>`);

  // 5. Số đếm được (trận đối đầu)
  const c = D.counts;
  if (c && c.status === 'counted' && Array.isArray(c.perSet)) {
    const bar = (n, d) => `<i style="width:${d ? Math.round((100 * n) / d) : 0}%"></i>`;
    h.push(`<section class="sr-t sr-counts" data-testid="sr-counts"><div class="sr-lab">Đếm thật từ bảng điểm · ${esc(c.matchLabel)}</div>
      <h3>${esc(c.headline)}</h3>
      <div class="sr-bars">${c.perSet.map((x) => { const th = arr(x && x.th).map(Number); return `<div class="sr-barrow"><span>Set ${esc(x && x.set)} <small>${esc(x && x.score)}</small></span><div class="sr-bar">${bar(th[0] || 0, th[1] || 0)}</div><b>${esc(th[0])}/${esc(th[1])}</b></div>`; }).join('')}</div>
      <p class="sr-note">${esc(c.explain)}</p>
      <ul class="sr-runs">${arr(c.runs).map((r) => `<li><b>${esc(r.text)}</b>${evLink(r.evidence, 'Xem đoạn này', 'sr-mini')}</li>`).join('')}</ul>
      <div class="sr-row">${badge(c.confidence)}<span class="sr-method">${esc(METHOD.dem)}</span></div>
      <p class="sr-fine">${esc(c.caveat)}</p></section>`);
  } else {
    h.push(`<section class="sr-t sr-counts" data-testid="sr-counts"><div class="sr-lab">Số đếm được</div><h3>Chưa đếm</h3><p class="sr-note">${esc((c && c.note) || 'Chưa có trận nào được đếm từ video.')}</p></section>`);
  }

  // 6. Nhân sự
  const R = D.roster;
  const tile = (p) => `<li class="sr-pl${p.key ? ' is-key' : ''}" data-testid="sr-player"><span class="sr-num">${esc(p.num)}</span>
    <div><b>${esc(p.name)}</b><small>${esc(p.role)}${p.h ? ` · ${esc(p.h)} cm` : ''}</small>${p.tags && p.tags.length ? `<em>${p.tags.map(esc).join(' · ')}</em>` : ''}${p.note ? `<p>${esc(p.note)}</p>` : ''}</div></li>`;
  h.push(`<section class="sr-t sr-roster" data-testid="sr-roster"><div class="sr-rhead"><div><div class="sr-lab">Nhân sự · HLV ${esc(R.coach)}</div>
      <h3>${esc(R.startingTitle)}</h3></div><div class="sr-row">${badge(R.startingConfidence)}<span class="sr-method">${esc(R.startingBasis)}</span></div></div>
    <ul class="sr-six">${arr(R.starting).map(tile).join('')}</ul>
    <details class="sr-more"><summary>Dự bị và thông tin khác <span>${arr(R.bench).length} người</span></summary>
      <ul class="sr-bench">${arr(R.bench).map(tile).join('')}</ul><p class="sr-note">${esc(R.note || '')}</p></details></section>`);

  // 7. Lối chơi
  const evItem = (e) => `<li><a data-evidence href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label)}</a>${e.quote ? `<q>${esc(e.quote)}</q>` : ''}</li>`;
  h.push(`<section class="sr-t sr-tend-wrap"><div class="sr-rhead"><div><div class="sr-lab">Lối chơi · từ ${esc(D.videosUsed)} video</div><h3>Xu hướng của ${esc(D.team)}</h3></div>
    <p class="sr-note">${esc(D.methodNote || '')}</p></div><div class="sr-tends">`);
  for (const t of D.tendencies || []) {
    const ev = arr(t.evidence).filter((e) => isEvidenceUrl(e.url));
    h.push(`<article class="sr-tend" data-testid="sr-tendency" id="t-${esc(t.id)}">
      <div class="sr-row"><span class="sr-area">${esc(AREA[t.area] || t.area)}</span>${badge(t.confidence)}${methodTag(t.method)}</div>
      <h4>${esc(t.title)}</h4><p>${esc(t.detail)}</p>
      ${ev.length ? `<ul class="sr-evs">${ev.slice(0, 3).map(evItem).join('')}</ul>` : ''}
      ${ev.length > 3 ? `<details class="sr-evmore"><summary>Thêm ${ev.length - 3} mốc</summary><ul class="sr-evs">${ev.slice(3).map(evItem).join('')}</ul></details>` : ''}
      <div class="sr-acts">${evLink(ev[0])}${t.planId ? planLink(t.planId) : ''}</div></article>`);
  }
  h.push('</div></section>');

  // 8. Phương án
  h.push(`<section class="sr-t sr-plans" data-testid="sr-plans"><div class="sr-rhead"><div><div class="sr-lab">Phương án đề xuất</div><h3>Đề xuất của AI — HLV quyết</h3></div>
    <p class="sr-note">Mỗi phương án gắn với một xu hướng ở trên. Bấm "Mở trên bàn chiến thuật" để sửa, mô phỏng và lưu. ${esc(D.plansNote || '')}</p></div><div class="sr-plangrid">`);
  for (const P of D.plans || []) {
    const p = P.plan;
    h.push(`<article class="sr-plan" data-testid="sr-plan">${miniCourt(p, D.homeNums || {})}
      <div class="sr-pbody"><div class="sr-row"><span class="sr-area">${esc(PHASE[p.phase] || p.phase)} · xoay vòng P${esc(p.rotation)}</span><span class="sr-ai">AI đề xuất</span></div>
      <h4>${esc(p.name)}</h4><p>${esc(P.why)}</p>${P.brief ? `<p class="sr-brief"><b>Dặn đội:</b> ${esc(P.brief)}</p>` : ''}
      <div class="sr-acts">${evLink(arr(P.evidence)[0])}${planLink(p.id)}</div></div></article>`);
  }
  h.push('</div></section>');

  // 9. Danh sách clip
  h.push(`<details class="sr-t sr-clips" data-testid="sr-clips"><summary>Danh sách clip theo xu hướng <span>${(D.clips || []).reduce((a, g) => a + g.items.length, 0)} mốc</span></summary><div class="sr-cgrid">`);
  for (const g of D.clips || []) {
    h.push(`<div><div class="sr-sub">${esc(g.title)}</div><ul>${g.items.filter((e) => isEvidenceUrl(e.url)).map((e) => `<li><a data-evidence href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label)}</a></li>`).join('')}</ul></div>`);
  }
  h.push('</div></details>');

  // 10. Nguồn
  h.push(`<footer class="sr-t sr-sources" data-testid="sr-sources"><div class="sr-lab">Nguồn và cách làm</div><p class="sr-note">${esc(D.sourcesNote || '')}</p>
    <ul>${arr(D.sources).filter(Boolean).map((x) => `<li><a href="${esc(safeHref(x.url))}" target="_blank" rel="noopener">${esc(x.label)}</a>${x.note ? ` <small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ul>
    <p class="sr-fine">Tạo ${esc(D.generated)} · ${esc(D.label || '')}</p></footer>`);

  const cd = countdown(m.start, now);
  const lead = /^(Còn|Ngày mai|Hôm nay)/.test(cd) ? `${cd} tới trận gặp ${m.opponent || ''}` : `Trận gặp ${m.opponent || ''}`;
  h.push(`<div class="sr-today"><span>${esc(lead)} · ${esc(s.bottomLine || '')}</span><a href="tactics.html">Mở bàn chiến thuật</a></div>`);
  h.push('</main>');
  return h.join('\n');
}

export async function mountScoutReport(el, opts = {}) {
  const url = opts.url || 'data/scout/xmls-thanh-hoa.json';
  let data;
  try {
    // Chỉ đọc file báo cáo cùng trang, trong data/scout/ — chặn ?data= trỏ sang site khác.
    if (!/^data\/scout\/[a-z0-9-]+\.json$/.test(url)) throw new Error('Đường dẫn dữ liệu không hợp lệ');
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    el.innerHTML = `<main class="sr-grid"><section class="sr-t sr-concl"><div class="sr-lab">Không tải được báo cáo</div><h1>Chưa mở được dữ liệu scout.</h1><p class="sr-note">${esc(url)} — ${esc(e.message)}</p></section></main>`;
    return { data: null, render() {}, destroy() { el.innerHTML = ''; } };
  }
  const render = () => {
    try { el.innerHTML = renderScoutReport(data, opts.now || new Date()); } catch (e) {
      el.innerHTML = `<main class="sr-grid"><section class="sr-t sr-concl"><div class="sr-lab">Báo cáo bị lỗi dữ liệu</div><h1>Không hiển thị được báo cáo.</h1><p class="sr-note">${esc(e.message)}</p></section></main>`;
    }
  };
  render();
  const byId = Object.fromEntries(arr(data.plans).filter((p) => p && p.plan).map((p) => [p.plan.id, p.plan]));
  async function onClick(ev) {
    const a = ev.target.closest && ev.target.closest('a[data-plan]');
    if (!a || !byId[a.dataset.plan]) return;
    ev.preventDefault();
    try {
      const tx = await import('./tactics.js');
      if (tx && typeof tx.savePlan === 'function') tx.savePlan({ ...byId[a.dataset.plan], source: 'ai' });
    } catch { /* bàn chiến thuật chưa sẵn sàng → vẫn mở link */ }
    location.href = a.href;
  }
  el.addEventListener('click', onClick);
  return { data, render, destroy() { el.removeEventListener('click', onClick); el.innerHTML = ''; } };
}
