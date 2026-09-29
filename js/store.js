// Lưu trữ cục bộ (localStorage). Mọi thao tác đều bọc try/catch:
// nếu trình duyệt chặn lưu (chế độ ẩn danh, đầy bộ nhớ) app vẫn chạy và báo cho người dùng.

const K = {
  team: 'vbs.team',
  idx: 'vbs.index',
  cur: 'vbs.current',
  m: (id) => 'vbs.match.' + id,
  v: (id) => 'vbs.video.' + id,
};

export let lastError = null;

function get(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    lastError = e;
    return fallback;
  }
}
// Trả về lỗi (hoặc null). lastError chỉ được xoá khi CẢ lượt lưu thành công.
function set(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return null;
  } catch (e) {
    return e;
  }
}
function del(key) {
  try { localStorage.removeItem(key); } catch (e) { lastError = e; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function defaultTeam() {
  const players = [];
  for (let i = 1; i <= 14; i++) players.push({ id: 'p' + i, num: i, name: '', pos: '' });
  return { name: 'Đội nhà', players };
}

// null = chưa có đội (lần đầu mở app) hoặc dữ liệu hỏng → app nạp danh sách có sẵn.
export function loadTeam() {
  const t = get(K.team, null);
  const okP = (p) => p && typeof p.id === 'string' && Number.isFinite(p.num);
  return t && Array.isArray(t.players) && t.players.every(okP)
    ? { name: String(t.name || 'Đội nhà'), players: t.players, preset: typeof t.preset === 'string' ? t.preset : '' } : null;
}
export function saveTeam(t) {
  lastError = set(K.team, t);
  return !lastError;
}

function summary(m, R) {
  return {
    id: m.id, opp: m.opponent, date: m.date, type: m.type, status: m.status,
    sets: R ? R.sets.map((s) => [s.us, s.them]) : [], winsUs: R ? R.winsUs : 0, winsThem: R ? R.winsThem : 0,
  };
}

export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
export const isMatch = (m) => !!m && validId(m.id) && Array.isArray(m.events) && Array.isArray(m.players);

export function listMatches() {
  const v = get(K.idx, []);
  return Array.isArray(v) ? v.filter((x) => x && validId(x.id)) : [];
}
export function loadMatch(id) {
  if (!validId(id)) return null;
  const m = get(K.m(id), null);
  return isMatch(m) ? m : null;
}
export function saveMatch(m, R) {
  const e1 = set(K.m(m.id), m);
  const idx = listMatches().filter((x) => x.id !== m.id);
  idx.unshift(summary(m, R));
  const e2 = set(K.idx, idx);
  lastError = e1 || e2 || null;
  return !lastError;
}
export function deleteMatch(id) {
  del(K.m(id));
  del(K.v(id));
  set(K.idx, listMatches().filter((x) => x.id !== id));
  if (currentId() === id) setCurrent(null);
}
// Mọi khoá của app trong localStorage (đều bắt đầu bằng 'vbs.').
function appKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('vbs.')) out.push(k); } } catch (e) { lastError = e; }
  return out;
}
// Bắt đầu lại (Cài đặt): xoá mọi trận đã ghi + mốc video — giữ đội, ảnh cầu thủ, phương án chiến thuật, cài đặt AI.
export function clearMatches() {
  appKeys().filter((k) => k === K.idx || k === K.cur || k.startsWith('vbs.match.') || k.startsWith('vbs.video.')).forEach(del);
}
// Xoá toàn bộ dữ liệu của app trên máy này; mở lại sẽ như lần đầu (đội LPBank có sẵn).
export function clearAll() {
  appKeys().forEach(del);
}
export const currentId = () => {
  const v = get(K.cur, null);
  return validId(v) ? v : null;
};
export const setCurrent = (id) => (id ? set(K.cur, id) : del(K.cur));

// Mốc khớp video của từng trận: { offset: giây, yt: link YouTube }. Không ảnh hưởng dữ liệu trận.
export function loadVideoSync(id) {
  const v = validId(id) ? get(K.v(id), null) : null;
  return { offset: v && Number.isFinite(v.offset) ? v.offset : null, yt: v && typeof v.yt === 'string' ? v.yt : '' };
}
export const saveVideoSync = (id, v) => { if (validId(id)) set(K.v(id), v); };
