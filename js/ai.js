// Soạn câu hỏi cho AI (ChatGPT / Gemini / Claude): vai trò + yêu cầu + JSON gọn số liệu trận.
// Không gọi API nào: người dùng tự sao chép rồi dán vào trang AI. Logic thuần, không đụng DOM.
import { replay, stats, insights, playerById, setScores, POS_SHORT } from './logic.js';

export const AI_MAX = 6000;
export const AI_SITES = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Gemini', 'https://gemini.google.com/app'],
  ['Claude', 'https://claude.ai/new'],
];

const r2 = (x) => Math.round(x * 100) / 100;
const who = (m, pid) => {
  const p = playerById(m, pid);
  return p ? `#${p.num}${p.name ? ' ' + p.name : ''}${p.pos ? ' (' + POS_SHORT[p.pos] + ')' : ''}` : '?';
};

// setN = null → cả trận.
export function aiData(m, setN) {
  const R = replay(m);
  const st = stats(m, R, setN);
  const s = st.src;
  const cur = setN ? R.sets[setN - 1] : null;
  return {
    doi: m.teamName, doiThu: m.opponent || 'Đối thủ', ngay: m.date, loai: m.type === 'practice' ? 'đấu tập' : 'chính thức',
    phamVi: setN ? `set ${setN}` : 'cả trận',
    setThang: [R.winsUs, R.winsThem], cacSet: setScores(R), tiSo: cur ? [cur.us, cur.them] : undefined,
    pha: st.n, thang: st.won, thua: st.lost,
    so: [st.soW, st.soN], bp: [st.bpW, st.bpN],
    do1: { lan: st.recv.n, tb: st.recv.n ? r2(st.recv.sum / st.recv.n) : null, phanBo: st.recv.dist,
      tot: [st.recv.goodW, st.recv.goodN], xau: [st.recv.badW, st.recv.badN] },
    ghi: { tanCong: s.atk, chan: s.blk, ace: s.ace, doiLoi: s.oer, khongRo: s.uw },
    mat: { loiTC: s.aer, biChan: s.bkd, loiPhat: s.ser, doHong: s.rer, loiKhac: s.xer, doiTC: s.oat, khongRo: s.ul },
    xoay: st.rot.filter((x) => x.n).map((x) => ({ v: x.k, t: x.won, h: x.lost, so: [x.soW, x.soN], bp: [x.bpW, x.bpN] })),
    tc: st.players.filter((p) => p.k + p.e + p.b > 0)
      .map((p) => ({ vdv: who(m, p.pid), ghi: p.k, loi: p.ae, biChan: p.bd, chan: p.b, hs: p.eff == null ? null : r2(p.eff) })),
    phat: st.players.filter((p) => p.ace + p.se > 0).map((p) => ({ vdv: who(m, p.pid), ace: p.ace, loi: p.se })),
    doNguoi: st.passers.map((q) => ({ vdv: who(m, q.pid), lan: q.n, tb: r2(q.avg) })),
    nhanDinhApp: insights(m, st, !!cur && !cur.over).map((x) => x.text),
  };
}

const HEAD = (d) => `Bạn là trợ lý phân tích số liệu bóng chuyền cho ban huấn luyện một CLB bóng chuyền Việt Nam.
Dữ liệu JSON bên dưới do scout ghi tay tại sân (${d.doi} vs ${d.doiThu}, ${d.phamVi}). Chỉ dùng số trong JSON, không bịa thêm số.

Hãy trả lời bằng tiếng Việt, gạch đầu dòng, ngắn gọn:
1. Xoay vòng: vòng nào thua điểm nhiều nhất, side-out/break-point từng vòng.
2. Đỡ bước 1: trung bình đội và từng người, liên hệ với side-out (bóng đỡ tốt ≥2 so với xấu ≤1).
3. Tấn công: hiệu suất từng VĐV, ai đang gánh điểm, ai mắc lỗi/bị chắn nhiều.
4. Đề xuất đúng 3 điều chỉnh cho set tiếp theo. Mỗi đề xuất ghi kèm bằng chứng là con số cụ thể trong JSON.
5. Nêu rõ chỗ không chắc chắn: mẫu nhỏ (dưới 10 pha), dữ liệu thiếu (pha "không rõ", đỡ bước 1 không chấm), điều số liệu này không đo được.

Chú thích khoá: so = [thắng, tổng] pha đối thủ phát (side-out); bp = [thắng, tổng] pha ta phát (break-point);
xoay: v = vị trí chuyền hai P1–P6, t/h = thắng/thua; do1: thang 0–3 (0 hỏng, 3 hoàn hảo), phanBo = số lần chấm 0/1/2/3,
tot/xau = [thắng, tổng] sau bóng đỡ ≥2 / ≤1; tc: ghi/loi/biChan chỉ tính pha tấn công KẾT THÚC điểm,
hs = (ghi − lỗi − bị chắn)/(tổng), chan = điểm chắn; nhanDinhApp = nhận định tự động của app.

`;

// Trả về chuỗi câu hỏi < AI_MAX ký tự; cắt bớt danh sách dài nhất nếu cần (không cắt số tổng).
export function aiPrompt(m, setN) {
  const d = aiData(m, setN);
  const build = () => HEAD(d) + '```json\n' + JSON.stringify(d) + '\n```';
  let out = build();
  const trims = ['doNguoi', 'phat', 'tc', 'nhanDinhApp'];
  for (const k of trims) {
    while (out.length > AI_MAX && d[k].length) { d[k].pop(); d.catBot = true; out = build(); }
  }
  return out;
}
