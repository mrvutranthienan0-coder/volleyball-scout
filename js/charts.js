// Biểu đồ nhẹ (SVG / CSS, không thư viện) + khối "Kết luận hiện tại" và các thẻ xu hướng dùng chung
// cho màn Hội ý, màn Các pha và Trợ lý hội ý. Chỉ dựng chuỗi HTML; số lấy từ analysis.js.
import * as A from './analysis.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Nhãn chỉ hiện khi CHƯA chắc hẳn (lo / mid) — số đếm và số đủ chắc không gắn nhãn, tránh lặp chữ trên mọi thẻ.
export const certTag = (c) => (c && (c.cls === 'lo' || c.cls === 'mid') ? `<span class="cert ${c.cls}">${esc(c.label)}</span>` : '');
export const metaLine = (nText, c, extra = '') => `<p class="nmeta">${certTag(c)}<span>n = ${esc(nText)}</span>${extra ? `<span>${esc(extra)}</span>` : ''}</p>`;
export const legend = (items) => `<div class="lgd">${items.map(([cls, l]) => `<span><i class="k ${cls}"></i>${esc(l)}</span>`).join('')}</div>`;

// ---------- SVG đường (nhiều chuỗi, mốc set, vạch lưới) ----------
const W = 340;
export function lineSvg({ series, n, yMin, yMax, h = 110, marks = [], ticks = [], fmt = String, zero = null, label = '', xl = 'pha' }) {
  const L = 30, Rp = 8, T = 10, B = 16;
  const iw = W - L - Rp, ih = h - T - B;
  const X = (i) => L + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const Y = (v) => T + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const f = (x) => x.toFixed(1);
  let g = ticks.map((v) => `<line class="gl" x1="${L}" x2="${W - Rp}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="yt" x="${L - 5}" y="${f(Y(v) + 3.5)}">${esc(fmt(v))}</text>`).join('');
  if (zero != null) g += `<line class="zl" x1="${L}" x2="${W - Rp}" y1="${f(Y(zero))}" y2="${f(Y(zero))}"/>`;
  g += marks.map((mk) => { const x = f(X(mk.i - 0.5)); return `<line class="ml" x1="${x}" x2="${x}" y1="${T}" y2="${T + ih}"/><text class="mt" x="${+x + 3}" y="${T + 8}">${esc(mk.text)}</text>`; }).join('');
  g += `<text class="xt" x="${L}" y="${h - 3}">1</text><text class="xt e" x="${W - Rp}" y="${h - 3}">${n} ${esc(xl)}</text>`;
  const lines = series.map((s) => {
    let d = '', pen = false;
    s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f(X(i))},${f(Y(v))}`; pen = true; });
    const dots = n === 1 || s.v.filter((v) => v != null).length === 1 ? s.v.map((v, i) => (v == null ? '' : `<circle class="${s.cls}" cx="${f(X(i))}" cy="${f(Y(v))}" r="3"/>`)).join('') : '';
    return (d ? `<path class="ln ${s.cls}" d="${d}"/>` : '') + dots;
  }).join('');
  return `<svg class="tch" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${g}${lines}</svg>`;
}
const niceMax = (v) => (v <= 5 ? 5 : v <= 10 ? 10 : v <= 15 ? 15 : v <= 25 ? 25 : Math.ceil(v / 10) * 10);

// ---------- Biểu đồ trong thẻ trả lời ----------
export function artChart(c) {
  if (!c) return '';
  if (c.type === 'hbars') {
    if (!c.items.length) return '';
    return `<ul class="hb">${c.items.map((x) => `<li><span class="bl">${esc(x.label)}</span><span class="bar ${x.cls || 'win'}"><i style="width:${((Math.max(0, x.v) / (x.max || 1)) * 100).toFixed(1)}%"></i></span><b class="num">${esc(x.text)}</b></li>`).join('')}</ul>`;
  }
  if (c.type === 'pair') {
    const bar = (v, t, cls) => `<span class="pb"><span class="bar ${cls}"><i style="width:${v == null ? 0 : (v * 100).toFixed(1)}%"></i></span><small class="num">${v == null ? '–' : Math.round(v * 100) + '%'} <em>${esc(t)}</em></small></span>`;
    return `${legend(c.legend.map(([k, l]) => ['k-' + k, l]))}<ul class="pr">${c.items.map((x) => `<li><span class="bl">${esc(x.label)}</span>${bar(x.a, x.an, 'pa')}${bar(x.b, x.bn, 'pbb')}</li>`).join('')}</ul>`;
  }
  if (c.type === 'div') {
    if (!c.items.length) return '';
    const mx = Math.max(1, ...c.items.map((x) => Math.max(x.up, x.dn)));
    return `${legend(c.legend.map(([k, l]) => ['k-' + k, l]))}<ul class="dv">${c.items.map((x) => `<li><span class="bl">${esc(x.label)}</span><b class="num c-lose">${x.dn}</b><span class="bar lose rev"><i style="width:${((x.dn / mx) * 100).toFixed(1)}%"></i></span><span class="bar win"><i style="width:${((x.up / mx) * 100).toFixed(1)}%"></i></span><b class="num c-win">${x.up}</b></li>`).join('')}</ul>`;
  }
  if (c.type === 'seq') {
    if (!c.rallies.length) return '';
    let out = '', prev = null;
    for (const r of c.rallies) { if (prev != null && r.set !== prev) out += `<i class="sb">S${r.set}</i>`; out += `<span class="sq ${r.w ? 'w' : 'l'}"></span>`; prev = r.set; }
    return `${legend([['k-win', 'Ta ghi'], ['k-lose', 'Ta mất']])}<div class="seq" role="img" aria-label="${c.rallies.length} pha gần nhất">${out}</div>`;
  }
  return '';
}

// ---------- Kết luận hiện tại ----------
export function nowBlock(m, R, setN, { testid = 'now', compact = false } = {}) {
  const c = A.nowConclusions(m, R, setN);
  const li = (b) => `<li><span>${esc(b.text)}</span><span class="nm">${certTag(b.tag)}<small>n = ${b.n}</small></span></li>`;
  const adv = c.advice ? `<p class="adv ${c.advice.none ? 'none' : ''}" data-testid="${testid}-advice">${c.advice.none ? '' : '<b>Gợi ý · </b>'}${esc(c.advice.text)} ${c.advice.none ? '' : certTag(c.advice.tag) + `<small> n = ${c.advice.n}</small>`}</p>` : '';
  return `<section class="t nowc ${compact ? 'compact' : ''}" data-testid="${testid}"><div class="lab-row"><div class="lab">Kết luận · ${esc(A.scopeLabel(setN))}</div></div>
    <ul class="nowl">${c.bullets.map(li).join('')}</ul>${adv}</section>`;
}

// ---------- Thẻ xu hướng ----------
const card = (id, title, sub, body, meta, cls = '') => `<section class="card tcard ${cls}" data-testid="tr-${id}"><div class="card-h"><div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div></div>${body}${meta}</section>`;
const empty = (t) => `<p class="empty">${esc(t)}</p>`;

export function trScore(td) {
  if (!td.n) return card('score', 'Diễn biến tỉ số', '', empty('Chưa có pha nào.'), '');
  const mx = niceMax(Math.max(...td.us, ...td.them, 1));
  const svg = lineSvg({ series: [{ v: td.us, cls: 's-us' }, { v: td.them, cls: 's-them' }], n: td.n, yMin: 0, yMax: mx, ticks: [0, Math.round(mx / 2), mx], marks: td.marks, label: `Tỉ số qua ${td.n} pha` });
  return card('score', 'Diễn biến tỉ số', '', svg + legend([['s-us', 'Ta'], ['s-them', 'Đối thủ']]), metaLine(`${td.n} pha`, A.FACT));
}
export function trMargin(td) {
  if (!td.n) return card('margin', 'Hiệu số điểm', '', empty('Chưa có pha nào.'), '');
  const mx = Math.max(3, ...td.margin.map(Math.abs));
  const svg = lineSvg({ series: [{ v: td.margin, cls: 's-us' }], n: td.n, yMin: -mx, yMax: mx, zero: 0, ticks: [-mx, mx], fmt: (v) => (v > 0 ? '+' + v : v), marks: td.marks, label: 'Hiệu số điểm qua từng pha' });
  return card('margin', 'Hiệu số điểm', 'Trên 0 là ta dẫn', svg, metaLine(`${td.n} pha`, A.FACT));
}
export function trRolling(td) {
  const has = td.so.some((v) => v != null) || td.bp.some((v) => v != null);
  const body = has ? lineSvg({ series: [{ v: td.so.map((v) => (v == null ? null : v * 100)), cls: 's-so' }, { v: td.bp.map((v) => (v == null ? null : v * 100)), cls: 's-bp' }], n: td.n, yMin: 0, yMax: 100, ticks: [0, 50, 100], fmt: (v) => v + '%', marks: td.marks, label: `Tỉ lệ side-out và break-point trong ${td.win} pha gần nhất` })
    + legend([['s-so', 'Khi đối thủ phát'], ['s-bp', 'Khi ta phát']]) : empty('Cần ít nhất 3 pha mới vẽ được.');
  return card('rolling', `Tỉ lệ giành pha · ${td.win} pha gần nhất`, '', body, metaLine(`${td.soN} pha đỡ phát · ${td.bpN} pha ta phát`, A.cert(Math.min(td.soN, td.bpN))));
}
const UP = [['atk', 'c-atk', 'Tấn công'], ['blk', 'c-blk', 'Chắn'], ['ace', 'c-ace', 'Ace'], ['oer', 'c-oer', 'Đối thủ lỗi'], ['uw', 'c-unk', 'Không rõ']];
const DN = [['oat', 'c-oat', 'Đối thủ tấn công'], ['bkd', 'c-bkd', 'Bị chắn'], ['rer', 'c-rer', 'Bị ace / đỡ hỏng'], ['own', 'c-own', 'Ta tự lỗi'], ['ul', 'c-unk', 'Không rõ']];
export function trChunks(td) {
  if (!td.n) return card('chunks', `Điểm theo từng ${td.chunk} pha`, '', empty('Chưa có pha nào.'), '');
  const cols = td.chunks.map((c) => ({ ...c, dn: { ...c.dn, own: c.dn.aer + c.dn.ser + c.dn.xer } }));
  const h = 130, T = 6, B = 16, mid = T + (h - T - B) / 2, half = (h - T - B) / 2 - 2;
  const mx = Math.max(1, ...cols.map((c) => Math.max(UP.reduce((s, [k]) => s + c.up[k], 0), DN.reduce((s, [k]) => s + c.dn[k], 0))));
  const L = 30, Rp = 8, iw = W - L - Rp, cw = iw / cols.length, bw = Math.min(26, cw * 0.7);
  let g = `<line class="zl" x1="${L}" x2="${W - Rp}" y1="${mid}" y2="${mid}"/><text class="yt" x="${L - 5}" y="${T + 8}">+${mx}</text><text class="yt" x="${L - 5}" y="${h - B}">−${mx}</text>`;
  cols.forEach((c, i) => {
    const x = (L + i * cw + (cw - bw) / 2).toFixed(1);
    let y = mid;
    for (const [k, cls] of UP) { const v = c.up[k]; if (!v) continue; const hh = (v / mx) * half; y -= hh; g += `<rect class="${cls}" x="${x}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}"/>`; }
    y = mid;
    for (const [k, cls] of DN) { const v = c.dn[k]; if (!v) continue; const hh = (v / mx) * half; g += `<rect class="${cls}" x="${x}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}"/>`; y += hh; }
    if (cols.length <= 12 || i % 2 === 0) g += `<text class="xt m" x="${(+x + bw / 2).toFixed(1)}" y="${h - 3}">${c.to}</text>`;
  });
  const svg = `<svg class="tch" viewBox="0 0 ${W} ${h}" role="img" aria-label="Điểm ghi và mất theo từng ${td.chunk} pha">${g}</svg>`;
  return card('chunks', `Điểm theo từng ${td.chunk} pha`, 'Trên vạch: ta ghi · dưới vạch: ta mất', svg + legend([...UP, ...DN].filter(([k], i, arr) => arr.findIndex((y) => y[1] === arr[i][1]) === i).map(([, c, l]) => [c, l])), metaLine(`${td.n} pha · ${cols.length} cột`, A.FACT));
}
export function trRot(td) {
  const cell = (k) => {
    const v = td.rot[k];
    const last = v.length ? v[v.length - 1] : 0;
    const mx = Math.max(2, ...v.map(Math.abs));
    const svg = v.length ? lineSvg({ series: [{ v, cls: last >= 0 ? 's-win' : 's-lose' }], n: v.length, yMin: -mx, yMax: mx, zero: 0, h: 60, label: `${k}: hiệu số tích luỹ ${last}`, xl: '' }) : '<p class="hint">Chưa có pha</p>';
    return `<div class="rs-c" data-testid="tr-rot-${k}"><div class="rs-h"><b>${k}</b><span class="num ${last > 0 ? 'c-win' : last < 0 ? 'c-lose' : ''}">${last > 0 ? '+' : ''}${last}</span><small>${v.length} pha</small></div>${svg}</div>`;
  };
  const n = Object.values(td.rot).reduce((s, v) => s + v.length, 0);
  return card('rot', 'Hiệu số theo xoay vòng', '', n ? `<div class="rs-g">${['P4', 'P3', 'P2', 'P5', 'P6', 'P1'].map(cell).join('')}</div>` : empty('Chưa có pha nào.'),
    metaLine(`${Math.max(0, ...Object.values(td.rot).map((v) => v.length))} pha ở vòng nhiều nhất`, A.cert(Math.max(0, ...Object.values(td.rot).map((v) => v.length)))));
}
const TOP_CLS = ['s-t1', 's-t2', 's-t3'];
export function trTop(td, m) {
  if (!td.cum.length) return card('top', 'Người ghi điểm nhiều nhất', '', empty('Chưa có điểm nào ghi rõ cầu thủ.'), '');
  const mx = niceMax(Math.max(1, ...td.cum.map((c) => c.v[c.v.length - 1])));
  const svg = lineSvg({ series: td.cum.map((c, i) => ({ v: c.v, cls: TOP_CLS[i] })), n: td.n, yMin: 0, yMax: mx, ticks: [0, mx], marks: td.marks, label: 'Điểm cộng dồn của 3 người ghi nhiều nhất' });
  const tot = td.cum.reduce((s, c) => s + c.v[c.v.length - 1], 0);
  return card('top', 'Người ghi điểm nhiều nhất', '', svg + legend(td.cum.map((c, i) => [TOP_CLS[i], `${A.shortP(m, c.pid)} · ${c.v[c.v.length - 1]}`])), metaLine(`${tot} điểm của ${td.cum.length} người`, A.FACT));
}
export function trServe(td) {
  if (!td.bpN) return card('serve', 'Phát bóng: ace và lỗi', '', empty('Ta chưa phát quả nào.'), '');
  const a = td.serve.ace, e = td.serve.se;
  const mx = Math.max(3, a[a.length - 1], e[e.length - 1]);
  const svg = lineSvg({ series: [{ v: a, cls: 's-win' }, { v: e, cls: 's-lose' }], n: td.bpN, yMin: 0, yMax: mx, ticks: [0, mx], label: 'Ace và lỗi phát cộng dồn', xl: 'lượt phát' });
  return card('serve', 'Phát bóng: ace và lỗi', '', svg + legend([['s-win', `Ace · ${a[a.length - 1]}`], ['s-lose', `Lỗi phát · ${e[e.length - 1]}`]]), metaLine(`${td.bpN} lượt phát`, A.cert(td.bpN)));
}

// Hội ý: bản gọn (3 biểu đồ) — màn hình không bao giờ trống khi đã có pha.
export function coachTrends(m, R, setN) {
  const td = A.trendData(m, R, setN);
  return `<div class="trgrid compact" data-testid="coach-trends">${trMargin(td)}${trChunks(td)}${trRolling(td)}</div>`;
}
