// Báo cáo scout đối thủ (module độc lập, chưa nối vào app.js).
//
// const r = await mountScoutReport(el, { url: 'data/scout/xmls-thanh-hoa.json', now?: Date })
// → { data, render(), destroy() }
// Dữ liệu: xem data/scout/xmls-thanh-hoa.json (các khoá: match, summary, form, counts, roster, tendencies, plans, clips, sources).
// Mọi bằng chứng video là link YouTube có &t=<giây>s. "Mở trên bàn chiến thuật" lưu phương án vào bộ nhớ
// của bàn chiến thuật (js/tactics.js savePlan) rồi mở tactics.html?plan=<id>.

import { thPlayers, playerCard, thProfileHtml, photoFor, loadCredits, open as openPanel, close as closePanel, cssReady } from './player-panel.js';
import { clipModel, clipsSection, sourceModel, sourcesSection, clipPanelHtml, sourcePanelHtml, filterClips, filterSources } from './clip-library.js';

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

// ─── Sa bàn: pha thật từ video (data/scout/boards-*.json, xuất bởi research/vision-pilot/src/board_export_app.py) ───
// Dữ liệu vào: toạ độ sân của máy (mét) — X 0–18 dọc sân (9 = lưới), Y 0–9 ngang sân. Đổi sang toạ độ bàn chiến thuật
// (js/tactics.js): x 0–9 ngang, y 0 = cuối sân đối thủ (đội được scout ở TRÊN), 9 = lưới, 18 = cuối sân ta (ở DƯỚI).
// Đổi toạ độ là phép quay (không lật gương) nên vùng 1–6 giữ đúng phía trái/phải của từng đội. Đổi sân giữa set: theo r.left.
const BM = [['serve', 'Phát'], ['set', 'Chuyền'], ['attack', 'Đập']];
const BM_LABEL = Object.fromEntries(BM);
const ZNAME = { 4: 'biên 4', 3: 'giữa lưới (vùng 3)', 2: 'biên 2', back: 'hàng sau' };
const ZKEYS = ['4', '2', '3', 'back'];
const ROLES = new Set(['SV', 'R', 'S', 'A']);
const TEAM_COLOR = { focus: '#D9653B', home: '#2F6FD1' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function toBoard(p, r, focus) {
  if (!p || !isNum(p.X) || !isNum(p.Y) || !r) return null;
  if (r.left === focus) return { x: 9 - p.Y, y: p.X };
  if (r.right === focus) return { x: p.Y, y: 18 - p.X };
  return null;
}

// ≤ 6 người mỗi đội, chỉ người đứng trên nửa sân của đội mình; ưu tiên người có vai (đập/chuyền/đỡ/phát), rồi người gần sân nhất.
export function pickSide(people, team, r, focus) {
  const top = team === focus;
  const y0 = top ? 0 : 9, y1 = top ? 9 : 18;
  const rank = { A: 0, S: 1, R: 2, SV: 3 };
  const L = [];
  arr(people).forEach((p, i) => {
    if (!p || p.team !== team) return;
    const q = toBoard(p, r, focus);
    if (!q || (top ? q.y > 9 : q.y < 9)) return;
    const out = Math.hypot(Math.max(0 - q.x, 0, q.x - 9), Math.max(y0 - q.y, 0, q.y - y1));
    L.push({ x: q.x, y: q.y, team, role: ROLES.has(p.role) ? p.role : '', i, out });
  });
  L.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.out - b.out || a.i - b.i);
  const seen = new Set();
  return L.slice(0, 6).map(({ x, y, team: t, role }) => {
    const ro = role && !seen.has(role) ? role : '';
    if (ro) seen.add(ro);
    return { x, y, team: t, role: ro };
  });
}

export function boardSnapshot(r, m, focus, home) {
  const mv = r && r.moments && r.moments[m];
  if (!mv || !Array.isArray(mv.people)) return null;
  const pts = [...pickSide(mv.people, focus, r, focus), ...pickSide(mv.people, home, r, focus)];
  return pts.length ? { m, t: isNum(mv.t) ? mv.t : null, pts } : null;
}

// Ghép người giữa 2 khoảnh khắc (cùng đội): cùng vai trước (vai gắn theo vết người của máy), phần còn lại bằng phép gán
// tổng quãng đường nhỏ nhất (vét cạn chính xác — ≤ 6×6 nên ≤ 720 trường hợp, cho kết quả như thuật toán Hungary).
// Cặp xa hơn `gate` mét coi là 2 người khác nhau: người cũ mờ dần, người mới hiện dần.
export function assignPairs(A, B, gate = 6) {
  const pairs = [], ua = new Set(), ub = new Set();
  A.forEach((a, i) => {
    if (!a.role) return;
    const j = B.findIndex((b, k) => !ub.has(k) && b.role === a.role);
    if (j >= 0) { pairs.push([i, j]); ua.add(i); ub.add(j); }
  });
  const ra = A.map((_, i) => i).filter((i) => !ua.has(i)).slice(0, 6);
  const rb = B.map((_, j) => j).filter((j) => !ub.has(j)).slice(0, 6);
  const flip = ra.length > rb.length, S = flip ? rb : ra, L = flip ? ra : rb;
  const cost = (s, l) => { const a = A[flip ? l : s], b = B[flip ? s : l]; return Math.hypot(a.x - b.x, a.y - b.y); };
  let best = [], bestC = Infinity; const cur = [], used = L.map(() => false);
  (function rec(k, c) {
    if (c >= bestC) return;
    if (k === S.length) { bestC = c; best = cur.slice(); return; }
    for (let q = 0; q < L.length; q++) {
      if (used[q]) continue;
      used[q] = true; cur.push(q); rec(k + 1, c + cost(S[k], L[q])); cur.pop(); used[q] = false;
    }
  })(0, 0);
  S.forEach((s, k) => {
    const l = L[best[k]];
    if (l === undefined || cost(s, l) > gate) return;
    const [i, j] = flip ? [l, s] : [s, l];
    pairs.push([i, j]); ua.add(i); ub.add(j);
  });
  A.forEach((_, i) => { if (!ua.has(i)) pairs.push([i, -1]); });
  B.forEach((_, j) => { if (!ub.has(j)) pairs.push([-1, j]); });
  return pairs;
}

// Dòng thời gian của một pha: các khoảnh khắc thật có mặt (theo thứ tự Phát → Chuyền → Đập), khoảng cách = giây thật
// trong video (kẹp 0,5–5 s nếu mốc hỏng). Giữa 2 khoảnh khắc: nội suy êm (ease-in-out) — KHÔNG phải quỹ đạo thật.
export function rallyTimeline(r, focus, home) {
  const K = [];
  for (const [m, label] of BM) {
    const s = boardSnapshot(r, m, focus, home);
    if (s) K.push({ ...s, label, at: 0 });
  }
  if (!K.length) return null;
  for (let i = 1; i < K.length; i++) {
    const g = isNum(K[i].t) && isNum(K[i - 1].t) ? K[i].t - K[i - 1].t : NaN;
    K[i].at = K[i - 1].at + (isNum(g) && g > 0 ? Math.min(5, Math.max(0.5, g)) : 1.5);
  }
  const segs = [];
  for (let i = 0; i + 1 < K.length; i++) {
    const pairs = [];
    for (const team of [focus, home]) {
      const ia = [], ib = [];
      K[i].pts.forEach((p, k) => { if (p.team === team) ia.push(k); });
      K[i + 1].pts.forEach((p, k) => { if (p.team === team) ib.push(k); });
      for (const [a, b] of assignPairs(ia.map((k) => K[i].pts[k]), ib.map((k) => K[i + 1].pts[k]))) {
        pairs.push([a < 0 ? -1 : ia[a], b < 0 ? -1 : ib[b]]);
      }
    }
    segs.push(pairs);
  }
  // Đường bóng suy ra: chuyền hai (lúc chuyền) → người đập (lúc đập), chỉ khi 2 khoảnh khắc liền nhau và cùng đội.
  let ball = null;
  const iS = K.findIndex((k) => k.m === 'set'), iA = K.findIndex((k) => k.m === 'attack');
  if (iS >= 0 && iA === iS + 1) {
    const a = K[iA].pts.find((p) => p.role === 'A');
    const s = a && K[iS].pts.find((p) => p.role === 'S' && p.team === a.team);
    if (a && s) ball = { from: { x: s.x, y: s.y }, to: { x: a.x, y: a.y }, t0: K[iS].at, t1: K[iA].at };
  }
  return { K, segs, T: K[K.length - 1].at, ball };
}

const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);
export function frameAt(tl, t) {
  if (!tl) return [];
  const { K, segs, T } = tl;
  if (K.length === 1) return K[0].pts.map((p) => ({ ...p, o: 1 }));
  t = Math.min(T, Math.max(0, isNum(t) ? t : 0));
  let i = 0;
  while (i < K.length - 2 && t >= K[i + 1].at) i++;
  const u = Math.min(1, Math.max(0, (t - K[i].at) / (K[i + 1].at - K[i].at)));
  const e = ease(u), A = K[i].pts, B = K[i + 1].pts;
  return segs[i].map(([a, b]) => {
    const p = A[a], q = B[b];
    if (p && q) return { x: p.x * (1 - e) + q.x * e, y: p.y * (1 - e) + q.y * e, team: p.team, role: e < 0.5 ? p.role || q.role : q.role || p.role, o: 1 };
    if (p) return { ...p, o: 1 - e };
    return { ...q, o: e };
  });
}

// Nhãn chắc chắn theo DECISIONS.md: < 3 trận hoặc < 100 pha liên quan = chưa đủ dữ liệu.
function certainty(nMatch, n) {
  if (nMatch < 3 || n < 100) return { label: 'Chưa đủ dữ liệu', cls: 'lo' };
  if (nMatch <= 5) return { label: 'Trung bình', cls: 'mid' };
  return { label: 'Khá chắc', cls: 'hi' };
}

export function boardModel(B, team) {
  const none = (reason) => ({ ok: false, reason });
  if (!B || typeof B !== 'object' || !Array.isArray(B.rallies)) return none('Chưa có dữ liệu sa bàn cho đội này.');
  if (team && B.opponent && B.opponent !== team) return none('Dữ liệu sa bàn không khớp đội đang xem.');
  const focus = B.focus, home = B.home;
  if (typeof focus !== 'string' || typeof home !== 'string' || !focus || focus === home) return none('Dữ liệu sa bàn thiếu tên đội.');
  const teams = B.teams && typeof B.teams === 'object' ? B.teams : {};
  const name = (c) => String(teams[c] || c);
  const matches = Object.fromEntries(arr(B.matches).filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
  const rallies = B.rallies.filter((r) => r && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(r.id)
    && ((r.left === focus && r.right === home) || (r.left === home && r.right === focus)) && r.moments && typeof r.moments === 'object');
  const byId = Object.fromEntries(rallies.map((r) => [r.id, r]));
  const pool = rallies.filter((r) => r.receiving === focus);
  const read = pool.filter((r) => r.der && ZKEYS.includes(String(r.der.attack_from)));
  const zoneOf = (r) => String(r.der.attack_from);
  const nMatch = new Set(read.map((r) => r.match)).size;
  const cert = certainty(nMatch, read.length);
  const oldRoster = [...new Set(read.map((r) => r.match))].some((id) => matches[id] && matches[id].roster_may_have_changed);
  const cnt = Object.fromEntries(ZKEYS.map((z) => [z, read.filter((r) => zoneOf(r) === z).length]));
  const order = [...ZKEYS].sort((a, b) => cnt[b] - cnt[a] || ZKEYS.indexOf(a) - ZKEYS.indexOf(b));
  const used = new Set();
  // Bằng chứng: ưu tiên pha đủ 3 khoảnh khắc và có người đập được đánh dấu.
  const score = (r) => (['serve', 'set', 'attack'].filter((m) => r.moments[m]).length * 2)
    + (arr(r.moments.attack && r.moments.attack.people).some((p) => p && p.role === 'A') ? 1 : 0);
  const pick = (L) => {
    const out = [...L].filter((r) => !used.has(r.id) && BM.some(([k]) => boardSnapshot(r, k, focus, home))).sort((a, b) => score(b) - score(a)).slice(0, 3);
    out.forEach((r) => used.add(r.id));
    return out.map((r) => r.id);
  };
  const n = read.length, obs = [];
  const f = focus;
  if (n) {
    const z1 = order[0];
    obs.push({ id: 'z1', title: `${f} tấn công từ ${ZNAME[z1]} nhiều nhất`, k: cnt[z1], n,
      text: `Trong ${n} pha máy đọc được chỗ đập của ${f}, ${cnt[z1]} pha đập từ ${ZNAME[z1]}.`, snaps: pick(read.filter((r) => zoneOf(r) === z1)) });
    const z2 = order[1];
    if (cnt[z2] > 0) {
      obs.push({ id: 'z2', title: `Chỗ đập nhiều thứ hai: ${ZNAME[z2]}`, k: cnt[z2], n,
        text: `${cnt[z2]} trong ${n} pha đập từ ${ZNAME[z2]}.`, snaps: pick(read.filter((r) => zoneOf(r) === z2)) });
    }
    const back = cnt.back, front = n - back;
    const backFew = back <= front;
    obs.push({ id: 'row', title: backFew ? `${f} đập hàng trên là chính, ít đập hàng sau` : `${f} đập hàng sau nhiều hơn hàng trên`,
      k: backFew ? front : back, n,
      text: `Hàng trên ${front} pha, hàng sau ${back} pha. Máy phân biệt hàng trên / hàng sau chắc hơn phân biệt từng vùng.`,
      snaps: pick(read.filter((r) => (zoneOf(r) === 'back') === backFew)) });
    if (!obs[obs.length - 1].snaps.length) obs[obs.length - 1].snaps = pick(read);
  }
  const vid = Object.values(matches).map((m) => m.video).find((v) => /^[\w-]{11}$/.test(String(v || ''))) || '';
  return { ok: true, focus, home, name, matches, byId, pool: pool.length, n, nMatch, cert, oldRoster, obs, q: B.quality || {}, vid };
}

// ─── vẽ sân (SVG, đơn vị mét) ───
const VB = { x: -1.8, y: -4.2, w: 12.6, h: 26.4 }; // đủ chỗ người phát đứng sau vạch cuối (tới ~4 m)
function zoneRect(z, top) {
  z = String(z);
  if (z === 'back') return top ? [0, 0, 9, 6] : [0, 12, 9, 6];
  const col = { 4: 0, 5: 0, 3: 1, 6: 1, 2: 2, 1: 2 }[z];
  if (col === undefined) return null;
  const front = ['2', '3', '4'].includes(z);
  const x = top ? (2 - col) * 3 : col * 3;        // đội trên nhìn xuống: bên trái của họ = bên phải màn hình
  const y = top ? (front ? 6 : 0) : (front ? 9 : 12);
  return [x, y, 3, front ? 3 : 6];
}
function courtBase(M, r, withZone) {
  const o = [`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="#EAE5DC"/>`,
    '<rect x="0" y="0" width="9" height="9" fill="#F2E3D8"/><rect x="0" y="9" width="9" height="9" fill="#E3ECF7"/>'];
  if (withZone && r && r.der && ZKEYS.includes(String(r.der.attack_from))) {
    const z = zoneRect(r.der.attack_from, r.receiving === M.focus);
    if (z) o.push(`<rect class="bd-zone" x="${z[0]}" y="${z[1]}" width="${z[2]}" height="${z[3]}" rx=".35"/>`);
  }
  o.push('<g stroke="#fff" stroke-width=".1" fill="none"><rect x="0" y="0" width="9" height="18"/><line x1="0" y1="6" x2="9" y2="6"/><line x1="0" y1="12" x2="9" y2="12"/></g>');
  for (const [z, x, y] of [[4, 7.5, 7.5], [3, 4.5, 7.5], [2, 1.5, 7.5], [5, 7.5, 3], [6, 4.5, 3], [1, 1.5, 3],
    [4, 1.5, 10.5], [3, 4.5, 10.5], [2, 7.5, 10.5], [5, 1.5, 15], [6, 4.5, 15], [1, 7.5, 15]]) {
    o.push(`<text x="${x}" y="${y + 0.4}" class="bd-zn">${z}</text>`);
  }
  o.push('<line x1="-0.6" y1="9" x2="9.6" y2="9" stroke="#1D1B20" stroke-width=".18"/>');
  o.push(`<text x="-1.6" y="-3.55" class="bd-tn" fill="${TEAM_COLOR.focus}">${esc(M.name(M.focus))}</text>`);
  o.push(`<text x="-1.6" y="21.95" class="bd-tn" fill="${TEAM_COLOR.home}">${esc(M.name(M.home))}</text>`);
  return o.join('');
}
const f3 = (v) => (Math.round(v * 1000) / 1000).toString();
function dotsSvg(M, pts, tags) {
  const o = [];
  for (const p of pts) {
    if (!(p.o > 0) && p.o !== undefined) continue;
    const c = p.team === M.focus ? TEAM_COLOR.focus : TEAM_COLOR.home;
    const op = p.o === undefined || p.o >= 1 ? '' : ` opacity="${f3(p.o)}"`;
    const hi = p.role === 'A' ? '<circle r=".78" class="bd-ra"/>' : p.role === 'S' ? '<circle r=".78" class="bd-rs"/>' : '';
    const tag = tags && (p.role === 'A' || p.role === 'S') ? `<text y="-1.05" class="bd-tag">${p.role === 'A' ? 'Đập' : 'Chuyền'}</text>` : '';
    o.push(`<g class="bd-p" data-team="${esc(p.team)}" data-role="${esc(p.role || '')}" data-x="${f3(p.x)}" data-y="${f3(p.y)}" transform="translate(${f3(p.x)} ${f3(p.y)})"${op}>${hi}<circle r=".46" fill="${c}" stroke="#fff" stroke-width=".1"/>${tag}</g>`);
  }
  return o.join('');
}
function boardSvg(M, r, m, { cls = 'sr-bd-svg', tags = false } = {}) {
  const s = boardSnapshot(r, m, M.focus, M.home);
  const body = s ? dotsSvg(M, s.pts, tags)
    : `<text x="4.5" y="4.6" class="bd-miss">Không có khoảnh khắc</text><text x="4.5" y="5.6" class="bd-miss">“${esc(BM_LABEL[m])}” ở pha này</text>`;
  return `<svg class="${cls}" overflow="hidden" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="Sa bàn lúc ${esc((BM_LABEL[m] || '').toLowerCase())}${s ? '' : ' (không có)'}">${courtBase(M, r, m === 'attack')}${body}</svg>`;
}
const vnMmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return `${h ? h + ':' + String(mm).padStart(2, '0') : mm}:${String(ss).padStart(2, '0')}`; };
function rallyStart(r) {
  for (const k of ['serve', 'set', 'attack']) if (r.moments[k] && isNum(r.moments[k].t)) return r.moments[k].t;
  return isNum(r.t && r.t.serve) ? r.t.serve : null;
}
function scoreText(M, r) {
  const s = r.score_before;
  return s && isNum(s[M.focus]) && isNum(s[M.home]) ? `${M.focus} ${s[M.focus]}–${s[M.home]} ${M.home === 'LPB' ? 'LPBank' : M.home}` : 'chưa rõ tỉ số';
}
function snapBtn(M, id, m) {
  const r = M.byId[id];
  return `<li><button type="button" class="sr-snap" data-snap="${esc(id)}" data-testid="sr-snap" aria-label="Mở lớn: set ${esc(r.set)}, ${esc(scoreText(M, r))}">${boardSvg(M, r, m)}
    <span>Set ${esc(r.set)} · ${esc(scoreText(M, r))}</span></button></li>`;
}
export function snapsHtml(M, ob, m) {
  return ob.snaps.filter((id) => M.byId[id]).map((id) => snapBtn(M, id, m)).join('');
}
function momentSwitch(m, attr) {
  return `<div class="sr-seg" role="group" aria-label="Chọn khoảnh khắc">${BM.map(([k, l]) => `<button type="button" ${attr}="${k}" aria-pressed="${k === m}">${l}</button>`).join('')}</div>`;
}
function boardsSection(M, m = 'attack') {
  if (!M || !M.ok) {
    return `<section class="sr-t sr-boards" data-testid="sr-boards"><div class="sr-lab">Pha thật trên sa bàn</div>
      <h3>Chưa có sa bàn</h3><p class="sr-note">${esc((M && M.reason) || 'Chưa có dữ liệu sa bàn cho đội này.')}</p></section>`;
  }
  const q = M.q, af = q.attack_from || {}, row = q.attack_row || {}, pn = q.position_noise_m || {};
  const ms = Object.values(M.matches);
  const when = ms.length === 1 && ms[0].date ? `trận ${esc(vnDay(ms[0].date))}` : `${M.nMatch} trận`;
  const tens = (a) => (isNum(a) ? Math.round(a / 10) : '?');
  const accAll = Array.isArray(af.correct_pct_all) ? af.correct_pct_all : [];
  const acc = `Máy đoán đúng chỗ đập khoảng ${tens(accAll[0])}–${tens(af.correct_pct_answered_max)}/10 pha, đang chờ HLV kiểm lại`
    + ` (so với nhãn do AI gán, ${esc(af.n_labelled ?? '?')} pha). Hàng trên hay hàng sau thì đúng hơn: ${esc(row.correct ?? '?')}/${esc(row.n ?? '?')} pha.`
    + ` Vị trí mỗi người lệch khoảng ${esc(dec1(pn.depth))} m theo hướng xa–gần camera, ${esc(dec1(pn.lateral))} m theo hướng ngang.`
    + ' Vùng phát bóng máy đoán còn sai nhiều nên không đưa vào.';
  const labels = `<span class="sr-conf sr-conf-${M.cert.cls}" data-testid="sr-conf">${esc(M.cert.label)}</span>`
    + (M.oldRoster ? '<span class="sr-conf sr-conf-mid" data-testid="sr-old">Đội hình cũ — có thể đã thay đổi</span>' : '')
    + '<span class="sr-method">Máy đọc từ video, chưa HLV kiểm</span>';
  const h = [`<section class="sr-t sr-boards" data-testid="sr-boards" data-moment="${m}">
    <div class="sr-rhead"><div><div class="sr-lab">Pha thật trên sa bàn · ${when} gặp LPBank</div><h3>${esc(M.focus)} đập từ đâu — máy đọc từ video</h3></div>
    ${momentSwitch(m, 'data-bm')}</div>
    <div class="sr-row">${labels}</div>
    <p class="sr-note">Có ${M.pool} pha ${esc(M.focus)} đỡ phát bóng; máy đọc được chỗ đập ở ${M.n} pha. Mỗi sân là một khoảnh khắc thật nhìn từ trên xuống,
      ${esc(M.focus)} ở trên (cam), LPBank ở dưới (xanh). Chạm vào sân để xem lớn, chạy lại pha và mở video.</p>
    <p class="sr-acc" data-testid="sr-acc">${acc}</p>`];
  if (!M.obs.length) {
    h.push(`<p class="sr-note" data-testid="sr-bd-empty">Máy chưa đọc được pha tấn công nào của ${esc(M.focus)}.</p></section>`);
    return h.join('');
  }
  h.push('<div class="sr-obsgrid">');
  for (const ob of M.obs) {
    const pc = ob.n ? Math.round((100 * ob.k) / ob.n) : 0;
    h.push(`<article class="sr-obs" data-testid="sr-obs" data-obs="${esc(ob.id)}">
      <div class="sr-obs-hd"><b class="sr-obs-pc">${pc}%</b><span>${ob.k}/${ob.n} pha · ${M.nMatch} trận</span></div>
      <h4>${esc(ob.title)}</h4><p>${esc(ob.text)}</p>
      <div class="sr-row">${labels.replace(/ data-testid="sr-(conf|old)"/g, '').replace(/<span class="sr-method">.*?<\/span>/, '')}</div>
      <ul class="sr-snaps" data-obs-snaps="${esc(ob.id)}">${snapsHtml(M, ob, m)}</ul></article>`);
  }
  h.push(`</div><p class="sr-fine">Chỉ là quan sát, chưa phải lời khuyên: chưa qua phép thử "sai số có làm đổi kết luận không". Chú thích: vòng đen = người đập, vòng nét đứt = chuyền hai, ô viền tím = vùng máy đọc là chỗ giậm nhảy đập.</p></section>`);
  return h.join('');
}
function vnDay(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); return m ? `${+m[3]}/${+m[2]}/${m[1]}` : ''; }
function dec1(v) { return isNum(v) ? (Math.round(v * 10) / 10).toString().replace('.', ',') : '?'; }

// extra (tuỳ chọn): { players: data/scout/players-<đội>.json, credits: ảnh đã ghi công, teamKey, cf/sf: bộ lọc clip/nguồn, open: các hàng đã bấm 'Xem thêm' }
export function renderScoutReport(D, now = new Date(), boards = null, extra = {}) {
  D = { ...D };
  extra = extra || {};
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
  const PL = thPlayers(D, extra.players);
  const tile = (p) => playerCard(p, photoFor(p, extra.credits, extra.teamKey));
  h.push(`<section class="sr-t sr-roster" data-testid="sr-roster"><div class="sr-rhead"><div><div class="sr-lab">Nhân sự · HLV ${esc(R.coach)}</div>
      <h3>${esc(R.startingTitle)}</h3></div><div class="sr-row">${badge(R.startingConfidence)}<span class="sr-method">${esc(R.startingBasis)}</span></div></div>
    <p class="sr-note">Chạm vào một cầu thủ để mở hồ sơ: chỉ số, ưu điểm, điểm yếu, chỗ nên khai thác — kèm nguồn.</p>
    <ul class="sr-six">${PL.start.map(tile).join('')}</ul>
    ${PL.fresh.length ? `<div class="sr-sub" data-testid="sr-newforeign">Ngoại binh mới giai đoạn 2 (chưa chính thức)</div><ul class="sr-six sr-new">${PL.fresh.map(tile).join('')}</ul>` : ''}
    <details class="sr-more"><summary>Dự bị và thông tin khác <span>${PL.bench.length} người</span></summary>
      <ul class="sr-bench">${PL.bench.map(tile).join('')}</ul><p class="sr-note">${esc(R.note || '')}</p></details></section>`);

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

  // 7b. Pha thật trên sa bàn (chỉ quan sát, không khuyên)
  h.push(boardsSection(boardModel(boards, D.team)));

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

  // 9. Clip theo xu hướng (lọc + thẻ ảnh, bấm là xem trong panel)
  const CM = clipModel(D, PL.all);
  h.push(clipsSection(CM, extra.cf || { c: '', g: new Set(), m: '', p: '' }, extra.open));

  // 10. Nguồn
  h.push(sourcesSection(D, sourceModel(D, CM), extra.sf || { k: '', t: new Set() }, extra.open));

  const cd = countdown(m.start, now);
  const lead = /^(Còn|Ngày mai|Hôm nay)/.test(cd) ? `${cd} tới trận gặp ${m.opponent || ''}` : `Trận gặp ${m.opponent || ''}`;
  h.push(`<div class="sr-today"><span>${esc(lead)} · ${esc(s.bottomLine || '')}</span><a href="tactics.html">Mở bàn chiến thuật</a></div>`);
  h.push('</main>');
  return h.join('\n');
}

// ─── Sa bàn lớn: xem từng khoảnh khắc + chạy lại pha (nội suy giữa các khoảnh khắc thật) ───
const CAPTION3 = 'Chuyển động nội suy giữa 3 khoảnh khắc thật (phát · chuyền · đập) — không phải quỹ đạo thật từng bước';
function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}
function ballPath(b) {
  const mx = (b.from.x + b.to.x) / 2, my = (b.from.y + b.to.y) / 2;
  const dx = b.to.x - b.from.x, dy = b.to.y - b.from.y, L = Math.hypot(dx, dy) || 1;
  const k = Math.min(2.2, 0.35 * L + 0.8), cx = mx - (dy / L) * k, cy = my + (dx / L) * k;
  return { d: `M${f3(b.from.x)} ${f3(b.from.y)} Q${f3(cx)} ${f3(cy)} ${f3(b.to.x)} ${f3(b.to.y)}` };
}
function dialogHtml(M, r, tl, m, reduced) {
  const match = M.matches[r.match] || {};
  const anim = !reduced && tl && tl.K.length > 1;
  const miss = BM.filter(([k]) => !tl || !tl.K.some((x) => x.m === k)).map(([, l]) => l);
  const cap = tl && tl.K.length === 3 ? CAPTION3
    : `Chuyển động nội suy giữa ${tl ? tl.K.length : 0} khoảnh khắc thật (${tl ? tl.K.map((k) => k.label.toLowerCase()).join(' · ') : ''}) — không phải quỹ đạo thật từng bước`;
  const z = r.der && ZKEYS.includes(String(r.der.attack_from)) ? String(r.der.attack_from) : null;
  const sec = rallyStart(r);
  const url = M.vid && isNum(sec) ? `https://www.youtube.com/watch?v=${M.vid}&t=${Math.max(0, Math.floor(sec) - 2)}s` : '';
  const bp = tl && tl.ball ? ballPath(tl.ball) : null;
  const ticks = anim ? tl.K.map((k) => `<span style="--p:${f3(k.at / tl.T)}" data-tick="${k.m}">${esc(k.label)}</span>`).join('') : '';
  const zBox = z ? zoneRect(z, r.receiving === M.focus) : null;
  return `<div class="sr-dlg-in">
    <header class="sr-dlg-hd"><div><div class="sr-lab">Pha thật · ${esc(vnDay(match.date) || 'trận đã quay')} · set ${esc(r.set)}</div>
      <h3 id="sr-bd-title">${esc(scoreText(M, r))} <small>trước pha này</small></h3></div>
      <button type="button" class="sr-x" data-close aria-label="Đóng">×</button></header>
    <div class="sr-dlg-body">
      <div class="sr-dlg-board">
        <svg class="sr-bd-big" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="Sa bàn pha set ${esc(r.set)}">
          ${courtBase(M, r, false)}
          ${zBox ? `<rect class="bd-zone" data-zone x="${zBox[0]}" y="${zBox[1]}" width="${zBox[2]}" height="${zBox[3]}" rx=".35"/>` : ''}
          <g data-dots></g>
          ${bp ? `<g class="bd-ball" data-ball data-testid="sr-ball"><title>đường bóng suy ra</title><path d="${bp.d}"/></g>` : ''}
        </svg>
        ${anim ? `<p class="sr-cap" data-testid="sr-cap">${esc(cap)}</p>` : ''}
      </div>
      <div class="sr-dlg-side">
        ${momentSwitch(m, 'data-dm')}
        ${anim ? `<div class="sr-anim" data-testid="sr-anim"><button type="button" class="sr-play" data-play aria-pressed="false">Chạy lại pha</button>
          <div class="sr-seg sr-speed" role="group" aria-label="Tốc độ"><button type="button" data-speed="0.5" aria-pressed="false">0,5×</button><button type="button" data-speed="1" aria-pressed="true">1×</button></div></div>
          <div class="sr-scrub"><input type="range" min="0" max="1000" step="1" value="0" data-scrub aria-label="Tua pha"><div class="sr-ticks">${ticks}</div></div>`
    : (tl && tl.K.length > 1 ? `<div class="sr-static3" data-testid="sr-static3">${tl.K.map((k) => `<figure>${boardSvg(M, r, k.m)}<figcaption>${esc(k.label)}</figcaption></figure>`).join('')}</div>
          <p class="sr-fine">Máy đang bật giảm chuyển động nên hiện các khoảnh khắc đứng yên.</p>`
      : '<p class="sr-fine">Pha này chỉ có 1 khoảnh khắc nên không chạy lại được.</p>')}
        <ul class="sr-legend"><li><i style="background:${TEAM_COLOR.focus}"></i>${esc(M.name(M.focus))}</li><li><i style="background:${TEAM_COLOR.home}"></i>${esc(M.name(M.home))}</li>
          <li><i class="lg-a"></i>Người đập</li><li><i class="lg-s"></i>Chuyền hai</li>${bp ? '<li data-testid="sr-ball-legend"><i class="lg-b"></i>Đường bóng suy ra (chuyền → đập, máy không bám bóng)</li>' : ''}${z ? '<li><i class="lg-z"></i>Vùng máy đọc là chỗ đập</li>' : ''}</ul>
        <dl class="sr-info">
          <div><dt>Giao bóng</dt><dd>${esc(M.name(r.serving))} phát, ${esc(M.name(r.receiving))} đỡ</dd></div>
          <div><dt>Máy đọc chỗ đập</dt><dd>${z ? `${esc(ZNAME[z])} (${z === 'back' ? 'hàng sau' : 'hàng trên'})` : 'Không đọc được'}</dd></div>
          <div><dt>Khoảnh khắc có</dt><dd>${tl ? esc(tl.K.map((k) => k.label).join(' · ')) : 'Không có'}${miss.length ? ` <small>(thiếu ${esc(miss.join(', '))})</small>` : ''}</dd></div>
          <div><dt>Mốc thời gian</dt><dd>${r.timing === 'máy' ? 'Máy tự tìm từ video' : 'Lấy từ nhãn AI; vị trí người do máy đo'}</dd></div>
        </dl>
        ${url ? `<a class="sr-btn" data-evidence data-testid="sr-yt" href="${esc(url)}" target="_blank" rel="noopener">Xem pha trên YouTube · ${esc(vnMmss(Math.max(0, Math.floor(sec) - 2)))}</a>` : ''}
      </div>
    </div></div>`;
}

function openBoard(host, M, id, m) {
  const r = M.byId[id];
  if (!r) return null;
  const tl = rallyTimeline(r, M.focus, M.home);
  const reduced = reducedMotion();
  const dlg = document.createElement('dialog');
  dlg.className = 'sr-dlg';
  dlg.setAttribute('data-testid', 'sr-bd');
  dlg.setAttribute('aria-labelledby', 'sr-bd-title');
  dlg.innerHTML = dialogHtml(M, r, tl, m, reduced);
  host.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  const dots = $('[data-dots]'), zone = $('[data-zone]'), ball = $('[data-ball]'), scrub = $('[data-scrub]'), play = $('[data-play]');
  const K = tl ? tl.K : [];
  const keyAt = (k) => { const x = K.find((q) => q.m === k); return x ? x.at : null; };
  const st = { t: 0, playing: false, speed: 1, raf: 0, last: 0, hold: 0 };
  const near = () => K.reduce((b, k) => (Math.abs(k.at - st.t) < Math.abs(b.at - st.t) ? k : b), K[0] || { m: '', at: 0 });
  function draw() {
    const nk = near();
    if (dots) {
      if (tl) dots.innerHTML = dotsSvg(M, frameAt(tl, st.t), true);
      else dots.innerHTML = `<text x="4.5" y="4.6" class="bd-miss">Không có khoảnh khắc nào</text>`;
    }
    if (zone) zone.style.display = nk.m === 'attack' ? '' : 'none';
    if (ball && tl && tl.ball) ball.style.display = st.t > tl.ball.t0 + 1e-9 && st.t <= tl.ball.t1 + 1e-9 ? '' : 'none';
    if (scrub && tl && tl.T > 0) scrub.value = String(Math.round((st.t / tl.T) * 1000));
    dlg.querySelectorAll('[data-dm]').forEach((b) => {
      const at = keyAt(b.dataset.dm);
      b.disabled = at === null;
      b.setAttribute('aria-pressed', String(at !== null && b.dataset.dm === nk.m && !st.playing && Math.abs(at - st.t) < 1e-6));
    });
  }
  function tick(ts) {
    const dt = st.last ? Math.min(0.1, (ts - st.last) / 1000) : 0;
    st.last = ts;
    if (st.t >= tl.T) { st.hold += dt; if (st.hold >= 0.9) { st.t = 0; st.hold = 0; } } else st.t = Math.min(tl.T, st.t + dt * st.speed);
    draw();
    st.raf = requestAnimationFrame(tick);
  }
  function pause() {
    cancelAnimationFrame(st.raf); st.raf = 0; st.playing = false;
    if (play) { play.textContent = 'Chạy lại pha'; play.setAttribute('aria-pressed', 'false'); }
  }
  function start() {
    if (!tl || tl.T <= 0) return;
    if (st.t >= tl.T) st.t = 0;
    st.playing = true; st.last = 0; st.hold = 0;
    if (play) { play.textContent = 'Dừng'; play.setAttribute('aria-pressed', 'true'); }
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
  }
  const seek = (t) => { pause(); st.t = Math.min(tl ? tl.T : 0, Math.max(0, t)); draw(); };
  const k0 = keyAt(m);
  st.t = k0 !== null ? k0 : (tl ? tl.T : 0);
  draw();
  dlg.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('button');
    if (ev.target === dlg || (b && b.hasAttribute('data-close'))) { dlg.close(); return; }
    if (!b) return;
    if (b.hasAttribute('data-play')) { if (st.playing) pause(); else start(); }
    else if (b.dataset.dm) { const at = keyAt(b.dataset.dm); if (at !== null) seek(at); }
    else if (b.dataset.speed) {
      st.speed = Number(b.dataset.speed) === 0.5 ? 0.5 : 1;
      dlg.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
  });
  if (scrub && tl) scrub.addEventListener('input', () => seek((Number(scrub.value) / 1000) * tl.T));
  dlg.addEventListener('close', () => { pause(); dlg.remove(); });
  dlg.showModal();
  dlg.__bd = { tl, state: st, seek, start, pause };
  return dlg;
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
  // Sa bàn: file riêng, hỏng/thiếu thì khối sa bàn báo "chưa có", phần còn lại của báo cáo vẫn hiện.
  let boards = null;
  const burl = opts.boards === undefined ? 'data/scout/boards-xmls-7-4.json' : opts.boards;
  if (burl && /^data\/scout\/boards-[a-z0-9-]+\.json$/.test(burl)) {
    try { const r = await fetch(burl); if (r.ok) boards = await r.json(); } catch { boards = null; }
  }
  // Hồ sơ cầu thủ + ảnh đại diện: file riêng, thiếu thì thẻ vẫn hiện (chữ cái đầu tên, hồ sơ chỉ từ báo cáo).
  const teamKey = (/^data\/scout\/([a-z0-9-]+)\.json$/.exec(url) || [])[1] || '';
  let players = null;
  if (opts.players !== null) {
    try { const r = await fetch(opts.players || `data/scout/players-${teamKey}.json`); if (r.ok) players = await r.json(); } catch { players = null; }
  }
  const credits = await loadCredits(teamKey);
  await cssReady; // chờ css/player-panel.css để không lộ giao diện nửa vời
  const ex = { players, credits, teamKey, cf: { c: '', g: new Set(), m: '', p: '' }, sf: { k: '', t: new Set() }, open: new Set() };
  let model = null, moment = 'attack';
  const render = () => {
    try {
      el.innerHTML = renderScoutReport(data, opts.now || new Date(), boards, ex);
      model = boardModel(boards, data.team);
      moment = 'attack';
    } catch (e) {
      el.innerHTML = `<main class="sr-grid"><section class="sr-t sr-concl"><div class="sr-lab">Báo cáo bị lỗi dữ liệu</div><h1>Không hiển thị được báo cáo.</h1><p class="sr-note">${esc(e.message)}</p></section></main>`;
    }
  };
  render();
  // Thanh đáy cố định (≥701px) không được che khối cuối trang: chừa đúng chiều cao thật của thanh (chữ xuống 2 dòng vẫn đủ).
  const fitBar = () => { const b = el.querySelector('.sr-today'); if (b) el.style.setProperty('--sr-bar-h', Math.ceil(b.getBoundingClientRect().height) + 'px'); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fitBar) : null;
  const watchBar = () => { fitBar(); const b = el.querySelector('.sr-today'); if (ro && b) { ro.disconnect(); ro.observe(b); } };
  watchBar();
  // Panel bên cạnh: hồ sơ cầu thủ, clip, nguồn. Vẽ lại riêng khối clip/nguồn khi đổi bộ lọc (không vẽ lại cả báo cáo).
  const PL = () => thPlayers(data, players).all;
  const CM = () => clipModel(data, PL());
  const redraw = (sel, html) => { const old = el.querySelector(sel); if (old) old.outerHTML = html; };
  const openPlayer = (pid, opener) => {
    const list = PL();
    const i = list.findIndex((p) => p.pid === pid);
    if (i < 0) return null;
    return openPanel({ list, index: i, opener, kind: 'player', link: (p) => p.pid,
      render: (p) => thProfileHtml(p, data, { photo: photoFor(p, credits, teamKey), oldLineup: players && players.oldLineup }) });
  };
  function onPanelClick(ev) {
    const t = ev.target.closest ? ev.target : null;
    if (!t || t.closest('dialog')) return false;
    const card = t.closest('[data-pl]');
    if (card) { openPlayer(card.dataset.pl, card); return true; }
    const plain = !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button > 0);
    const clip = t.closest('a[data-clip]');
    if (clip && plain) {
      ev.preventDefault();
      const M = CM();
      const list = filterClips(M, ex.cf);
      const i = list.findIndex((x) => String(x.i) === clip.dataset.clip);
      if (i >= 0) openPanel({ list, index: i, opener: clip, kind: 'clip', render: clipPanelHtml });
      return true;
    }
    const sc = t.closest('a[data-srcid]');
    if (sc && plain) {
      ev.preventDefault();
      const S = sourceModel(data, CM());
      const list = filterSources(S, ex.sf);
      const i = list.findIndex((s) => String(s.i) === sc.dataset.srcid);
      if (i >= 0) openPanel({ list, index: i, opener: sc, kind: 'source', render: sourcePanelHtml });
      return true;
    }
    const b = t.closest('button');
    if (!b) return false;
    const d = b.dataset;
    const src = !!b.closest('[data-testid="sr-sources"]');
    if (d.cfC !== undefined) { ex.cf.c = d.cfC; ex.cf.g = new Set(); }
    else if (d.cfG !== undefined) { const g = Number(d.cfG); if (ex.cf.g.has(g)) ex.cf.g.delete(g); else ex.cf.g.add(g); }
    else if (b.hasAttribute('data-cf-clear')) ex.cf = { c: '', g: new Set(), m: '', p: '' };
    else if (d.sfK !== undefined) { ex.sf.k = d.sfK; ex.sf.t = new Set(); }
    else if (d.sfT !== undefined) { if (ex.sf.t.has(d.sfT)) ex.sf.t.delete(d.sfT); else ex.sf.t.add(d.sfT); }
    else if (d.rowMore !== undefined) ex.open.add(d.rowMore);
    else return false;
    redrawLib(src, b);
    return true;
  }
  // Vẽ lại riêng khối clip hoặc nguồn, rồi trả focus về nút vừa bấm (bàn phím không bị nhảy lên đầu trang).
  function redrawLib(src, b) {
    if (src) redraw('[data-testid="sr-sources"]', sourcesSection(data, sourceModel(data, CM()), ex.sf, ex.open));
    else redraw('[data-testid="sr-clips"]', clipsSection(CM(), ex.cf, ex.open));
    const a = b && [...b.attributes].find((x) => /^data-(cf|sf)-/.test(x.name));
    const nb = a && el.querySelector(`[${a.name}="${CSS.escape(a.value)}"]`);
    if (nb) nb.focus({ preventScroll: true });
  }
  function onLibChange(ev) {
    const s = ev.target;
    if (!s || s.tagName !== 'SELECT') return;
    if (s.hasAttribute('data-cf-m')) ex.cf.m = s.value;
    else if (s.hasAttribute('data-cf-p')) ex.cf.p = s.value;
    else return;
    redrawLib(false, s);
  }
  el.addEventListener('click', onPanelClick);
  el.addEventListener('change', onLibChange);
  // Nút phương án trong panel: bấm hộ nút cùng phương án trong báo cáo, để app/trang lưu phương án rồi mở bàn chiến thuật như thường.
  const onPanelPlan = (ev) => {
    const a = ev.target.closest && ev.target.closest('.pp-sk a[data-plan]');
    const twin = a && el.querySelector(`a[data-plan="${CSS.escape(a.dataset.plan)}"]`);
    if (!twin) return;
    ev.preventDefault();
    twin.click();
  };
  document.addEventListener('click', onPanelPlan);
  // Mở lại đúng hồ sơ từ đường dẫn (?pl=n97).
  try { const q = new URLSearchParams(location.search).get('pl'); if (q) openPlayer(q, null); } catch { /* bỏ qua */ }
  const byId = Object.fromEntries(arr(data.plans).filter((p) => p && p.plan).map((p) => [p.plan.id, p.plan]));
  async function onClick(ev) {
    const t = ev.target.closest ? ev.target : null;
    if (t && model && model.ok && !t.closest('dialog')) {
      const bm = t.closest('[data-bm]'), sn = t.closest('[data-snap]');
      if (bm && BM_LABEL[bm.dataset.bm]) {
        moment = bm.dataset.bm;
        const sec = el.querySelector('[data-testid="sr-boards"]');
        if (sec) {
          sec.dataset.moment = moment;
          sec.querySelectorAll('[data-bm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bm === moment)));
          for (const ob of model.obs) { const ul = sec.querySelector(`[data-obs-snaps="${ob.id}"]`); if (ul) ul.innerHTML = snapsHtml(model, ob, moment); }
        }
        return;
      }
      if (sn) { openBoard(el, model, sn.dataset.snap, moment); return; }
    }
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
  return {
    data, get boards() { return model; }, render() { render(); watchBar(); },
    openPlayer,
    destroy() { if (ro) ro.disconnect(); el.style.removeProperty('--sr-bar-h'); el.removeEventListener('click', onClick); el.removeEventListener('click', onPanelClick); el.removeEventListener('change', onLibChange); document.removeEventListener('click', onPanelPlan); closePanel(); el.querySelectorAll('dialog').forEach((d) => d.open && d.close()); el.innerHTML = ''; },
  };
}
