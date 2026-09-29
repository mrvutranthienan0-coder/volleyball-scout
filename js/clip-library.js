// Thư viện clip + nguồn của báo cáo scout: chia theo nhóm (category) → tag, lọc thêm theo trận / cầu thủ,
// thẻ có ảnh YouTube, bấm là xem ngay trong panel bên cạnh.
// Dữ liệu lấy từ báo cáo (D.clips[].tag/tendency/area, D.sources, D.tendencies…), không gõ tay. Ảnh thẻ = ảnh thu nhỏ của
// chính YouTube (i.ytimg.com) — app không trích hay lưu khung hình video nào.
import { ytEmbed, fmtTime } from './video.js';
import { norm, mentions, shortName } from './player-panel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (v) => (Array.isArray(v) ? v : []);
const YT = /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})(?:&t=(\d+)s)?$/;
const CONF = { cao: ['Chắc chắn', 'hi'], 'vừa': ['Khá chắc', 'mid'], 'thấp': ['Cần kiểm', 'lo'] };
const METHOD = { dem: 'Đếm từ bảng điểm', phude: 'Bình luận viên nói', gemini: 'AI tóm, đã đối chiếu phụ đề', bao: 'Báo chí' };
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const MOBILE_CAP = 4; // màn hẹp: mỗi tag hiện 4 thẻ, bấm "Xem thêm" mới mở hết

// Bảng nhóm duy nhất: khu vực (area) của xu hướng → nhóm hiển thị. Clip mới chỉ cần 'tendency' (hoặc 'area') là tự vào đúng nhóm.
export const CATS = [
  { id: 'attack', label: 'Tấn công', areas: ['attack'] },
  { id: 'set', label: 'Chuyền hai', areas: ['set'] },
  { id: 'recv', label: 'Đỡ phát & phòng thủ', areas: ['reception', 'defense'] },
  { id: 'serve', label: 'Phát bóng', areas: ['serve', 'rotation'] },
  { id: 'block', label: 'Chắn', areas: ['block'] },
  { id: 'people', label: 'Nhân sự & đội hình', areas: ['people'] },
];
const OTHER = { id: 'other', label: 'Khác', areas: [] };
const catOf = (area) => CATS.find((c) => c.areas.includes(area)) || OTHER;
const catOrder = (id) => { const i = CATS.findIndex((c) => c.id === id); return i < 0 ? CATS.length : i; };
// Tag ngắn khi dữ liệu chưa có 'tag': cắt câu ở dấu ':' '—' '(' và giới hạn độ dài.
const shortTag = (t) => { const x = String(t || '').split(/[:—(]/)[0].trim(); return x.length > 34 ? x.slice(0, 32).trim() + '…' : x || 'Khác'; };

// "Thanh Hóa–LPBank 7/4" → { key: '7/4', short: '7/4 · LPBank', ord } ; "…23/3/2025" → key '23/3/2025'
function dateKey(s) {
  const m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?!\d)/.exec(String(s || ''));
  if (!m) return null;
  const y = m[3] ? +m[3] : 2026;
  return { key: `${+m[1]}/${+m[2]}${y !== 2026 ? '/' + y : ''}`, ord: y * 10000 + +m[2] * 100 + +m[1] };
}
function matchOf(label) {
  const name = String(label || '').split(' · ')[0].trim();
  const dk = dateKey(name);
  if (!dk) return null;
  const opp = name.replace(/^[^–-]+[–-]\s*/, '').replace(/\s*\d{1,2}\/\d{1,2}(\/\d{4})?\s*$/, '').trim();
  return { key: dk.key, ord: dk.ord, name, short: `${dk.key} · ${opp || name}` };
}

// ─── Mô hình dữ liệu ───
export function clipModel(D, players = []) {
  const tends = arr(D && D.tendencies);
  const groups = [];
  arr(D && D.clips).forEach((g, gi) => {
    if (!g || !Array.isArray(g.items)) return;
    const gt = norm(g.title);
    const t = tends.find((x) => x && g.tendency && x.id === g.tendency)
      || (!g.tendency && tends.find((x) => x && (norm(x.title).startsWith(gt) || gt.startsWith(norm(x.title).slice(0, 24))))) || null;
    const cat = catOf(g.area || (t && t.area));
    groups.push({ gi, title: String(g.title || ''), tag: String(g.tag || shortTag(g.title)), tend: t, cat, g });
  });
  groups.sort((a, b) => catOrder(a.cat.id) - catOrder(b.cat.id) || a.gi - b.gi);
  const items = [];
  for (const G of groups) {
    for (const e of G.g.items) {
      const m = e && YT.exec(String(e.url || ''));
      if (!m || m[2] == null) continue;
      const txt = `${G.title} ${e.quote || ''}`;
      const pl = players.filter((p) => /^\d{1,3}$/.test(String(p.num)) && (mentions(p.name, txt)
        || new RegExp(`(?:số\\s*${p.num}(?!\\d))|(?:(?:^|[^\\d:.,\\-])${p.num}\\s+\\p{Lu})`, 'u').test(String(e.quote || '')))).map((p) => String(p.num));
      items.push({ i: items.length, url: e.url, vid: m[1], sec: +m[2], label: e.label, quote: e.quote || '', check: e.check || '',
        gi: G.gi, group: G.title, tag: G.tag, cat: G.cat, tend: G.tend, match: matchOf(e.label), players: pl });
    }
  }
  const tags = groups.map(({ g, ...x }) => ({ ...x, n: items.filter((it) => it.gi === x.gi).length })).filter((x) => x.n);
  const cats = [...CATS, OTHER].filter((c) => tags.some((x) => x.cat.id === c.id));
  const mm = new Map();
  for (const x of items) if (x.match && !mm.has(x.match.key)) mm.set(x.match.key, x.match);
  const matches = [...mm.values()].sort((a, b) => a.ord - b.ord);
  const byNum = new Map(players.map((p) => [String(p.num), p]));
  const cnt = new Map();
  for (const x of items) for (const n of x.players) cnt.set(n, (cnt.get(n) || 0) + 1);
  const people = [...cnt.entries()].filter(([n]) => byNum.has(n)).sort((a, b) => +a[0] - +b[0])
    .map(([n, c]) => ({ num: n, name: byNum.get(n).name, n: c }));
  return { items, tags, cats, matches, people };
}
// f = { c: catId|'', g: Set<gi> (tag trong nhóm đang chọn), m: matchKey|'', p: num|'' }
export function filterClips(M, f) {
  return M.items.filter((x) => (!f.c || x.cat.id === f.c) && (!f.g || !f.g.size || f.g.has(x.gi))
    && (!f.m || (x.match && x.match.key === f.m)) && (!f.p || x.players.includes(f.p)));
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const KIND = { video: 'Video', bao: 'Báo', doi: 'Danh sách đội' };
const KINDS = ['video', 'bao', 'doi'];
// Nguồn: nhóm = Video / Báo / Danh sách đội; tag = trận (nếu nguồn nói về một trận) hoặc chủ đề chung.
export function sourceModel(D, clipM) {
  const out = [];
  const claims = citedBy(D);
  // Trận = ngày có trận thật (clip, phong độ, đối đầu) — ngày đăng bài không phải trận.
  const games = new Map();
  for (const m of clipM ? clipM.matches : []) games.set(m.key, m);
  for (const r of [...arr(D && D.form && D.form.last5), ...arr(D && D.form && D.form.h2h)]) {
    const k = r && dateKey(r.dateLabel || r.date);
    if (k && !games.has(k.key)) games.set(k.key, { key: k.key, ord: k.ord, short: `${k.key} · ${r.opponent || 'LPBank'}` });
  }
  arr(D && D.sources).forEach((s) => {
    if (!s || !/^https?:\/\//.test(String(s.url || ''))) return;
    const m = YT.exec(s.url);
    const kind = m ? 'video' : /wikipedia\.org/.test(s.url) || /số áo|danh sách/i.test(`${s.label} ${s.note || ''}`) ? 'doi' : 'bao';
    const dk = dateKey(s.label);
    const cl = claims.get(s.url) || [];
    const d2 = dk || cl.map((c) => c.date).find(Boolean) || null;
    const uses = m && clipM ? clipM.items.filter((x) => x.vid === m[1]) : [];
    const site = host(s.url);
    const game = d2 && games.get(d2.key) ? games.get(d2.key) : null;
    const tag = game ? { key: game.key, label: game.short, ord: game.ord }
      : kind === 'video' ? { key: '_old', label: 'Mùa trước', ord: 1e9 } : { key: '_gen', label: kind === 'doi' ? 'Danh sách' : 'Tin chung', ord: 2e9 };
    out.push({ i: out.length, label: s.label, url: s.url, note: s.note || '', kind, vid: m ? m[1] : null, sec: m && m[2] ? +m[2] : 0, game, tag,
      site, title: String(s.label).replace(new RegExp(`\\s+[—-]\\s+${site.replace(/\./g, '\\.')}.*$`), ''), date: d2, claims: cl, uses });
  });
  return out;
}
// f = { k: kind|'', t: Set<tagKey> }
export function filterSources(S, f) {
  return S.filter((s) => (!f.k || s.kind === f.k) && (!f.t || !f.t.size || f.t.has(s.tag.key)))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.tag.ord - b.tag.ord || a.i - b.i);
}
function citedBy(D) {
  const map = new Map();
  const add = (url, text, date = null) => { if (!url) return; if (!map.has(url)) map.set(url, []); map.get(url).push({ text, date }); };
  if (D && D.match) add(D.match.source, `Trận tới: ${D.match.home} gặp ${D.match.opponent} — giờ, sân (lịch)`);
  for (const r of arr(D && D.form && D.form.last5)) {
    if (r) add(r.source, `Phong độ: ${r.result === 'W' ? 'thắng' : 'thua'} ${r.opponent} ${r.sets} (${r.dateLabel || r.date})`, dateKey(r.dateLabel || r.date));
  }
  for (const it of arr(D && D.summary && D.summary.insights)) if (it && it.source) add(it.source.url, `${it.kicker}: ${it.title}`);
  return map;
}

// ─── HTML ───
// Nút cao 48px (vùng chạm), phần nhìn thấy là viên thuốc nhỏ như các pill khác của báo cáo.
const pill = (attr, val, on, label, n, cls = '', tid = '') => `<button type="button" class="sr-pb ${cls}" ${attr}="${esc(val)}" aria-pressed="${on}"${tid ? ` data-testid="${tid}"` : ''}><span>${esc(label)}${n != null ? `<i>${n}</i>` : ''}</span></button>`;
const sel = (attr, label, all, opts, cur, tid) => `<label class="sr-sel"><span class="sr-vh">${esc(label)}</span><select ${attr} data-testid="${tid}" aria-label="${esc(label)}">
  <option value="">${esc(all)}</option>${opts.map(([v, l, n]) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}${n === 0 && cur !== v ? ' disabled' : ''}>${esc(l)}${n != null ? ` (${n})` : ''}</option>`).join('')}</select></label>`;
function clipCard(x) {
  return `<li><a class="sr-clip" data-pp-open data-evidence data-clip="${x.i}" data-testid="sr-clip" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.label)}">
    <span class="sr-thumb"><img src="${thumb(x.vid)}" alt="" loading="lazy" data-thumb-fb><i class="sr-playic" aria-hidden="true"></i><b class="sr-ts">${esc(fmtTime(x.sec))}</b></span>
    <span class="sr-cmeta"><b>${esc(x.match ? x.match.short : x.label)}</b></span></a></li>`;
}
function rowHtml(list, card, key, open) {
  const more = list.length - MOBILE_CAP;
  return `<ul class="sr-crow${open ? ' is-open' : ''}">${list.map(card).join('')}</ul>
    ${more > 0 && !open ? `<button type="button" class="sr-moreb" data-row-more="${esc(key)}">Xem thêm ${more}</button>` : ''}`;
}
// f: bộ lọc; open: Set các tag đã bấm "Xem thêm" (màn hẹp)
export function clipsSection(M, f, open = new Set()) {
  const list = filterClips(M, f);
  const noCat = { ...f, c: '', g: new Set() };
  const base = filterClips(M, noCat);
  const inC = f.c ? filterClips(M, { ...f, g: new Set() }) : [];
  const catN = (id) => base.filter((x) => x.cat.id === id).length;
  const mN = (k) => filterClips(M, { ...f, m: k }).length, pN = (n) => filterClips(M, { ...f, p: n }).length;
  const on = !!(f.c || f.m || f.p);
  const cats = M.cats.filter((c) => !f.c || c.id === f.c);
  const body = cats.map((c) => {
    const tags = M.tags.filter((t) => t.cat.id === c.id && (!f.g || !f.g.size || f.g.has(t.gi)));
    const secs = tags.map((t) => {
      const its = list.filter((x) => x.gi === t.gi);
      if (!its.length) return '';
      return `<div class="sr-tagsec" data-testid="sr-tagsec" data-gi="${t.gi}"><div class="sr-taghd"><b>${esc(t.tag)}</b><span>${its.length} mốc</span></div>
${rowHtml(its, clipCard, 'c' + t.gi, open.has('c' + t.gi))}</div>`;
    }).join('');
    const n = list.filter((x) => x.cat.id === c.id).length;
    return n ? `<section class="sr-cat" data-testid="sr-cat" data-cat="${c.id}"><h4>${esc(c.label)} <span>${n} mốc</span></h4>${secs}</section>` : '';
  }).join('');
  return `<section class="sr-t sr-clips sr-lib" data-testid="sr-clips"><div class="sr-rhead"><div><div class="sr-lab">Clip theo xu hướng</div><h3>Xem lại đúng đoạn video</h3></div>
</div>
    <div class="sr-fbar" data-testid="sr-cfilters">
      <div class="sr-pills" role="group" aria-label="Nhóm">${pill('data-cf-c', '', !f.c, 'Tất cả', base.length, '', 'sr-cf-all')}${M.cats.map((c) => pill('data-cf-c', c.id, f.c === c.id, c.label, catN(c.id), '', 'sr-cf-c')).join('')}</div>
      ${f.c ? `<div class="sr-pills sr-tags" role="group" aria-label="Tag trong nhóm">${M.tags.filter((t) => t.cat.id === f.c).map((t) => pill('data-cf-g', t.gi, !!(f.g && f.g.has(t.gi)), t.tag, inC.filter((x) => x.gi === t.gi).length, 'sr-pb-tag', 'sr-cf-g')).join('')}</div>` : ''}
      <div class="sr-fsec">${sel('data-cf-m', 'Trận', 'Mọi trận', M.matches.map((m) => [m.key, m.short, mN(m.key)]), f.m, 'sr-cf-m')}
        ${M.people.length ? sel('data-cf-p', 'Cầu thủ', 'Mọi cầu thủ', M.people.map((p) => [p.num, `#${p.num} ${shortName(p.name)}`, pN(p.num)]), f.p, 'sr-cf-p') : ''}
        <span class="sr-fcount" data-testid="sr-ccount">${list.length}/${M.items.length} mốc</span>${on || (f.g && f.g.size) ? '<button type="button" class="sr-fclear" data-cf-clear>Bỏ lọc</button>' : ''}</div>
    </div>
    ${list.length ? body : '<p class="sr-note" data-testid="sr-cempty">Không có mốc nào khớp bộ lọc.</p>'}
  </section>`;
}
const PALS = [['#E6E1FA', '#6A55D8'], ['#DDF2E3', '#2E8B57'], ['#FDE4D6', '#D9653B'], ['#DDEBFA', '#2F6FD1'], ['#FBF1D6', '#8A6A12']];
function mono(site) {
  const core = String(site || '?').replace(/\.(vn|com|org|net)(\.\w+)?$/, '').split('.').pop();
  let h = 0; for (const c of core) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALS[h % PALS.length];
  return `<span class="sr-mono" style="--a-bg:${bg};--a-fg:${fg}" aria-hidden="true">${esc(core.slice(0, 2).toUpperCase())}</span>`;
}
function srcCard(s) {
  return `<li><a class="sr-clip sr-scard" data-pp-open data-srcid="${s.i}" data-testid="sr-scard" data-kind="${s.kind}" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.label)}">
    ${s.vid ? `<span class="sr-thumb"><img src="${thumb(s.vid)}" alt="" loading="lazy" data-thumb-fb><i class="sr-playic" aria-hidden="true"></i><b class="sr-ts">Cả trận</b></span>`
    : `<span class="sr-thumb sr-thumb-mono">${mono(s.site)}<em>${esc(s.site)}</em></span>`}
    <span class="sr-cmeta"><b>${esc(s.title)}</b><small>${esc(s.tag.label)} · ${esc(s.site)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span></a></li>`;
}
export function sourcesSection(D, S, f, open = new Set()) {
  const list = filterSources(S, f);
  const kN = (k) => S.filter((s) => s.kind === k).length;
  const tagsOf = (k) => { const m = new Map(); for (const s of S) if (s.kind === k && !m.has(s.tag.key)) m.set(s.tag.key, s.tag); return [...m.values()].sort((a, b) => a.ord - b.ord); };
  const body = KINDS.filter((k) => (!f.k || f.k === k) && list.some((s) => s.kind === k)).map((k) => {
    // Mỗi trận thường chỉ có 1 nguồn → không tách hàng theo tag (toàn hàng 1 thẻ); tag ghi trên thẻ + lọc bằng chip.
    const its = list.filter((s) => s.kind === k);
    return `<section class="sr-cat" data-cat="${k}"><h4>${esc(KIND[k])} <span>${its.length} nguồn</span></h4>
      <div class="sr-tagsec">${rowHtml(its, srcCard, 's' + k, open.has('s' + k))}</div></section>`;
  }).join('');
  return `<footer class="sr-t sr-sources sr-lib" data-testid="sr-sources"><div class="sr-lab">Nguồn</div>
    <div class="sr-fbar"><div class="sr-pills" role="group" aria-label="Loại nguồn">${pill('data-sf-k', '', !f.k, 'Tất cả', S.length, '', 'sr-sf-all')}${KINDS.filter((k) => kN(k)).map((k) => pill('data-sf-k', k, f.k === k, KIND[k], kN(k), '', 'sr-sf-k')).join('')}</div>
      ${f.k ? `<div class="sr-pills sr-tags" role="group" aria-label="Trận / chủ đề">${tagsOf(f.k).map((t) => pill('data-sf-t', t.key, !!(f.t && f.t.has(t.key)), t.label, S.filter((s) => s.kind === f.k && s.tag.key === t.key).length, 'sr-pb-tag', 'sr-sf-t')).join('')}</div>` : ''}
      <div class="sr-fsec"><span class="sr-fcount" data-testid="sr-scount">${list.length}/${S.length} nguồn</span></div></div>
    ${body}
    <p class="sr-fine">Tạo ${esc(D.generated)} · ${esc(D.label || '')}</p></footer>`;
}

// ─── Nội dung panel ───
function player(id, sec, title) {
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  const yt = `https://www.youtube.com/watch?v=${id}${sec ? `&t=${sec}s` : ''}`;
  return `<div class="pp-video" data-testid="pp-video">${off
    ? `<div class="pp-off" data-testid="pp-offline"><b>Máy đang không có mạng</b><span>Không phát được video lúc này. Khi có mạng, bấm "Mở trên YouTube".</span></div>`
    : `<iframe src="${esc(ytEmbed(id, sec, true))}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="eager" data-testid="pp-embed"></iframe>`}</div>
    <p class="pp-fine">Khung không phát được (video bị chặn nhúng, mất mạng)? Mở thẳng trên YouTube.</p>
    <a class="pp-btn" href="${esc(yt)}" target="_blank" rel="noopener"${sec ? ' data-evidence' : ''} data-testid="pp-ytlink">Mở trên YouTube${sec ? ` · ${esc(fmtTime(sec))}` : ''}</a>`;
}
export function clipPanelHtml(x) {
  const t = x.tend;
  const c = t ? (CONF[t.confidence] || CONF['thấp']) : null;
  return `<div class="pp-lab">Clip · ${esc(x.match ? x.match.name : '')} · ${esc(fmtTime(x.sec))}</div>
    <h2 id="pp-title">${esc(x.group)}</h2>
    ${player(x.vid, x.sec, x.label)}
    ${x.quote ? `<blockquote class="pp-quote">${esc(x.quote)}${x.check ? `<small>${esc(x.check)}</small>` : ''}</blockquote>` : ''}
    ${t ? `<section class="pp-sec"><h3>Xu hướng</h3><p class="pp-p">${esc(t.detail || t.title)}</p>
      <div class="pp-tags"><span class="pp-conf pp-conf-${c[1]}">${c[0]}</span>${METHOD[t.method] ? `<span class="pp-src">${METHOD[t.method]}</span>` : ''}</div></section>` : ''}`;
}
export function sourcePanelHtml(s) {
  if (s.vid) {
    return `<div class="pp-lab">Nguồn · Video</div><h2 id="pp-title">${esc(s.title)}</h2>${player(s.vid, s.sec, s.label)}
      ${s.note ? `<p class="pp-p">${esc(s.note)}</p>` : ''}
      <section class="pp-sec"><h3>Báo cáo dùng video này</h3>${s.uses.length
        ? `<p class="pp-p">${s.uses.length} mốc bằng chứng:</p><ul class="pp-links">${[...new Set(s.uses.map((u) => u.group))].map((g) => `<li>${esc(g)} <small>(${s.uses.filter((u) => u.group === g).length})</small></li>`).join('')}</ul>`
        : '<p class="pp-empty">Chưa có mốc nào trong báo cáo lấy từ video này.</p>'}</section>`;
  }
  return `<div class="pp-lab">Nguồn · ${esc(KIND[s.kind])}</div>
    <div class="pp-arthead">${mono(s.site)}<div><h2 id="pp-title">${esc(s.title)}</h2><p class="pp-facts">${esc(s.site)} · ${s.date ? `ngày ${esc(s.date.key)}` : 'ngày: không ghi trong dữ liệu'}</p></div></div>
    ${s.note ? `<p class="pp-p" data-testid="pp-snote">Ghi chú: ${esc(s.note)}</p>` : ''}
    <section class="pp-sec" data-testid="pp-claims"><h3>Báo cáo dẫn nguồn này ở</h3>${s.claims.length
      ? `<ul class="pp-flags">${s.claims.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>`
      : '<p class="pp-empty">Dữ liệu chưa nối nguồn này với nhận định cụ thể nào — chỉ nằm trong danh sách nguồn.</p>'}</section>
    <p class="pp-fine">Trang báo không cho nhúng vào app, nên mở ở tab mới.</p>
    <a class="pp-btn pp-btn-big" href="${esc(s.url)}" target="_blank" rel="noopener" data-testid="pp-open-article">${s.kind === 'doi' ? 'Mở trang' : 'Mở bài báo'}</a>`;
}
