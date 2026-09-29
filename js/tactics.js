// Bàn chiến thuật + Tập trung VĐV (module độc lập, chưa nối vào app.js).
//
// ─── LƯỢC ĐỒ "PHƯƠNG ÁN" (Plan) ─────────────────────────────────────────────────────────────
// HLV lưu từ bàn chiến thuật; sau này AI (báo cáo scout đối thủ) cũng sinh ra đúng dạng này.
// Lưu ở localStorage khoá 'vbs.tactics.plans' (mảng Plan). Luôn đi qua normalizePlan() trước khi dùng.
//
// Hệ toạ độ: đơn vị MÉT, nhìn từ ghế HLV của ta (ta ở dưới, lưới ở giữa):
//   x: 0 = biên trái → 9 = biên phải (bên trái/phải của đội ta khi nhìn về lưới)
//   y: 0 = vạch cuối sân đối thủ, 9 = lưới, 18 = vạch cuối sân ta (tới 20.5 = chỗ đứng phát bóng)
//   Vạch tấn công: y = 6 (đối thủ) và y = 12 (ta).
//
// {
//   id:        string            // [A-Za-z0-9_-]{1,40}
//   name:      string            // "Đỡ phát khi Long An phát nhảy vào số 3"
//   phase:     'recv'|'serve'|'attack'|'defense'   // Đỡ phát bóng | Phát bóng | Tấn công | Phòng thủ/chắn
//   rotation:  1..6              // xoay vòng = vị trí chuyền hai (P1–P6), giống js/logic.js
//   positions: { [pid]: {x,y} }  // 6 người đang trên sân (kể cả libero nếu vào sân)
//   drawings:  Drawing[]         // xem dưới
//   notes:     { general: string, players: { [pid]: string } }   // dặn chung + dặn riêng từng VĐV
//   createdAt: ISO string
//   source:    'coach'|'ai'
//   // tuỳ chọn:
//   lineup:    [pid×6] | null    // ai đứng P1..P6 lúc bắt đầu pha (theo xoay vòng này)
//   libero:    pid | null        // libero đang vào sân thay phụ công hàng sau (null = không dùng)
//   opponents: [{x,y}] (≤6)      // vị trí đối thủ, y trong [0,9]; [] = không vẽ đối thủ
// }
// Drawing (step = bước mô phỏng, bắt đầu từ 1; nét cùng bước chạy cùng lúc):
//   { id, type:'arrow', step, pid|null, from:{x,y}, to:{x,y} }  // mũi tên chạy; có pid = VĐV đó chạy theo
//   { id, type:'ball',  step, from:{x,y}, to:{x,y} }            // đường bóng (nét đứt)
//   { id, type:'zone',  pid|null, x, y, w, h }                  // vùng trách nhiệm (hình chữ nhật)
//   { id, type:'text',  x, y, text }                            // ghi chú trên sân
// ──────────────────────────────────────────────────────────────────────────────────────────────

import { suggestLineup } from './logic.js';
import { loadTeam } from './store.js';

export const PHASES = [
  { k: 'recv', label: 'Đỡ phát bóng', hint: 'Đối thủ phát, ta đỡ bước 1' },
  { k: 'serve', label: 'Phát bóng', hint: 'Ta phát bóng' },
  { k: 'attack', label: 'Tấn công', hint: 'Bóng đã đỡ, chuyền hai lên bóng' },
  { k: 'defense', label: 'Phòng thủ / chắn', hint: 'Đối thủ tấn công, ta chắn và phòng thủ' },
];
const PHASE = Object.fromEntries(PHASES.map((p) => [p.k, p]));
export const ROLE_NAME = { S: 'Chuyền hai', OH: 'Chủ công', MB: 'Phụ công', OP: 'Đối chuyền', L: 'Libero' };
const ROLE_OF_INDEX = ['S', 'OH', 'MB', 'OP', 'OH', 'MB']; // hệ 5-1: chuyền hai P1, chủ công P2/P5, phụ công P3/P6, đối chuyền P4
const KEY = { plans: 'vbs.tactics.plans', draft: 'vbs.tactics.draft' };
const ZONE_NAME = { 1: 'cuối sân, bên phải', 2: 'trên lưới, bên phải', 3: 'giữa lưới', 4: 'trên lưới, bên trái', 5: 'cuối sân, bên trái', 6: 'giữa cuối sân' };

// Đội hình đỡ phát chuẩn 5-1 (3 người đỡ: libero + 2 chủ công), theo ô P1..P6, cho từng xoay vòng.
// Đã giữ đúng luật chồng vị trí (trước/sau, trái/phải) tại thời điểm đối thủ phát.
const RECV = {
  1: [[8.3, 15.8], [7.0, 14.6], [4.0, 10.3], [1.0, 10.3], [1.8, 15.0], [4.5, 15.2]],
  2: [[7.4, 15.2], [7.6, 9.9], [2.4, 14.4], [1.2, 10.1], [1.0, 16.2], [4.8, 15.2]],
  3: [[7.4, 15.1], [7.8, 10.1], [5.2, 9.9], [1.5, 14.4], [4.0, 15.3], [5.6, 12.4]],
  4: [[8.4, 16.4], [7.2, 14.4], [4.6, 10.0], [2.8, 9.8], [1.8, 15.0], [4.5, 15.2]],
  5: [[7.4, 15.2], [8.2, 10.4], [2.6, 14.6], [1.0, 10.2], [1.6, 11.4], [4.8, 15.2]],
  6: [[7.3, 15.0], [8.0, 10.2], [4.0, 10.2], [1.5, 14.4], [4.3, 15.4], [5.2, 11.0]],
};
const SERVE = [[7.8, 19.3], [7.4, 10.6], [4.5, 10.6], [1.6, 10.6], [1.6, 14.8], [4.5, 14.8]];
// Tấn công / phòng thủ: sau khi đổi chỗ, mỗi người về vị trí sở trường theo vai + hàng trên/dưới.
const ATTACK = { front: { S: [6.0, 9.8], OH: [0.5, 12.6], MB: [4.3, 12.0], OP: [8.6, 12.6] }, back: { S: [6.0, 9.8], OP: [7.8, 15.6], OH: [4.5, 15.8], MB: [1.8, 15.4] } };
const DEFENSE = { front: { OH: [1.2, 9.7], MB: [4.5, 9.7], S: [7.8, 9.7], OP: [7.8, 9.7] }, back: { MB: [1.3, 15.0], OH: [4.5, 16.8], S: [7.7, 15.0], OP: [7.7, 15.0] } };
const OPP_DEFAULT = [[7.5, 7.4], [4.5, 7.4], [1.5, 7.4], [1.5, 2.6], [4.5, 2.4], [7.5, 2.6]]; // ô 4,3,2 (lưới) · 1,6,5 (cuối) nhìn từ phía họ
const OPP_ZONE = [4, 3, 2, 1, 6, 5];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const dec1 = (v) => v.toFixed(1).replace('.', ',');

function lsGet(key, fb) {
  try { const v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); } catch { return fb; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

// ─── Lưu trữ phương án ─────────────────────────────────────────────────────────────────────
const pt = (p, ymin = -3, ymax = 21) => (p && fin(p.x) && fin(p.y) ? { x: r2(clamp(p.x, -1.5, 10.5)), y: r2(clamp(p.y, ymin, ymax)) } : null);

// Id thiếu/sai dạng (vd plan do AI sinh) → id cố định suy từ nội dung, để mở/xoá được qua nhiều lần đọc.
function stableId(p) {
  const raw = typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
  if (raw) return raw;
  const src = String(p.name || '') + '|' + String(p.createdAt || '') + '|' + String(p.phase || '') + '|' + String(p.rotation || '');
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36);
}
export function normalizePlan(p) {
  if (!p || typeof p !== 'object') return null;
  const positions = {};
  for (const [pid, v] of Object.entries(p.positions || {})) { const q = pt(v, 8.8, 21); if (q && Object.keys(positions).length < 6) positions[pid] = q; } // tối đa 6 người trên sân
  const drawings = (Array.isArray(p.drawings) ? p.drawings : []).map((d) => {
    if (!d || typeof d !== 'object') return null;
    const id = validId(d.id) ? d.id : uid();
    const step = Number.isInteger(d.step) && d.step > 0 ? Math.min(d.step, 20) : 1;
    if (d.type === 'arrow' || d.type === 'ball') {
      const from = pt(d.from), to = pt(d.to);
      if (!from || !to) return null;
      return d.type === 'arrow' ? { id, type: 'arrow', step, pid: typeof d.pid === 'string' ? d.pid : null, from, to } : { id, type: 'ball', step, from, to };
    }
    if (d.type === 'zone') {
      if (![d.x, d.y, d.w, d.h].every(fin) || d.w <= 0 || d.h <= 0) return null;
      const x = clamp(d.x, -1.5, 10.5), y = clamp(d.y, -3, 21);
      return { id, type: 'zone', pid: typeof d.pid === 'string' ? d.pid : null, x: r2(x), y: r2(y), w: r2(clamp(d.w, 0.1, 12)), h: r2(clamp(d.h, 0.1, 24)) };
    }
    if (d.type === 'text') {
      const q = pt(d);
      const text = String(d.text || '').trim().slice(0, 80);
      return q && text ? { id, type: 'text', ...q, text } : null;
    }
    return null;
  }).filter(Boolean);
  const n = typeof p.notes === 'string' ? { general: p.notes, players: {} } : p.notes || {};
  const players = {};
  for (const [pid, t] of Object.entries(n.players || {})) if (typeof t === 'string' && t.trim()) players[pid] = t.slice(0, 300);
  const rot = Number(p.rotation);
  return {
    id: validId(p.id) ? p.id : stableId(p),
    name: String(p.name || '').trim().slice(0, 120) || 'Phương án chưa đặt tên',
    phase: PHASE[p.phase] ? p.phase : 'recv',
    rotation: Number.isInteger(rot) && rot >= 1 && rot <= 6 ? rot : 1,
    positions,
    drawings,
    notes: { general: String(n.general || '').slice(0, 600), players },
    createdAt: typeof p.createdAt === 'string' && !Number.isNaN(Date.parse(p.createdAt)) ? p.createdAt : new Date().toISOString(),
    source: p.source === 'ai' ? 'ai' : 'coach',
    lineup: Array.isArray(p.lineup) && p.lineup.length === 6 && p.lineup.every((x) => typeof x === 'string') ? p.lineup.slice() : null,
    libero: typeof p.libero === 'string' ? p.libero : null,
    opponents: (Array.isArray(p.opponents) ? p.opponents : []).slice(0, 6).map((o) => pt(o, -2.5, 8.8)).filter(Boolean),
  };
}
export function loadPlans() {
  const v = lsGet(KEY.plans, []);
  return Array.isArray(v) ? v.map(normalizePlan).filter(Boolean) : [];
}
// Thêm mới hoặc ghi đè theo id. Trả về plan đã chuẩn hoá, hoặc null nếu trình duyệt chặn lưu.
export function savePlan(plan) {
  const p = normalizePlan(plan);
  if (!p) return null;
  const list = loadPlans().filter((x) => x.id !== p.id);
  list.unshift(p);
  return lsSet(KEY.plans, list) ? p : null;
}
export function deletePlan(id) {
  return lsSet(KEY.plans, loadPlans().filter((x) => x.id !== id));
}
// Phương án có sẵn đi kèm app (báo cáo đối thủ, data/scout/*.json): CHỈ ĐỌC, không ghi vào máy.
// Link chia sẻ #/tactics/<id> / tactics.html?plan=<id> mở được trên máy mới; sửa rồi Lưu = bản riêng (id mới).
export const BUILTIN_URL = 'data/scout/xmls-thanh-hoa.json';
export function builtinPlansOf(report) {
  const list = report && Array.isArray(report.plans) ? report.plans : [];
  return list.map((x) => x && x.plan && normalizePlan({ ...x.plan, source: 'ai' })).filter(Boolean);
}
export async function loadBuiltinPlans(url = BUILTIN_URL) {
  try { const r = await fetch(url); return r.ok ? builtinPlansOf(await r.json()) : []; } catch { return []; }
}

// ─── Đội + đội hình ────────────────────────────────────────────────────────────────────────
// Đội: localStorage (đội HLV đã sửa) → nếu chưa có thì danh sách LPBank đi kèm app.
export async function resolveTeam(url = 'data/roster-lpbank.json') {
  const t = loadTeam();
  if (t && t.players.length) return t;
  try {
    const r = await fetch(url);
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.players)) return { name: j.team || 'Đội nhà', players: j.players }; }
  } catch { /* offline, không có file → đội trống */ }
  return { name: 'Đội nhà', players: [] };
}

// Đội hình: opts.lineup (6 pid P1..P6) → đội hình xuất phát của trận đang mở → đề xuất 5-1 theo vị trí.
function resolveLineup(team, opts) {
  if (Array.isArray(opts.lineup) && opts.lineup.length === 6) return { lineup: opts.lineup.slice(), libero: opts.libero || null, extra: [] };
  try {
    const id = lsGet('vbs.current', null);
    const m = validId(id) ? lsGet('vbs.match.' + id, null) : null;
    const st = m && Array.isArray(m.events) ? [...m.events].reverse().find((e) => e && e.t === 'start') : null;
    if (st && Array.isArray(st.lineup) && st.lineup.length === 6 && st.lineup.every(Boolean)) return { lineup: st.lineup.slice(), libero: st.libero || null, extra: Array.isArray(m.players) ? m.players : [] };
  } catch { /* dữ liệu trận hỏng → dùng đề xuất */ }
  const sg = suggestLineup(team.players);
  return { lineup: sg.lineup, libero: sg.libero, extra: [] };
}

// Xoay vòng r (chuyền hai ở ô Pr): ô Pi = base[(i - (r-1)) mod 6] (xoay giống js/logic.js: người P2 lên P1).
export function slotsFor(base, r) {
  return base.map((_, i) => base[(i - (r - 1) + 12) % 6]);
}
export function zoneOf(p) {
  if (p.y > 18) return 0; // ngoài vạch cuối (chỗ phát bóng)
  const col = p.x < 3 ? 0 : p.x < 6 ? 1 : 2;
  return p.y < 12 ? [4, 3, 2][col] : [5, 6, 1][col];
}

// ─── Mount ─────────────────────────────────────────────────────────────────────────────────
// const tx = await mountTactics(el, { team?, lineup?, libero?, rosterUrl?, title? })
// → { loadPlan(planOrId), getBoard(), setPresent(bool), destroy() }
export async function mountTactics(el, opts = {}) {
  const team = opts.team || await resolveTeam(opts.rosterUrl);
  const BUILTIN = Array.isArray(opts.builtins) ? opts.builtins.map(normalizePlan).filter(Boolean) : await loadBuiltinPlans(opts.builtinUrl);
  const builtinOf = (id) => BUILTIN.find((x) => x.id === id) || null;
  const lu = resolveLineup(team, opts);
  const people = {};
  for (const p of [...lu.extra, ...team.players]) if (p && typeof p.id === 'string') people[p.id] ||= p;
  let ph = 0;
  const lineup = lu.lineup.map((pid) => pid || (people['_x' + ++ph] = { id: '_x' + ph, num: '?', name: '', pos: '' }).id);
  // Chuẩn hoá: xoay để chuyền hai về index 0 → vai theo index luôn đúng hệ 5-1.
  const si = lineup.findIndex((pid) => (people[pid] || {}).pos === 'S');
  const base = si > 0 ? slotsFor(lineup, 7 - si) : lineup.slice();
  const role = {};
  // Vai: ưu tiên vị trí thật đã khai của VĐV; chưa khai thì suy theo thứ tự đội hình 5-1.
  base.forEach((pid, i) => { const ps = (people[pid] || {}).pos; role[pid] = ['S', 'OH', 'MB', 'OP', 'L'].includes(ps) ? ps : ROLE_OF_INDEX[i]; });
  const liberoId = lu.libero && !base.includes(lu.libero) ? lu.libero : null;
  if (liberoId) role[liberoId] = 'L';

  const P = (pid) => people[pid] || { id: pid, num: '?', name: '', pos: '' };
  const short = (pid) => { const n = String(P(pid).name || '').trim().split(/\s+/).pop(); return n || ''; };
  const label = (pid) => `Số ${P(pid).num}${P(pid).name ? ' ' + P(pid).name : ''}`;

  function liberoOut(slots, phase) {
    for (const i of [4, 5, 0]) if (role[slots[i]] === 'MB' && !(phase === 'serve' && i === 0)) return slots[i];
    return null;
  }
  function defaults(phase, rot, useLib) {
    const slots = slotsFor(base, rot);
    const out = useLib && liberoId ? liberoOut(slots, phase) : null;
    const pos = {}, used = new Set();
    slots.forEach((pid, i) => {
      const front = i >= 1 && i <= 3;
      const rl = role[pid];
      let xy;
      if (phase === 'recv') xy = RECV[rot][i];
      else if (phase === 'serve') xy = SERVE[i];
      else xy = (phase === 'attack' ? ATTACK : DEFENSE)[front ? 'front' : 'back'][rl === 'L' ? 'MB' : rl];
      // đội hình không đúng 5-1 (hai người cùng vai cùng hàng) → người sau đứng theo ô xoay vòng
      if (!xy || used.has(String(xy))) xy = [[7.5, 15.5], [7.5, 10.8], [4.5, 10.8], [1.5, 10.8], [1.5, 15.5], [4.5, 15.5]][i];
      used.add(String(xy));
      pos[pid === out ? liberoId : pid] = { x: xy[0], y: xy[1] };
    });
    return { slots, pos, out };
  }
  function freshBoard(phase, rot, useLib) {
    const d = defaults(phase, rot, useLib);
    return {
      id: null, name: '', phase, rotation: rot, lineup: d.slots, libero: d.out ? liberoId : null,
      positions: d.pos, drawings: [], notes: { general: '', players: {} }, opponents: [], createdAt: null, source: 'coach',
    };
  }
  // Ô xoay vòng của từng người trên sân (libero mang ô của phụ công nó thay).
  function slotOf(b) {
    const s = {};
    b.lineup.forEach((pid, i) => { s[pid] = 'P' + (i + 1); });
    if (b.libero) { const out = b.lineup.find((pid) => !b.positions[pid]); if (out) s[b.libero] = s[out]; }
    return s;
  }
  function sample() {
    const b = freshBoard('recv', 1, true);
    const at = (rl, row) => b.lineup.find((pid, i) => role[pid] === rl && (row == null || (i >= 1 && i <= 3) === row));
    const S = at('S'), MB = at('MB', true), OP = at('OP', true), rec = b.libero || at('MB', false);
    const pos = (pid) => b.positions[pid];
    b.name = 'Mẫu · Đỡ phát xoay vòng P1, chuyền hai chạy lên lưới';
    b.id = 'sample-recv-p1';
    b.opponents = OPP_DEFAULT.map(([x, y]) => ({ x, y }));
    b.drawings = [
      { id: 's1', type: 'ball', step: 1, from: { x: 1.5, y: -1.2 }, to: { ...pos(rec) } },
      { id: 's2', type: 'arrow', step: 1, pid: S, from: { ...pos(S) }, to: { x: 6.0, y: 9.8 } },
      { id: 's3', type: 'ball', step: 2, from: { ...pos(rec) }, to: { x: 6.0, y: 9.6 } },
      { id: 's4', type: 'arrow', step: 2, pid: MB, from: { ...pos(MB) }, to: { x: 4.3, y: 12.0 } },
      { id: 's5', type: 'arrow', step: 2, pid: OP, from: { ...pos(OP) }, to: { x: 0.5, y: 12.6 } },
      { id: 's6', type: 'ball', step: 3, from: { x: 6.0, y: 9.6 }, to: { x: 0.8, y: 9.6 } },
      { id: 's7', type: 'arrow', step: 3, pid: OP, from: { x: 0.5, y: 12.6 }, to: { x: 1.0, y: 9.9 } },
      { id: 's8', type: 'zone', pid: rec, x: 3.0, y: 13.4, w: 3.1, h: 3.6 },
      { id: 's9', type: 'text', x: 4.5, y: 17.4, text: 'Libero đỡ giữa, gọi bóng to' },
    ];
    b.notes = { general: 'Đỡ cao về giữa lưới lệch phải. Chuyền hai chờ bóng qua lưới mới chạy.', players: { [rec]: 'Đỡ vùng giữa, bóng giữa hai người thì libero nhận.' } };
    b.createdAt = '2026-09-26T00:00:00.000Z';
    return normalizePlan(b);
  }

  // ─── Trạng thái ──────────────────────────────────────────────────────────────────────────
  let board = null;
  const draft = lsGet(KEY.draft, null);
  const nb = draft && draft.board ? normalizePlan(draft.board) : null;
  if (nb && nb.lineup && nb.lineup.every((pid) => base.includes(pid))) { // nháp của đội khác → bỏ
    if (!validId(draft.board.id)) nb.id = null;
    if (!String(draft.board.name || '').trim()) nb.name = '';
    board = nb;
  } else board = freshBoard('recv', 1, true);
  const ui = {
    mode: 'move', tool: 'arrow', drawStep: 1, view: draft && draft.view === 'full' ? 'full' : 'half',
    libOn: true, focus: [], sim: 0, anim: null, present: false, text: null, drag: null, undo: [], redo: [], msg: '', delArm: null, more: false,
  };
  if (liberoOut(board.lineup, board.phase)) ui.libOn = !!board.libero;
  let raf = 0, saveT = 0, animRaf = 0;

  el.classList.add('tx');
  el.innerHTML = `
  <header class="tx-top">
    <div class="tx-title"><span class="tx-dot" aria-hidden="true"></span><div><h1>Bàn chiến thuật</h1><p class="tx-sub" data-ref="sub"></p></div></div>
    <button class="tx-btn tx-dark" data-act="present" data-testid="tx-present">Trình chiếu cho đội</button>
    <button class="tx-btn tx-dark tx-exit" data-act="present-exit" data-testid="tx-present-exit">Thoát trình chiếu</button>
  </header>
  <div class="tx-grid">
    <section class="tx-tile tx-board">
      <div class="tx-edit" data-ref="controls"></div>
      <div class="tx-textbar" data-ref="textbar" hidden>
        <input type="text" maxlength="80" placeholder="Viết ghi chú ngắn, vd: Bóng giữa hai người thì số 3 nhận" data-ref="textin" data-testid="tx-text-input">
        <button class="tx-btn tx-dark" data-act="text-ok">Thêm</button><button class="tx-btn" data-act="text-cancel">Huỷ</button>
      </div>
      <div class="tx-courtwrap"><svg class="tx-court" data-ref="svg" data-testid="tx-court" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sân bóng chuyền"></svg></div>
      <div class="tx-sim" data-ref="sim"></div>
      <div class="tx-edit" data-ref="tools"></div>
    </section>
    <aside class="tx-side">
      <section class="tx-tile tx-focus" data-ref="focus" data-testid="tx-focus"></section>
      <section class="tx-tile tx-edit" data-ref="plans" data-testid="tx-plans"></section>
    </aside>
  </div>
  <p class="tx-msg" data-ref="msg" role="status" aria-live="polite"></p>`;
  const ref = Object.fromEntries([...el.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const svg = ref.svg;

  // ─── Lịch sử (hoàn tác / làm lại) + nháp ─────────────────────────────────────────────────
  function snap() { ui.undo.push(JSON.stringify(board)); if (ui.undo.length > 80) ui.undo.shift(); ui.redo = []; }
  function persistDraft() {
    clearTimeout(saveT);
    saveT = setTimeout(() => lsSet(KEY.draft, { board, view: ui.view }), 250);
  }
  function commit(fn) { snap(); fn(); stopSim(); persistDraft(); render(); }
  function say(t) { ui.msg = t; ref.msg.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { ref.msg.textContent = ''; }, 3500); }

  // ─── Mô phỏng: vị trí sau bước k ─────────────────────────────────────────────────────────
  const moves = () => board.drawings.filter((d) => d.type === 'arrow' || d.type === 'ball');
  const stepCount = () => moves().reduce((m, d) => Math.max(m, d.step), 0);
  function posAt(k) {
    const pos = clone(board.positions);
    const arrows = board.drawings.filter((d) => d.type === 'arrow' && d.pid && pos[d.pid] && d.step <= k).sort((a, b) => a.step - b.step);
    for (const a of arrows) pos[a.pid] = { ...a.to };
    return pos;
  }
  // Điểm đầu thật của mũi tên gắn VĐV = chỗ người đó đứng lúc bắt đầu bước (kéo người thì mũi tên theo).
  function arrowFrom(d) {
    if (d.type !== 'arrow' || !d.pid || !board.positions[d.pid]) return d.from;
    const same = board.drawings.filter((x) => x.type === 'arrow' && x.pid === d.pid && x.step === d.step);
    const i = same.indexOf(d);
    return i > 0 ? same[i - 1].to : posAt(d.step - 1)[d.pid];
  }
  function stopSim() { cancelAnimationFrame(animRaf); ui.anim = null; ui.sim = 0; }
  function goStep(k, animate = true) {
    const n = stepCount();
    k = clamp(k, 0, n);
    cancelAnimationFrame(animRaf);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || k !== ui.sim + 1 || reduce) { ui.anim = null; ui.sim = k; render(); return Promise.resolve(); }
    const start = posAt(ui.sim);
    const paths = {};
    for (const pid of Object.keys(start)) {
      const segs = board.drawings.filter((d) => d.type === 'arrow' && d.pid === pid && d.step === k);
      if (segs.length) paths[pid] = [start[pid], ...segs.map((s) => s.to)];
    }
    const balls = board.drawings.filter((d) => d.type === 'ball' && d.step === k);
    const t0 = performance.now(), dur = 1100;
    return new Promise((done) => {
      const frame = (now) => {
        const t = clamp((now - t0) / dur, 0, 1); // khung đầu có thể mang mốc thời gian trước t0
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const pos = { ...start };
        for (const [pid, pts] of Object.entries(paths)) pos[pid] = along(pts, e);
        let ball = null;
        if (balls.length) { const seg = Math.min(balls.length - 1, Math.floor(t * balls.length)); const lt = t * balls.length - seg; ball = along([balls[seg].from, balls[seg].to], Math.min(1, lt)); }
        ui.anim = { k, pos, ball };
        drawSvg();
        if (t < 1) animRaf = requestAnimationFrame(frame);
        else { ui.anim = null; ui.sim = k; render(); done(); }
      };
      animRaf = requestAnimationFrame(frame);
    });
  }
  function along(pts, t) {
    const lens = pts.slice(1).map((p, i) => dist(pts[i], p));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let d = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) { const f = lens[i] ? Math.min(1, d / lens[i]) : 1; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; }
      d -= lens[i];
    }
    return pts[pts.length - 1];
  }
  async function playAll() {
    const n = stepCount();
    if (!n) return;
    if (ui.sim >= n) { ui.sim = 0; render(); }
    const tok = (playAll.tok = (playAll.tok || 0) + 1);
    while (ui.sim < n) {
      const want = ui.sim + 1;
      await goStep(want);
      if (!el.isConnected || tok !== playAll.tok || ui.sim !== want) return; // người dùng bấm việc khác giữa chừng
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // ─── Vẽ sân ──────────────────────────────────────────────────────────────────────────────
  const COLORS = { S: '#6A55D8', OH: '#2F6FD1', MB: '#2E8B57', OP: '#D9653B', L: '#1D1B20' };
  function viewBox() { return ui.view === 'full' ? [-1.4, -2.6, 11.8, 23.2] : [-1.4, 7.6, 11.8, 13.2]; }
  function arrowSvg(d, from, cls) {
    const to = d.to;
    const len = dist(from, to) || 1;
    const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len;
    const tip = { x: to.x, y: to.y }, bx = to.x - ux * 0.5, by = to.y - uy * 0.5;
    const head = `${tip.x},${tip.y} ${bx - uy * 0.26},${by + ux * 0.26} ${bx + uy * 0.26},${by - ux * 0.26}`;
    const color = d.type === 'ball' ? '#D9653B' : '#1D1B20';
    const line = `<line x1="${from.x}" y1="${from.y}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${d.type === 'ball' ? 0.1 : 0.13}" ${d.type === 'ball' ? 'stroke-dasharray=".32 .22"' : ''} stroke-linecap="round"/>`;
    const badge = stepCount() > 1 ? `<g class="tx-stepb"><circle cx="${(from.x + to.x) / 2}" cy="${(from.y + to.y) / 2}" r=".3" fill="#fff" stroke="${color}" stroke-width=".05"/><text x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 + 0.12}" font-size=".34" text-anchor="middle" fill="${color}" font-weight="700">${d.step}</text></g>` : '';
    return `<g class="tx-draw ${cls}" data-did="${esc(d.id)}" data-type="${d.type}" data-step="${d.step}"${d.pid ? ` data-for="${esc(d.pid)}"` : ''}>${line}<polygon points="${head}" fill="${color}"/>${d.type === 'ball' ? `<circle cx="${from.x}" cy="${from.y}" r=".17" fill="#fff" stroke="${color}" stroke-width=".06"/>` : ''}${badge}</g>`;
  }
  function wrap(t, n) {
    const out = [];
    for (const w of String(t).split(/\s+/)) {
      if (out.length && (out[out.length - 1] + ' ' + w).length <= n) out[out.length - 1] += ' ' + w;
      else out.push(w.length > n ? w.slice(0, n - 1) + '…' : w);
    }
    return out.slice(0, 4);
  }
  function drawSvg() {
    const [vx, vy, vw, vh] = viewBox();
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    const full = ui.view === 'full';
    const pos = ui.anim ? ui.anim.pos : posAt(ui.sim);
    const k = ui.anim ? ui.anim.k : ui.sim;
    const foc = new Set(ui.focus.filter((pid) => pos[pid]));
    const slots = slotOf(board);
    const o = [];
    o.push(`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#EAE5DC"/>`);
    if (full) o.push('<rect x="0" y="0" width="9" height="9" fill="#EDE9E2"/>');
    o.push('<rect x="0" y="9" width="9" height="9" fill="#F7EBDD"/>');
    o.push(`<g stroke="#fff" stroke-width=".08" fill="none"><rect x="${full ? 0 : 0}" y="${full ? 0 : 9}" width="9" height="${full ? 18 : 9}"/><line x1="0" y1="12" x2="9" y2="12"/>${full ? '<line x1="0" y1="6" x2="9" y2="6"/>' : ''}</g>`);
    // vùng 1–6 (chữ mờ) giúp HLV nói "vùng 5"
    if (!ui.present) for (const [z, x, y] of [[4, 1.5, 10.5], [3, 4.5, 10.5], [2, 7.5, 10.5], [5, 1.5, 15], [6, 4.5, 15], [1, 7.5, 15]]) o.push(`<text x="${x}" y="${y + 0.3}" font-size="1.1" text-anchor="middle" fill="#E3D3C0" font-weight="700">${z}</text>`);
    o.push('<line x1="-0.5" y1="9" x2="9.5" y2="9" stroke="#1D1B20" stroke-width=".16"/><circle cx="-0.5" cy="9" r=".16" fill="#1D1B20"/><circle cx="9.5" cy="9" r=".16" fill="#1D1B20"/>');
    o.push(`<text x="9.35" y="8.7" font-size=".38" text-anchor="end" fill="#6F6A75">Lưới</text>`);
    // vùng trách nhiệm
    for (const d of board.drawings.filter((x) => x.type === 'zone')) {
      const hi = d.pid && foc.has(d.pid);
      const dim = foc.size && !hi;
      o.push(`<rect class="tx-draw" data-did="${esc(d.id)}" data-type="zone"${d.pid ? ` data-for="${esc(d.pid)}"` : ''} x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx=".45" fill="rgba(106,85,216,${hi ? 0.28 : 0.13})" stroke="#6A55D8" stroke-width=".06" stroke-dasharray=".25 .18" opacity="${dim ? 0.35 : 1}"/>`);
    }
    // vùng tự suy cho người đang được tập trung (khi chưa vẽ vùng riêng)
    for (const pid of foc) {
      if (board.drawings.some((d) => d.type === 'zone' && d.pid === pid)) continue;
      o.push(`<circle class="tx-autozone" cx="${pos[pid].x}" cy="${pos[pid].y}" r="1.7" fill="rgba(106,85,216,.16)" stroke="#6A55D8" stroke-width=".05" stroke-dasharray=".25 .18"/>`);
    }
    // phối hợp: nối những người đang chọn
    const fl = [...foc];
    for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
      const a = pos[fl[i]], b = pos[fl[j]];
      o.push(`<g class="tx-link"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#6A55D8" stroke-width=".07" stroke-dasharray=".2 .15"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 0.15}" font-size=".38" text-anchor="middle" fill="#6A55D8" font-weight="700" class="tx-halo">${dec1(dist(a, b))} m</text></g>`);
    }
    // mũi tên + đường bóng
    for (const d of moves()) {
      if (k > 0 && d.step > k) continue;
      const cls = [k > 0 && d.step < k ? 'is-done' : '', foc.size && d.pid && !foc.has(d.pid) ? 'is-dim' : '', foc.size && d.pid && foc.has(d.pid) ? 'is-hi' : ''].join(' ');
      o.push(arrowSvg(d, arrowFrom(d), cls));
    }
    for (const d of board.drawings.filter((x) => x.type === 'text')) {
      const lines = wrap(d.text, 24);
      const hw = Math.max(...lines.map((l) => l.length)) * 0.125 + 0.2; // nửa bề rộng ước tính (mét)
      const x = r2(clamp(d.x, vx + hw, vx + vw - hw));
      o.push(`<text class="tx-draw tx-note tx-halo" data-did="${esc(d.id)}" data-type="text" x="${x}" y="${d.y}" font-size=".46" text-anchor="middle" fill="#1D1B20" font-weight="600">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? 0.55 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
    }
    // bản xem trước khi đang vẽ
    const dr = ui.drag;
    if (dr && dr.kind === 'draw' && dr.moved) {
      if (dr.tool === 'zone') { const z = rectOf(dr.start, dr.cur); o.push(`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx=".45" fill="rgba(106,85,216,.13)" stroke="#6A55D8" stroke-width=".06" stroke-dasharray=".25 .18"/>`); }
      else if (dr.tool !== 'text') o.push(arrowSvg({ id: 'preview', type: dr.tool, step: ui.drawStep, to: dr.cur }, dr.from, 'is-preview'));
    }
    // đối thủ
    if (full) board.opponents.forEach((p, i) => {
      o.push(`<g class="tx-opp" data-opp="${i}" transform="translate(${p.x} ${p.y})" data-testid="tx-opp-${i}"><circle r=".5" fill="#fff" stroke="#8F8A95" stroke-width=".07"/><text y=".17" font-size=".44" text-anchor="middle" fill="#6F6A75" font-weight="700">${OPP_ZONE[i] || ''}</text></g>`);
    });
    // cầu thủ ta
    const serverPid = board.phase === 'serve' ? board.lineup[0] : null;
    for (const [pid, p] of Object.entries(pos)) {
      const rl = role[pid] || 'OH';
      const dim = foc.size && !foc.has(pid);
      const pp = P(pid);
      o.push(`<g class="tx-pl${foc.has(pid) ? ' is-focus' : ''}${ui.drag && ui.drag.id === pid && ui.drag.moved ? ' is-drag' : ''}" data-pid="${esc(pid)}" data-slot="${slots[pid] || ''}" data-role="${rl}" data-x="${r2(p.x)}" data-y="${r2(p.y)}"${rl === 'L' ? ' data-libero="1"' : ''} data-testid="tx-pl-${esc(pp.num)}" transform="translate(${r2(p.x)} ${r2(p.y)})" opacity="${dim ? 0.35 : 1}" role="button" aria-label="${esc(label(pid))}, ${ROLE_NAME[rl]}">`
        + `<circle r="1.1" fill="transparent"/>`
        + (foc.has(pid) ? '<circle r=".82" fill="none" stroke="#6A55D8" stroke-width=".14"/>' : '')
        + `<circle r=".6" fill="${COLORS[rl]}" stroke="#fff" stroke-width=".09"/>`
        + `<text y=".19" font-size=".54" text-anchor="middle" fill="#fff" font-weight="700">${esc(pp.num)}</text>`
        + `<text y="1.05" font-size=".4" text-anchor="middle" fill="#1D1B20" font-weight="600" class="tx-halo">${esc(short(pid))}</text>`
        + (pid === serverPid ? '<g transform="translate(.62 -.5)"><circle r=".24" fill="#fff" stroke="#D9653B" stroke-width=".07"/><path d="M-.2 0h.4M0 -.2v.4" stroke="#D9653B" stroke-width=".05"/></g>' : '')
        + '</g>');
    }
    if (ui.anim && ui.anim.ball) o.push(`<circle class="tx-ball" data-testid="tx-ball" cx="${ui.anim.ball.x}" cy="${ui.anim.ball.y}" r=".26" fill="#FFD84D" stroke="#D9653B" stroke-width=".07"/>`);
    svg.innerHTML = o.join('');
  }

  // ─── Bảng điều khiển ──────────────────────────────────────────────────────────────────────
  const pill = (act, on, text, extra = '') => `<button class="tx-pill${on ? ' is-on' : ''}" data-act="${act}" aria-pressed="${on}" ${extra}>${text}</button>`;
  function renderControls() {
    ref.sub.textContent = `${team.name || 'Đội nhà'} · ${PHASE[board.phase].label} · Xoay vòng P${board.rotation}${board.name ? ' · ' + board.name : ''}`;
    ref.controls.innerHTML = `
      <div class="tx-phases" role="group" aria-label="Pha bóng">${PHASES.map((p) => pill('phase:' + p.k, board.phase === p.k, esc(p.label), `data-testid="tx-phase-${p.k}"`)).join('')}</div>
      <div class="tx-row">
        <div class="tx-rots" role="group" aria-label="Xoay vòng — vị trí chuyền hai"><span class="tx-lab">Xoay vòng</span>${[1, 2, 3, 4, 5, 6].map((r) => pill('rot:' + r, board.rotation === r, 'P' + r, `data-testid="tx-rot-${r}"`)).join('')}</div>
        <button class="tx-pill tx-morebtn${ui.more ? ' is-open' : ''}" data-act="more" aria-expanded="${ui.more}" aria-controls="tx-more-panel" data-testid="tx-more">Thêm<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg></button>
      </div>
      <p class="tx-hint">${esc(PHASE[board.phase].hint)}. Xoay vòng P${board.rotation} = chuyền hai đứng ở vị trí ${board.rotation} lúc bắt đầu.</p>
      <div class="tx-more" id="tx-more-panel" data-testid="tx-more-panel" ${ui.more ? '' : 'hidden'}>
        <div class="tx-lab">Hiển thị trên sân</div>
        <div class="tx-toggles">
          ${liberoId ? pill('lib', ui.libOn, 'Libero vào sân', 'data-testid="tx-libero"') : ''}
          ${pill('view', ui.view === 'full', ui.view === 'full' ? 'Cả sân' : 'Nửa sân', 'data-testid="tx-view"')}
          ${pill('opp', board.opponents.length > 0, 'Hiện đối thủ', 'data-testid="tx-opp"')}
        </div>
        <div class="tx-lab">Sửa bảng</div>
        <div class="tx-hist">
          <button class="tx-btn" data-act="redo" data-testid="tx-redo" ${ui.redo.length ? '' : 'disabled'}>Làm lại</button>
          <button class="tx-btn" data-act="clear" data-testid="tx-clear" ${board.drawings.length ? '' : 'disabled'}>Xoá nét vẽ</button>
          <button class="tx-btn" data-act="reset" data-testid="tx-reset">Về đội hình chuẩn</button>
        </div>
        <div class="tx-legend">${['S', 'OH', 'MB', 'OP', 'L'].filter((r) => r !== 'L' || liberoId).map((r) => `<span><i style="background:${COLORS[r]}"></i>${ROLE_NAME[r]}</span>`).join('')}<span><i class="tx-lg-arrow"></i>Đường chạy</span><span><i class="tx-lg-ball"></i>Đường bóng</span></div>
      </div>`;
    const n = stepCount();
    ref.sim.innerHTML = n ? `
      <button class="tx-btn" data-act="sim-prev" data-testid="tx-sim-prev" ${ui.sim <= 0 ? 'disabled' : ''} aria-label="Bước trước">‹ Bước trước</button>
      <span class="tx-simlab" data-testid="tx-sim-step">${ui.sim === 0 ? 'Vị trí ban đầu' : `Bước ${ui.sim}/${n}`}</span>
      <button class="tx-btn" data-act="sim-next" data-testid="tx-sim-next" ${ui.sim >= n ? 'disabled' : ''} aria-label="Bước sau">Bước sau ›</button>
      <button class="tx-btn tx-dark" data-act="sim-play" data-testid="tx-sim-play">${ui.sim >= n ? 'Chạy lại' : 'Chạy hết'}</button>`
      : '<span class="tx-simlab tx-muted">Vẽ mũi tên chạy hoặc đường bóng để xem mô phỏng từng bước.</span>';
    const draw = ui.mode === 'draw';
    const tools = [['arrow', 'Mũi tên chạy'], ['ball', 'Đường bóng'], ['zone', 'Vùng phụ trách'], ['text', 'Ghi chú chữ']];
    ref.tools.innerHTML = `
      <div class="tx-row">
        <div class="tx-seg" role="group" aria-label="Chế độ">${pill('mode:move', !draw, 'Xếp người', 'data-testid="tx-mode-move"')}${pill('mode:draw', draw, 'Vẽ', 'data-testid="tx-mode-draw"')}</div>
        <div class="tx-hist">
          <button class="tx-btn" data-act="undo" data-testid="tx-undo" ${ui.undo.length ? '' : 'disabled'}>Hoàn tác</button>
        </div>
      </div>
      ${draw ? `<div class="tx-row">
        <div class="tx-tools" role="group" aria-label="Công cụ vẽ">${tools.map(([k, t]) => pill('tool:' + k, ui.tool === k, t, `data-testid="tx-tool-${k}"`)).join('')}</div>
        <div class="tx-stepper"><span class="tx-lab">Nét mới thuộc</span><button class="tx-btn tx-sq" data-act="dstep-" aria-label="Bớt bước">−</button><b data-testid="tx-draw-step">Bước ${ui.drawStep}</b><button class="tx-btn tx-sq" data-act="dstep+" aria-label="Thêm bước">+</button></div>
      </div>
      <p class="tx-hint">${ui.tool === 'text' ? 'Chạm lên sân chỗ muốn đặt ghi chú.' : ui.tool === 'zone' ? 'Kéo trên sân để khoanh vùng. Vùng chứa một cầu thủ sẽ thành vùng phụ trách của người đó.' : 'Kéo từ một cầu thủ để vẽ đường chạy của người đó (dùng khi mô phỏng). Các nét cùng bước chạy cùng lúc.'}</p>`
      : '<p class="tx-hint">Kéo cầu thủ để chỉnh chỗ đứng. Chạm một người để xem ở đâu, khi nào, làm gì; chạm thêm người để xem phối hợp; chạm chỗ trống để bỏ chọn.</p>'}`;
  }

  function stepsOf(pid) {
    return board.drawings.filter((d) => d.type === 'arrow' && d.pid === pid).sort((a, b) => a.step - b.step)
      .map((d) => `Bước ${d.step}: chạy tới vùng ${zoneOf(d.to) || 'phát bóng'}${zoneOf(d.to) ? ` (${ZONE_NAME[zoneOf(d.to)]})` : ''}`);
  }
  function defaultHow(pid) {
    const rl = role[pid] || 'OH', slot = slotOf(board)[pid], front = ['P2', 'P3', 'P4'].includes(slot);
    const ph = board.phase;
    if (ph === 'recv') {
      if (rl === 'S') return 'Không đỡ phát. Chờ bóng qua lưới rồi chạy lên chỗ chuyền hai (giữa lưới, lệch phải).';
      if (rl === 'L' || rl === 'OH' || (rl === 'MB' && !front)) return 'Đỡ phát bóng, đưa bóng cao về chỗ chuyền hai. Bóng giữa hai người thì gọi to.';
      if (rl === 'MB') return 'Không đỡ phát. Đứng sát lưới, chuẩn bị chạy đà đánh nhanh giữa lưới.';
      return 'Đứng tránh đường bóng phát, chuẩn bị chạy đà đánh biên phải.';
    }
    if (ph === 'serve') {
      if (slot === 'P1' && board.lineup[0] === pid) return 'Phát bóng. Phát xong vào ngay vị trí phòng thủ.';
      return front ? 'Đứng chờ ở lưới, bóng qua lưới thì vào vị trí chắn.' : 'Bóng qua lưới thì lùi về vị trí phòng thủ của mình.';
    }
    if (ph === 'attack') {
      if (rl === 'S') return 'Chuyền hai: chọn người đánh theo tình huống, ưu tiên người đang ghi điểm tốt.';
      if (front) return { OH: 'Chạy đà đánh biên trái.', MB: 'Chạy đà đánh nhanh giữa lưới, kéo chắn của đối thủ.', OP: 'Chạy đà đánh biên phải.' }[rl] || 'Chuẩn bị tấn công.';
      return rl === 'OH' ? 'Có thể đánh hàng sau ở giữa sân. Không đánh thì yểm trợ bóng bị chắn dội lại.' : 'Yểm trợ người đánh, sẵn sàng cứu bóng bị chắn dội lại.';
    }
    if (front) return { OH: 'Chắn biên trái, khép tay với phụ công.', MB: 'Đọc chuyền hai đối thủ, chạy sang chắn cùng biên.', S: 'Chắn biên phải.', OP: 'Chắn biên phải.' }[rl] || 'Chắn bóng.';
    const z = zoneOf(posAt(ui.sim)[pid]);
    return `Phòng thủ vùng ${z}${z ? ` (${ZONE_NAME[z]})` : ''}: đứng thấp, hướng người về phía bóng.`;
  }
  function renderFocus() {
    const pos = posAt(ui.sim);
    const foc = ui.focus.filter((pid) => pos[pid]);
    if (!foc.length) {
      ref.focus.innerHTML = `<div class="tx-k">Tập trung VĐV</div><h2>Chạm một cầu thủ trên sân</h2><p class="tx-muted">Sẽ hiện: đứng ở đâu, trong pha nào, làm gì. Chạm thêm người để xem cách hai người phối hợp.</p>`;
      return;
    }
    const slots = slotOf(board);
    const others = (pid) => loadPlans().filter((p) => p.id !== board.id && p.positions[pid]).map((p) => p.name).slice(0, 3);
    const card = (pid) => {
      const z = zoneOf(pos[pid]);
      const zones = board.drawings.filter((d) => d.type === 'zone' && d.pid === pid).length;
      const note = board.notes.players[pid];
      const st = stepsOf(pid);
      const ot = others(pid);
      return `<article class="tx-pcard" data-testid="tx-focus-card" data-pid="${esc(pid)}">
        <div class="tx-phead"><span class="tx-badge" style="background:${COLORS[role[pid]] || COLORS.OH}">${esc(P(pid).num)}</span><div><b>${esc(label(pid))}</b><span class="tx-muted">${ROLE_NAME[role[pid]] || ''}</span></div></div>
        <dl>
          <dt>Ở đâu</dt><dd data-testid="tx-where">${z ? `Vùng ${z} (${ZONE_NAME[z]})` : 'Sau vạch cuối sân (chỗ phát bóng)'}${zones ? ` · có ${zones} vùng phụ trách đã vẽ` : ''}</dd>
          <dt>Khi nào</dt><dd data-testid="tx-when">${esc(PHASE[board.phase].label)} · xoay vòng P${board.rotation}${slots[pid] ? ` · lúc bắt đầu đứng ô ${slots[pid]}` : ''}${ui.sim ? ` · đang xem bước ${ui.sim}` : ''}${ot.length ? `<br><span class="tx-muted">Cũng có trong: ${ot.map(esc).join(' · ')}</span>` : ''}</dd>
          <dt>Làm gì</dt><dd data-testid="tx-how">${esc(note || defaultHow(pid))}${note ? '' : ' <span class="tx-tag">gợi ý mặc định</span>'}${st.length ? `<br><span class="tx-muted">${st.map(esc).join(' · ')}</span>` : ''}</dd>
        </dl>
        <label class="tx-edit tx-notelab">Dặn riêng số ${esc(P(pid).num)}<textarea rows="2" maxlength="300" data-note="${esc(pid)}" data-testid="tx-note-player" placeholder="Vd: Bóng giữa hai người thì bạn nhận">${esc(note || '')}</textarea></label>
      </article>`;
    };
    let pair = '';
    if (foc.length > 1) {
      const rows = [];
      for (let i = 0; i < foc.length; i++) for (let j = i + 1; j < foc.length; j++) rows.push(`<li>Số ${esc(P(foc[i]).num)} ↔ số ${esc(P(foc[j]).num)}: cách nhau <b>${dec1(dist(pos[foc[i]], pos[foc[j]]))} m</b></li>`);
      pair = `<ul class="tx-pairs" data-testid="tx-pairs">${rows.join('')}</ul>`;
    }
    ref.focus.innerHTML = `<div class="tx-fhead"><div class="tx-k">${foc.length > 1 ? `Phối hợp ${foc.length} người` : 'Tập trung VĐV'}</div><button class="tx-btn tx-sm" data-act="focus-clear" data-testid="tx-focus-clear">Bỏ chọn</button></div>${pair}${foc.map(card).join('')}`;
  }
  function renderPlans() {
    const plans = loadPlans();
    const ro = board.id && !plans.some((p) => p.id === board.id) && !!builtinOf(board.id);
    const date = (s) => { const d = new Date(s); return `${d.getDate()}/${d.getMonth() + 1}`; };
    const row = (p, builtin) => `<li class="tx-plan${board.id === p.id ? ' is-on' : ''}" data-testid="tx-plan-item">
      <button class="tx-planbtn" data-act="plan-load:${esc(p.id)}"><b>${esc(p.name)}</b><span class="tx-muted">${esc(PHASE[p.phase].label)} · P${p.rotation}${builtin ? (p.source === 'ai' ? ' · chỉ đọc' : ' · mẫu') : ' · ' + date(p.createdAt)}</span></button>
      ${p.source === 'ai' ? '<span class="tx-src">AI</span>' : ''}
      ${builtin ? '' : `<button class="tx-btn tx-sm${ui.delArm === p.id ? ' tx-warn' : ''}" data-act="plan-del:${esc(p.id)}" aria-label="Xoá phương án ${esc(p.name)}">${ui.delArm === p.id ? 'Chạm lần nữa để xoá' : 'Xoá'}</button>`}</li>`;
    ref.plans.innerHTML = `<div class="tx-k">Phương án</div>
      <label class="tx-lab" for="tx-name">Tên phương án</label>
      <input id="tx-name" class="tx-input" type="text" maxlength="120" value="${esc(board.name)}" placeholder="Vd: Đỡ phát khi Long An phát nhảy vào số 3" data-testid="tx-plan-name">
      <label class="tx-lab" for="tx-general">Dặn chung cả đội</label>
      <textarea id="tx-general" class="tx-input" rows="2" maxlength="600" data-testid="tx-note-general" placeholder="Vd: Đỡ cao về giữa lưới, gọi bóng to">${esc(board.notes.general)}</textarea>
      <div class="tx-row tx-planacts">
        <button class="tx-btn tx-dark" data-act="plan-save" data-testid="tx-plan-save">${board.id && plans.some((p) => p.id === board.id) ? 'Lưu thay đổi' : 'Lưu phương án'}</button>
        ${board.id && plans.some((p) => p.id === board.id) ? '<button class="tx-btn" data-act="plan-save-new" data-testid="tx-plan-save-new">Lưu thành bản mới</button>' : ''}
        <button class="tx-btn" data-act="plan-new" data-testid="tx-plan-new">Bảng mới</button>
      </div>
      ${ro ? '<p class="tx-muted tx-ro" data-testid="tx-readonly">Phương án có sẵn trong báo cáo đối thủ — chỉ đọc. Sửa rồi bấm Lưu sẽ thành bản riêng trên máy này.</p>' : ''}
      <ul class="tx-plans" data-testid="tx-plan-list">${plans.length ? plans.map((p) => row(p, false)).join('') : '<li class="tx-muted tx-empty">Chưa lưu phương án nào.</li>'}</ul>
      <div class="tx-lab">Mẫu có sẵn</div><ul class="tx-plans">${row(SAMPLE, true)}${BUILTIN.filter((b) => !plans.some((p) => p.id === b.id)).map((b) => row(b, true).replace('data-testid="tx-plan-item"', 'data-testid="tx-plan-builtin"')).join('')}</ul>`;
  }
  function render() {
    cancelAnimationFrame(raf);
    el.classList.toggle('tx--present', ui.present);
    ref.textbar.hidden = !ui.text || ui.present;
    renderControls();
    drawSvg();
    const typing = (box) => box.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!typing(ref.focus)) renderFocus(); // đang gõ dặn riêng / tên phương án thì không vẽ lại ô đó (mất chữ, mất con trỏ)
    if (!typing(ref.plans)) renderPlans();
  }
  const SAMPLE = sample();

  // ─── Toạ độ con trỏ → mét ────────────────────────────────────────────────────────────────
  function toCourt(e) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }
  function rectOf(a, b) {
    return { x: r2(Math.min(a.x, b.x)), y: r2(Math.min(a.y, b.y)), w: r2(Math.abs(a.x - b.x)), h: r2(Math.abs(a.y - b.y)) };
  }
  function nearestPlayer(p, max) {
    const pos = posAt(ui.drawStep - 1);
    let best = null, bd = max;
    for (const [pid, q] of Object.entries(pos)) { const d = dist(p, q); if (d < bd) { bd = d; best = pid; } }
    return best;
  }
  function toggleFocus(pid) {
    ui.focus = ui.focus.includes(pid) ? ui.focus.filter((x) => x !== pid) : [...ui.focus, pid];
    render();
  }

  const onDown = (e) => {
    if (e.button > 0 || ui.anim) return;
    const p = toCourt(e);
    const tok = e.target.closest('[data-pid],[data-opp]');
    if (!ui.present && ui.sim > 0 && ui.mode === 'draw') { ui.sim = 0; render(); say('Đã về vị trí ban đầu để vẽ tiếp.'); }
    const locked = ui.present;
    if (ui.mode === 'draw' && !locked) {
      const pid = ui.tool === 'arrow' ? nearestPlayer(p, 0.9) : null;
      const from = pid ? posAt(ui.drawStep - 1)[pid] : { x: r2(p.x), y: r2(p.y) };
      ui.drag = { kind: 'draw', tool: ui.tool, start: p, cur: p, from, pid, tok: tok && tok.dataset.pid, moved: false };
    } else if (tok) {
      ui.drag = tok.dataset.pid ? { kind: 'pl', id: tok.dataset.pid, start: p, moved: false, locked } : { kind: 'opp', idx: +tok.dataset.opp, start: p, moved: false, locked };
    } else ui.drag = { kind: 'bg', start: p, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch { /* không sao */ }
    e.preventDefault();
  };
  const onMove = (e) => {
    const d = ui.drag;
    if (!d) return;
    const p = toCourt(e);
    if (!d.moved && dist(p, d.start) < 0.25) return;
    if (!d.moved) {
      d.moved = true;
      if ((d.kind === 'pl' || d.kind === 'opp') && !d.locked) {
        if (ui.sim > 0) { ui.sim = 0; renderControls(); say('Đã về vị trí ban đầu để chỉnh chỗ đứng.'); }
        snap();
      }
    }
    if (d.kind === 'pl' && !d.locked) board.positions[d.id] = { x: r2(clamp(p.x, -1, 10)), y: r2(clamp(p.y, 9.25, 20.3)) };
    else if (d.kind === 'opp' && !d.locked) board.opponents[d.idx] = { x: r2(clamp(p.x, -1, 10)), y: r2(clamp(p.y, -2.3, 8.75)) };
    else if (d.kind === 'draw') d.cur = p;
    else return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawSvg);
  };
  const onUp = () => {
    const d = ui.drag;
    ui.drag = null;
    if (!d) return;
    if (d.kind === 'pl') { if (!d.moved) return toggleFocus(d.id); if (!d.locked) { persistDraft(); render(); } return; }
    if (d.kind === 'opp') { if (d.moved && !d.locked) { persistDraft(); render(); } return; }
    if (d.kind === 'bg') { if (!d.moved && ui.focus.length) { ui.focus = []; render(); } return; }
    // vẽ
    if (d.tool === 'text') { if (!d.moved) { ui.text = { x: r2(clamp(d.start.x, -1, 10)), y: r2(clamp(d.start.y, -2, 20.3)) }; render(); ref.textin.value = ''; ref.textin.focus(); } return; }
    if (!d.moved || dist(d.start, d.cur) < 0.4) { if (d.tok) toggleFocus(d.tok); else drawSvg(); return; }
    const to = { x: r2(clamp(d.cur.x, -1.2, 10.2)), y: r2(clamp(d.cur.y, -2.5, 20.5)) };
    commit(() => {
      if (d.tool === 'zone') {
        const z = rectOf(d.start, d.cur);
        const pos = posAt(0);
        const inside = Object.keys(pos).filter((pid) => pos[pid].x >= z.x && pos[pid].x <= z.x + z.w && pos[pid].y >= z.y && pos[pid].y <= z.y + z.h);
        board.drawings.push({ id: uid(), type: 'zone', pid: inside.length === 1 ? inside[0] : null, ...z });
      } else if (d.tool === 'arrow') board.drawings.push({ id: uid(), type: 'arrow', step: ui.drawStep, pid: d.pid, from: { ...d.from }, to });
      else board.drawings.push({ id: uid(), type: 'ball', step: ui.drawStep, from: { x: r2(d.start.x), y: r2(d.start.y) }, to });
    });
  };
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', () => { ui.drag = null; render(); });

  // ─── Nút bấm ─────────────────────────────────────────────────────────────────────────────
  function currentPlan() {
    return { ...clone(board), name: (el.querySelector('#tx-name') || {}).value || board.name };
  }
  // Chữ gõ tay (tên, dặn chung, dặn riêng) không nằm trong lịch sử hoàn tác: giữ bản đang có.
  function keepText(b) {
    if (b.phase === board.phase && b.rotation === board.rotation) { b.name = board.name; b.notes = clone(board.notes); b.id = board.id; }
    return b;
  }
  function setBoard(b) {
    board = b; ui.focus = ui.focus.filter((pid) => b.positions[pid]); ui.delArm = null;
    if (liberoId && b.positions[liberoId] && !b.libero) b.libero = liberoId;
    if (liberoOut(b.lineup, b.phase)) ui.libOn = !!b.libero;
    ui.drawStep = Math.max(1, stepCount()); stopSim();
  }
  function loadPlan(pl) {
    const p = typeof pl === 'string' ? (pl === SAMPLE.id ? SAMPLE : loadPlans().find((x) => x.id === pl) || builtinOf(pl)) : normalizePlan(pl);
    if (!p) return false;
    snap();
    const b = clone(p);
    if (!b.lineup) b.lineup = slotsFor(base, b.rotation);
    // Phương án thiếu người (vd AI chỉ ghi vài người) → bù đội hình chuẩn của pha + xoay vòng đó.
    if (Object.keys(b.positions).length < 6) {
      const d = defaults(b.phase, b.rotation, b.libero ? true : ui.libOn);
      if (!Object.keys(b.positions).length) { b.lineup = d.slots; b.libero = d.out ? liberoId : null; }
      for (const [pid, q] of Object.entries(d.pos)) if (Object.keys(b.positions).length < 6 && !b.positions[pid]) b.positions[pid] = q;
    }
    if (p === SAMPLE) b.id = null;
    if (b.opponents.length) ui.view = 'full';
    setBoard(b);
    persistDraft(); render();
    return true;
  }
  function doSave(asNew) {
    const name = String(el.querySelector('#tx-name').value || '').trim() || `${PHASE[board.phase].label} · xoay vòng P${board.rotation}`;
    const exists = board.id && loadPlans().find((p) => p.id === board.id);
    const plan = { ...clone(board), name, id: asNew || !exists ? uid() : board.id, createdAt: exists && !asNew ? exists.createdAt : new Date().toISOString(), source: exists && !asNew ? exists.source : 'coach' };
    const saved = savePlan(plan);
    if (!saved) return say('Không lưu được: trình duyệt đang chặn bộ nhớ (chế độ ẩn danh hoặc đầy bộ nhớ).');
    board.id = saved.id; board.name = saved.name; board.createdAt = saved.createdAt; board.source = saved.source;
    persistDraft(); render();
    say(`Đã lưu “${saved.name}”.`);
  }
  function setPresent(on) {
    ui.present = !!on; ui.text = null;
    if (ui.present) { try { const r = el.requestFullscreen && el.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch { /* không hỗ trợ toàn màn hình */ } }
    else if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch { /* bỏ qua */ } }
    render();
  }

  const onClick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !el.contains(b)) return;
    const [act, arg] = b.dataset.act.split(/:(.*)/s);
    if (act !== 'plan-del') ui.delArm = null;
    switch (act) {
      case 'phase': if (arg !== board.phase) commit(() => setBoard(freshBoard(arg, board.rotation, ui.libOn))); break;
      case 'rot': if (+arg !== board.rotation) commit(() => setBoard(freshBoard(board.phase, +arg, ui.libOn))); break;
      case 'lib': ui.libOn = !ui.libOn; commit(() => {
        const out = liberoOut(board.lineup, board.phase);
        if (!board.libero && board.positions[liberoId]) board.libero = liberoId;
        if (!ui.libOn && board.libero) { const pos = board.positions[board.libero]; const missing = board.lineup.find((pid) => !board.positions[pid]); delete board.positions[board.libero]; if (missing) board.positions[missing] = pos; board.libero = null; }
        else if (ui.libOn && !board.libero && out && board.positions[out]) { board.positions[liberoId] = board.positions[out]; delete board.positions[out]; board.libero = liberoId; }
        else if (ui.libOn && !out) say('Xoay vòng này phụ công hàng sau đang phát bóng, libero chờ ngoài sân.');
      }); break;
      case 'more': ui.more = !ui.more; renderControls(); break;
      case 'view': ui.view = ui.view === 'full' ? 'half' : 'full'; persistDraft(); render(); break;
      case 'opp': commit(() => { if (board.opponents.length) board.opponents = []; else { board.opponents = OPP_DEFAULT.map(([x, y]) => ({ x, y })); ui.view = 'full'; } }); break;
      case 'mode': ui.mode = arg; ui.text = null; stopSim(); render(); break;
      case 'tool': ui.tool = arg; ui.text = null; render(); break;
      case 'dstep-': ui.drawStep = Math.max(1, ui.drawStep - 1); render(); break;
      case 'dstep+': ui.drawStep = Math.min(20, ui.drawStep + 1); render(); break;
      case 'undo': if (ui.undo.length) { ui.redo.push(JSON.stringify(board)); setBoard(keepText(JSON.parse(ui.undo.pop()))); persistDraft(); render(); } break;
      case 'redo': if (ui.redo.length) { ui.undo.push(JSON.stringify(board)); setBoard(keepText(JSON.parse(ui.redo.pop()))); persistDraft(); render(); } break;
      case 'clear': commit(() => { board.drawings = []; ui.drawStep = 1; }); break;
      case 'reset': commit(() => { const d = defaults(board.phase, board.rotation, ui.libOn); board.lineup = d.slots; board.positions = d.pos; board.libero = d.out ? liberoId : null; }); break;
      case 'sim-prev': goStep(ui.sim - 1, false); break;
      case 'sim-next': goStep(ui.sim + 1); break;
      case 'sim-play': playAll(); break;
      case 'present': setPresent(true); break;
      case 'present-exit': setPresent(false); break;
      case 'focus-clear': ui.focus = []; render(); break;
      case 'text-ok': {
        const t = ref.textin.value.trim();
        const at = ui.text; ui.text = null;
        if (t && at) commit(() => board.drawings.push({ id: uid(), type: 'text', x: at.x, y: at.y, text: t.slice(0, 80) })); else render();
        break;
      }
      case 'text-cancel': ui.text = null; render(); break;
      case 'plan-save': doSave(false); break;
      case 'plan-save-new': doSave(true); break;
      case 'plan-new': commit(() => setBoard(freshBoard(board.phase, board.rotation, ui.libOn))); break;
      case 'plan-load': loadPlan(arg); break;
      case 'plan-del':
        if (ui.delArm !== arg) { ui.delArm = arg; renderPlans(); break; }
        ui.delArm = null; deletePlan(arg); if (board.id === arg) board.id = null; persistDraft(); render(); say('Đã xoá phương án.'); break;
      default: break;
    }
  };
  const onInput = (e) => {
    const t = e.target;
    if (t.dataset.note) { const v = t.value.trim(); if (v) board.notes.players[t.dataset.note] = t.value; else delete board.notes.players[t.dataset.note]; persistDraft(); }
    else if (t.id === 'tx-general') { board.notes.general = t.value; persistDraft(); }
    else if (t.id === 'tx-name') { board.name = t.value; persistDraft(); }
  };
  const onChange = (e) => { if (e.target.dataset.note) renderFocus(); };
  const onKey = (e) => {
    if (!el.isConnected) return;
    if (e.target === ref.textin && e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-act="text-ok"]').click(); return; }
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && ui.present) setPresent(false);
    else if (!ui.present && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); el.querySelector(`[data-act="${e.shiftKey ? 'redo' : 'undo'}"]`)?.click(); }
    else if (ui.present && e.key === 'ArrowRight') goStep(ui.sim + 1);
    else if (ui.present && e.key === 'ArrowLeft') goStep(ui.sim - 1, false);
  };
  const onHide = () => { if (saveT) { clearTimeout(saveT); lsSet(KEY.draft, { board, view: ui.view }); } };
  const onFs = () => { if (!document.fullscreenElement && ui.present) { ui.present = false; render(); } };
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFs);
  window.addEventListener('pagehide', onHide);

  render();
  return {
    loadPlan,
    getBoard: () => normalizePlan({ ...clone(board), name: board.name || 'Bảng đang vẽ', id: board.id || 'draft' }),
    currentPlan,
    setPresent,
    destroy() {
      cancelAnimationFrame(raf); cancelAnimationFrame(animRaf); clearTimeout(saveT);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('pagehide', onHide);
      el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange);
      el.innerHTML = ''; el.classList.remove('tx', 'tx--present');
    },
  };
}
