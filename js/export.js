// Xuất dữ liệu: CSV (mỗi pha một dòng), JSON sao lưu, văn bản chia sẻ Zalo.
import { HOW, replay, stats, insights, playerLabel, playerById, setScores, pct } from './logic.js';

export const TYPE_LABEL = { practice: 'Đấu tập', official: 'Chính thức' };

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCSV(m) {
  const R = replay(m);
  const head = ['set', 'pha', 'ta_truoc', 'doi_truoc', 'ben_phat', 'xoay_vong', 'ket_qua', 'cach', 'so_ao', 'ten', 'do_buoc_1', 'ta_sau', 'doi_sau'];
  const rows = R.rallies.map((r) => {
    const p = playerById(m, r.p);
    return [r.set, r.no, r.usB, r.themB, r.serve === 'us' ? 'Ta' : 'Đối thủ', r.rot, r.win ? 'Ghi điểm' : 'Mất điểm',
      HOW[r.how].label, p ? p.num : '', p ? p.name : '', r.rc ?? '', r.usA, r.themA];
  });
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function backup(team, matches) {
  return { app: 'scout-bong-chuyen', version: 1, exportedAt: new Date().toISOString(), team, matches };
}

// Chấp nhận: file sao lưu đầy đủ {team, matches} hoặc một trận {match}.
export function parseImport(text) {
  const d = JSON.parse(text);
  if (d && d.app === 'scout-bong-chuyen') {
    const matches = d.matches || (d.match ? [d.match] : []);
    matches.forEach(check);
    if (d.team && !(Array.isArray(d.team.players) && d.team.players.every(okPlayer))) throw new Error('Danh sách đội trong file không hợp lệ.');
    return { team: d.team || null, matches };
  }
  throw new Error('File không phải dữ liệu của Scout Bóng Chuyền.');
}
// VĐV hợp lệ: id chỉ gồm chữ/số/-/_ và số áo là số — hai trường này được chèn thẳng vào HTML.
const okPlayer = (p) => !!p && typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.id) && Number.isFinite(p.num);
function check(m) {
  if (!m || typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(m.id) || !Array.isArray(m.events) || !Array.isArray(m.players)
    || !m.players.every(okPlayer) || !m.events.every((e) => e && typeof e.t === 'string')) {
    throw new Error('Dữ liệu trận không hợp lệ.');
  }
  m.date = String(m.date ?? '');
  m.opponent = String(m.opponent ?? '');
  m.bestOf = m.bestOf === 3 ? 3 : 5;
  replay(m); // ném lỗi ngay nếu nhật ký hỏng, trước khi ghi bất cứ thứ gì
}

export function shareText(m, teamName) {
  const R = replay(m);
  const st = stats(m, R, null);
  const s = st.src;
  const res = R.sets.length ? `${R.winsUs}–${R.winsThem} (${setScores(R).join(', ')})` : 'chưa có set nào';
  const top = st.players.filter((p) => p.k > 0).sort((a, b) => b.k - a.k).slice(0, 3)
    .map((p) => `${playerLabel(m, p.pid)} ${p.k} ghi/${p.e} hỏng`).join('; ');
  const lines = [
    `${teamName} vs ${m.opponent || 'Đối thủ'} — ${TYPE_LABEL[m.type]} ${fmtDate(m.date)}`,
    `Kết quả: ${res}`,
    `Điểm ghi (${st.won}): tấn công ${s.atk}, chắn ${s.blk}, ace ${s.ace}, đối thủ lỗi ${s.oer}`,
    `Điểm mất (${st.lost}): lỗi tấn công ${s.aer}, bị chắn ${s.bkd}, lỗi phát ${s.ser}, đỡ hỏng ${s.rer}, lỗi khác ${s.xer}, đối thủ tấn công ${s.oat}`,
    `Side-out ${pct(st.soW, st.soN)} · Break-point ${pct(st.bpW, st.bpN)}` + (st.recv.n ? ` · Đỡ bước 1 TB ${(st.recv.sum / st.recv.n).toFixed(1).replace('.', ',')}/3` : ''),
  ];
  if (st.worst) lines.push(`Xoay vòng yếu nhất: ${st.worst.k} (${st.worst.won}/${st.worst.n}, ${st.worst.diff})`);
  if (top) lines.push(`Tấn công nổi bật: ${top}`);
  const ins = insights(m, st, false).filter((x) => x.sev > 0);
  ins.forEach((x, i) => lines.push(`${i + 1}. ${x.text}`));
  lines.push('— Scout Bóng Chuyền');
  return lines.join('\n');
}

export function fmtDate(d) {
  if (!d) return '';
  const [y, mo, da] = d.split('-');
  return `${da}/${mo}/${y}`;
}

export function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const slug = (s) => (s || 'doi-thu').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
