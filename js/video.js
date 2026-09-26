// Xem lại video: tiện ích thuần (không đụng DOM) — đọc mốc thời gian, link YouTube, tính chỗ tua.
import { replay } from './logic.js';

export const LEAD = 5; // tua sớm 5 giây trước mốc để thấy cả đoạn đầu pha

// "1:02:03", "12:34", "95" → giây; "-0:30" = video bắt đầu quay SAU pha đầu 30 giây; sai định dạng / quá 100 giờ → null.
export function parseTime(s) {
  const t = String(s ?? '').trim();
  if (!/^-?\d{1,6}(:[0-5]?\d){0,2}$/.test(t)) return null;
  const v = t.replace('-', '').split(':').reduce((a, x) => a * 60 + +x, 0);
  return v >= 360000 ? null : t[0] === '-' ? -v : v;
}
export function fmtTime(sec) {
  if (sec < 0) return '-' + fmtTime(-sec);
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(x).padStart(2, '0');
}

// Lấy mã video 11 ký tự từ link YouTube (watch?v=, youtu.be/, shorts/, embed/, live/) hoặc chính mã đó.
export function ytId(url) {
  const s = String(url ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/);
  return m ? m[1] : null;
}
export const ytEmbed = (id, start, auto = true) =>
  `https://www.youtube-nocookie.com/embed/${id}?start=${Math.max(0, Math.floor(start))}&autoplay=${auto ? 1 : 0}&playsinline=1&rel=0`;

// Các pha kèm giây trong video: (ts − ts pha đầu tiên)/1000 + offset − 5, không âm.
// ts = lúc scout bấm ghi pha (cuối pha). Pha không có ts hợp lệ, hoặc xảy ra trước khi video bắt đầu (mốc âm) → sec = null.
export function videoRallies(m, offset) {
  const R = replay(m);
  const tsOf = (r) => { const t = m.events[r.i].ts; return Number.isFinite(t) && t > 0 ? t : null; };
  const first = R.rallies.map(tsOf).find((t) => t != null) ?? null;
  return R.rallies.map((r) => {
    const t = tsOf(r);
    const raw = t != null && first != null && offset != null ? (t - first) / 1000 + offset : null;
    return { ...r, sec: raw == null || raw < 0 ? null : Math.max(0, raw - LEAD) };
  });
}

// f = { res: ''|'w'|'l', p: pid|'', rot: 'P1'..|'' }
export function filterRallies(list, f) {
  return list.filter((r) => (!f.res || (f.res === 'w') === r.win)
    && (!f.p || r.p === f.p || r.rp === f.p)
    && (!f.rot || r.rot === f.rot));
}
