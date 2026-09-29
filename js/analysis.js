// Phân tích tại chỗ — không gọi mạng, không đụng DOM. Mọi số tính lại từ nhật ký trận qua logic.js.
// Dùng cho: "Kết luận hiện tại" (Hội ý, Các pha), dữ liệu biểu đồ xu hướng, và các thẻ trả lời của Trợ lý hội ý.
// Luật: số nào cũng kèm cỡ mẫu n + nhãn chắc chắn. Lời khuyên ("nên…") chỉ khi đủ mẫu VÀ chênh lệch vượt sai số.
import { stats, playerById, pct, dec, currentRun, POS_SHORT, N_MIN, clearGap, meanGap, rotGate, atkFlagOf, passFlagOf } from './logic.js';

export { N_MIN, clearGap, meanGap }; // dưới N_MIN: chỉ kể số, không nói xu hướng, không khuyên (cổng nằm ở logic.js)
export const N_OK = 20;
// Nhãn độ chắc (một bộ chữ cho cả app): dưới N_MIN = "Chưa chắc", tới N_OK = "Khá chắc", từ N_OK = "Chắc".
// Chỉ "Chưa chắc" / "Khá chắc" hiện thành nhãn trên màn; "Chắc" và số đếm không cần nhãn (giải thích ở nút "Giải thích").
export const cert = (n) => (n < N_MIN ? { label: 'Chưa chắc', cls: 'lo' } : n < N_OK ? { label: 'Khá chắc', cls: 'mid' } : { label: 'Chắc', cls: 'hi' });
export const FACT = { label: 'Số đếm', cls: 'fact' }; // chuyện đã xảy ra, không suy rộng
export const NO_ADVICE = 'chưa đủ chắc để khuyên';

export const rsOf = (R, setN) => R.rallies.filter((r) => !setN || r.set === setN);
export const scopeLabel = (setN) => (setN ? `Set ${setN}` : 'Cả trận');
const lastWord = (s) => String(s || '').trim().split(/\s+/).slice(-1)[0] || '';
export const shortP = (m, pid) => { const p = playerById(m, pid); return p ? `#${p.num}${p.name ? ' ' + lastWord(p.name) : ''}` : 'Không rõ'; };
export const fullP = (m, pid) => { const p = playerById(m, pid); return p ? `#${p.num}${p.name ? ' ' + p.name : ''}` : 'Không rõ'; };
export const frac = (a, b) => (b ? `${a}/${b} (${pct(a, b)})` : '–');

export const WIN_T = [['atk', 'tấn công'], ['ace', 'phát bóng ăn điểm'], ['blk', 'chắn bóng'], ['oer', 'đối thủ lỗi'], ['uw', 'không rõ cách']];
export const LOSE_T = [['oat', 'đối thủ tấn công'], ['bkd', 'bị chắn'], ['rer', 'đỡ hỏng / bị ace'], ['aer', 'lỗi tấn công'], ['ser', 'lỗi phát bóng'], ['xer', 'lỗi khác'], ['ul', 'không rõ cách']];
const listOf = (s, T) => T.filter(([k]) => s[k]).sort((a, b) => s[b[0]] - s[a[0]]).map(([k, l]) => `${l} ${s[k]}`).join(', ');

// Số theo từng VĐV (bổ sung cho logic.stats): lượt phát, đỡ bước 1 theo thang 0–3, tổng điểm / lỗi.
export function playerRows(m, R, setN) {
  const st = stats(m, R, setN);
  const by = {};
  const g = (pid) => (by[pid] ||= { pid, k: 0, b: 0, ace: 0, ae: 0, bd: 0, se: 0, re: 0, xe: 0, srv: 0, rn: 0, rsum: 0, dist: [0, 0, 0, 0] });
  for (const p of st.players) Object.assign(g(p.pid), { k: p.k, b: p.b, ace: p.ace, ae: p.ae, bd: p.bd, se: p.se, re: p.re, xe: p.xe });
  for (const r of rsOf(R, setN)) {
    if (r.serve === 'us' && r.server) g(r.server).srv++;
    if (r.serve === 'them' && typeof r.rc === 'number' && r.rp) { const q = g(r.rp); q.rn++; q.rsum += r.rc; q.dist[r.rc]++; }
  }
  const num = (x) => (playerById(m, x.pid) || {}).num || 0;
  return Object.values(by).map((x) => {
    const att = x.k + x.ae + x.bd;
    return { ...x, pts: x.k + x.b + x.ace, err: x.ae + x.bd + x.se + x.re + x.xe, att, eff: att ? (x.k - x.ae - x.bd) / att : null, ravg: x.rn ? x.rsum / x.rn : null };
  }).sort((a, b) => b.pts - a.pts || a.err - b.err || num(a) - num(b));
}

// ---------- Kết luận hiện tại: 3–5 câu + 1 dòng lời khuyên (chỉ khi đủ chắc) ----------
export function nowConclusions(m, R, setN) {
  const rs = rsOf(R, setN);
  if (!rs.length) return { bullets: [{ text: 'Chưa có pha nào ở phạm vi này — ghi pha đầu tiên là có số ngay.', n: 0, tag: cert(0) }], advice: null };
  const st = stats(m, R, setN);
  const s = st.src;
  const B = [];
  // 1. Tỉ số và điểm đến lúc nào (ta phát hay đỡ phát, ở vòng nào).
  let head;
  if (setN) {
    const x = R.sets[setN - 1];
    const verb = x.over ? (x.us > x.them ? 'ta thắng' : x.us < x.them ? 'ta thua' : 'hoà') : x.us > x.them ? 'ta đang dẫn' : x.us < x.them ? 'ta đang kém' : 'hai đội đang hoà';
    head = `Set ${setN}: ${verb} ${x.us}–${x.them}`;
  } else head = `Cả trận: set ${R.winsUs}–${R.winsThem}, tổng điểm ${st.won}–${st.lost}`;
  if (st.won) {
    const won = rs.filter((r) => r.win);
    const rots = new Set(won.map((r) => r.rot)), sv = new Set(won.map((r) => r.serve));
    if (won.length >= 2 && rots.size === 1 && sv.size === 1) head += `, cả ${won.length} điểm đến khi ta ${won[0].serve === 'us' ? 'phát' : 'đỡ phát'} ở ${won[0].rot}`;
    else head += `; ${st.bpW} điểm khi ta phát, ${st.soW} điểm khi đỡ phát`;
  }
  B.push({ text: head + '.', n: rs.length, tag: FACT, key: 'score' });
  // 2. Ta ghi bằng cách nào.
  const wk = WIN_T.filter(([k]) => s[k]);
  B.push(st.won
    ? { text: wk.length === 1 ? `Cả ${st.won} điểm ta ghi đều từ ${wk[0][1]}.` : `Điểm ta ghi đến từ ${wk.length} nguồn: ${listOf(s, WIN_T)}.`, n: st.won, tag: FACT, key: 'src' }
    : { text: 'Ta chưa ghi điểm nào.', n: 0, tag: FACT, key: 'src' });
  // 3. Ta mất bằng cách nào.
  const own = s.aer + s.ser + s.xer;
  B.push(st.lost
    ? { text: `Mất ${st.lost} điểm: ${listOf(s, LOSE_T)}${own ? ` — ${own}/${st.lost} do ta tự lỗi` : ''}.`, n: st.lost, tag: FACT, key: 'lost' }
    : { text: 'Chưa mất điểm nào.', n: 0, tag: FACT, key: 'lost' });
  // 4. Điểm nhấn: chuỗi đang chạy, người phát / người ghi nổi bật.
  const run = currentRun(setN ? rs : rs.filter((r) => r.set === rs[rs.length - 1].set));
  const setLen = rs.filter((r) => r.set === rs[rs.length - 1].set).length;
  const pl = playerRows(m, R, setN);
  const server = pl.filter((p) => p.ace > 0).sort((a, b) => b.ace - a.ace || a.se - b.se)[0];
  const scorer = pl.find((p) => p.pts >= 2);
  if (run.len >= 3 && run.len < setLen) B.push({ text: `${run.side === 'us' ? 'Ta' : 'Đối thủ'} đang có chuỗi ${run.len} điểm liên tiếp.`, n: run.len, tag: FACT, key: 'run' });
  else if (server) B.push({ text: `${fullP(m, server.pid)}: ${server.ace} ace, ${server.se} hỏng trong ${server.srv} lượt phát.`, n: server.srv, tag: FACT, key: 'player' });
  else if (scorer) B.push({ text: `${fullP(m, scorer.pid)} ghi ${scorer.pts} điểm (tấn công ${scorer.k}, chắn ${scorer.b}, ace ${scorer.ace}).`, n: scorer.pts + scorer.err, tag: FACT, key: 'player' });
  // 5. Đỡ bước 1.
  const r = st.recv;
  B.push(!st.soN
    ? { text: 'Đối thủ chưa phát quả nào — chưa có dữ liệu đỡ phát.', n: 0, tag: cert(0), key: 'recv' }
    : !r.n
      ? { text: `Chưa chấm đỡ bước 1 (đối thủ đã phát ${st.soN} quả); ta giành ${st.soW}/${st.soN} pha đỡ phát.`, n: st.soN, tag: cert(st.soN), key: 'recv' }
      : { text: `Đỡ bước 1 trung bình ${dec(r.sum / r.n)}/3 sau ${r.n} lần chấm; khi đối thủ phát ta giành ${st.soW}/${st.soN}.`, n: r.n, tag: cert(r.n), key: 'recv' });
  return { bullets: B.slice(0, 5), advice: adviceOf(m, R, setN) };
}

// ---------- Cổng lời khuyên DÙNG CHUNG (Hội ý: câu tóm + thẻ; Kết luận hiện tại; Các pha; Trợ lý) ----------
// Luật duy nhất: chỉ khuyên khi mẫu ≥ N_MIN VÀ chênh lệch với phần còn lại vượt sai số (clearGap / meanGap).
// Dưới cổng: chỉ kể sự việc kèm "chưa đủ chắc để kết luận".
// Xếp hạng xoay vòng: worst = tỉ lệ thắng thấp nhất (mọi n); flag = vòng kém rõ (qua cổng); best = vòng tốt rõ.
export function rotRank(st) {
  const act = st.rot.filter((x) => x.n);
  const rate = (x) => x.won / x.n;
  const rest = (x) => ({ rw: st.won - x.won, rn: st.n - x.n });
  const pass = (x, dir) => { const { rw, rn } = rest(x); return x.n >= N_MIN && rn > 0 && (dir < 0 ? rate(x) < rw / rn : rate(x) > rw / rn) && clearGap(x.won, x.n, rw, rn).clear; };
  const g = rotGate(st.rot, st.won, st.n); // cùng một hàm với logic.stats → mọi màn chọn cùng một vòng
  const worst = g.low, flag = g.flag;
  const best = act.filter((x) => pass(x, 1)).sort((x, y) => rate(y) - rate(x) || y.won - x.won)[0] || null;
  return { act, worst, flag, best, rest };
}
// Xếp hạng người tấn công theo tỉ lệ ghi / lần tấn công kết thúc pha.
export function atkRank(pl) {
  const act = pl.filter((p) => p.att > 0);
  const tk = act.reduce((s, p) => s + p.k, 0), ta = act.reduce((s, p) => s + p.att, 0);
  const rest = (p) => ({ rk: tk - p.k, ra: ta - p.att });
  const pass = (p, dir) => { const { rk, ra } = rest(p); return p.att >= N_MIN && ra > 0 && (dir < 0 ? p.k / p.att < rk / ra : p.k / p.att > rk / ra) && clearGap(p.k, p.att, rk, ra).clear; };
  const worst = act.filter((p) => p.eff < 0).sort((x, y) => x.eff - y.eff || (y.ae + y.bd) - (x.ae + x.bd))[0] || null;
  const f0 = atkFlagOf(act);
  const flag = f0 ? act.find((p) => p.pid === f0.pid) : null;
  const hot = act.filter((p) => p.eff >= 0.3 && pass(p, 1)).sort((x, y) => y.k - x.k)[0] || null;
  return { act, worst, flag, hot, rest };
}
// Xếp hạng người đỡ bước 1: so điểm đỡ của một người với phần còn lại của đội (kiểm định trung bình).
export function passRank(m, R, setN) {
  const rs = rsOf(R, setN).filter((r) => r.serve === 'them' && typeof r.rc === 'number');
  const by = {};
  rs.forEach((r) => { if (r.rp) (by[r.rp] ||= []).push(r.rc); });
  const list = Object.entries(by).map(([pid, v]) => ({ pid, n: v.length, avg: v.reduce((s, x) => s + x, 0) / v.length, v }));
  const others = (pid) => rs.filter((r) => r.rp !== pid).map((r) => r.rc);
  const worst = list.slice().sort((x, y) => x.avg - y.avg || y.n - x.n)[0] || null;
  const f0 = passFlagOf(list, rs);
  const flag = f0 ? list.find((q) => q.pid === f0.pid) : null;
  return { list, worst, flag, others };
}
// Toàn bộ tín hiệu theo đúng một thứ tự ưu tiên — mọi màn đọc từ đây nên không bao giờ nói ngược nhau.
export function signals(m, R, setN) {
  const st = stats(m, R, setN);
  const pl = playerRows(m, R, setN);
  const rot = rotRank(st), atk = atkRank(pl), pass = passRank(m, R, setN);
  const s = st.src, own = s.aer + s.ser + s.xer, r = st.recv;
  const serve = st.bpN >= N_MIN && st.se >= 3 && st.se > st.ace && clearGap(st.se, st.bpN, st.ace, st.bpN).clear;
  const ownF = st.lost >= N_MIN && own * 2 > st.lost && clearGap(own, st.lost, st.lost - own, st.lost).clear;
  const recvF = r.badN >= N_MIN && r.goodN >= N_MIN && r.goodW / r.goodN > r.badW / r.badN && clearGap(r.goodW, r.goodN, r.badW, r.badN).clear;
  const weak = [];
  if (rot.flag) { const { rw, rn } = rot.rest(rot.flag); weak.push({ k: 'rot', id: rot.flag.k, n: rot.flag.n, text: `Nên xem lại xoay vòng ${rot.flag.k}: thắng ${rot.flag.won}/${rot.flag.n} (${pct(rot.flag.won, rot.flag.n)}), các vòng khác ${rw}/${rn} (${pct(rw, rn)}).` }); }
  if (atk.flag) weak.push({ k: 'atk', id: atk.flag.pid, n: atk.flag.att, text: `Nên bớt dồn bóng cho ${fullP(m, atk.flag.pid)}: tấn công ${atk.flag.k} ghi / ${atk.flag.ae + atk.flag.bd} hỏng trong ${atk.flag.att} lần kết thúc pha.` });
  if (pass.flag) weak.push({ k: 'pass', id: pass.flag.pid, n: pass.flag.n, text: `Nên cho libero ôm rộng sang phía ${fullP(m, pass.flag.pid)}: đỡ bước 1 trung bình ${dec(pass.flag.avg)}/3 (${pass.flag.n} lần), thấp rõ so với cả đội.` });
  if (serve) weak.push({ k: 'serve', n: st.bpN, text: `Nên phát an toàn hơn: ${st.se} lần hỏng, ${st.ace} ace trong ${st.bpN} lượt ta phát.` });
  if (ownF) weak.push({ k: 'own', n: st.lost, text: `Nên bớt đánh mạo hiểm: ${own}/${st.lost} điểm mất là ta tự lỗi.` });
  if (recvF) weak.push({ k: 'recv', n: r.goodN + r.badN, text: `Đỡ bước 1 đang quyết định side-out: bóng đỡ ≥2 giành ${r.goodW}/${r.goodN}, bóng ≤1 chỉ ${r.badW}/${r.badN} — nên ưu tiên đỡ an toàn vào giữa.` });
  return { st, pl, rot, atk, pass, weak, own };
}
// Câu nói sự việc khi CHƯA qua cổng (dùng ở câu tóm Hội ý và thẻ "Đang yếu ở").
export function rotFact(rot) {
  const w = rot.worst;
  if (!w || w.won >= w.lost) return null;
  if (rot.act.length === 1) return `Mới có số ở ${w.k} (thắng ${w.won}/${w.n}), chưa có vòng khác để so — chưa đủ chắc để kết luận.`;
  return `${w.k} đang thua nhiều nhất (thắng ${w.won}/${w.n}) — chưa đủ chắc để kết luận.`;
}

function adviceOf(m, R, setN) {
  const sg = signals(m, R, setN);
  const top = sg.weak[0];
  if (top) return { text: top.text, tag: cert(top.n), n: top.n };
  const f = rotFact(sg.rot); // dưới cổng: chỉ kể sự việc, cùng vòng với câu tóm Hội ý
  return { text: f || `Chưa đủ chắc để khuyên đổi chiến thuật: cần ≥${N_MIN} pha ở cùng một vòng / một người và chênh lệch vượt sai số.`, tag: cert(f ? sg.rot.worst.n : 0), n: f ? sg.rot.worst.n : 0, none: true };
}

// ---------- Dữ liệu biểu đồ xu hướng ----------
const W_UP = ['atk', 'blk', 'ace', 'oer', 'uw'];
const W_DN = ['oat', 'bkd', 'rer', 'aer', 'ser', 'xer', 'ul'];
export function trendData(m, R, setN, win = 10, chunk = 5) {
  const rs = rsOf(R, setN);
  const marks = [];
  rs.forEach((r, i) => { if (i && r.set !== rs[i - 1].set) marks.push({ i, text: 'S' + r.set }); });
  const so = [], bp = [];
  const lastSo = [], lastBp = [];
  for (const r of rs) {
    const q = r.serve === 'them' ? lastSo : lastBp;
    q.push(r.win ? 1 : 0); if (q.length > win) q.shift();
    const rate = (a) => (a.length >= 3 ? a.reduce((x, y) => x + y, 0) / a.length : null);
    so.push(rate(lastSo)); bp.push(rate(lastBp));
  }
  const chunks = [];
  for (let i = 0; i < rs.length; i += chunk) {
    const part = rs.slice(i, i + chunk);
    const c = { from: i + 1, to: i + part.length, up: {}, dn: {} };
    for (const k of W_UP) c.up[k] = part.filter((r) => r.how === k).length;
    for (const k of W_DN) c.dn[k] = part.filter((r) => r.how === k).length;
    chunks.push(c);
  }
  const rot = {};
  for (let k = 1; k <= 6; k++) rot['P' + k] = [];
  const acc = {};
  for (const r of rs) { acc[r.rot] = (acc[r.rot] || 0) + (r.win ? 1 : -1); rot[r.rot].push(acc[r.rot]); }
  const pl = playerRows(m, R, setN).filter((p) => p.pts > 0).slice(0, 3);
  const cum = pl.map((p) => {
    let c = 0;
    return { pid: p.pid, v: rs.map((r) => (c += r.p === p.pid && ['atk', 'blk', 'ace'].includes(r.how) ? 1 : 0)) };
  });
  const srv = rs.filter((r) => r.serve === 'us');
  let a = 0, e = 0;
  const serve = { ace: srv.map((r) => (a += r.how === 'ace' ? 1 : 0)), se: srv.map((r) => (e += r.how === 'ser' ? 1 : 0)) };
  return {
    n: rs.length, marks,
    us: rs.map((r) => r.usA), them: rs.map((r) => r.themA), margin: rs.map((r) => r.usA - r.themA),
    so, bp, soN: rs.filter((r) => r.serve === 'them').length, bpN: srv.length, win,
    chunks, chunk, rot, cum, serve,
  };
}

// ---------- Thẻ trả lời (artifact) của Trợ lý hội ý ----------
// Mỗi thẻ: { kind, title, answer, n, nText, cert, chart, table: {head, rows}, note }.
const baseArt = (kind, title, setN) => ({ kind, title, scope: scopeLabel(setN) });

export function artRot(m, R, setN) {
  const st = stats(m, R, setN);
  const a = baseArt('rot', 'Xoay vòng nào đang mất điểm?', setN);
  a.table = { head: ['Vòng', 'Pha', 'Thắng–thua', 'Đỡ phát (SO)', 'Ta phát (BP)'], rows: st.rot.map((x) => [x.k, x.n, `${x.won}–${x.lost}`, frac(x.soW, x.soN), frac(x.bpW, x.bpN)]) };
  a.chart = { type: 'pair', legend: [['a', 'Khi đối thủ phát'], ['b', 'Khi ta phát']],
    items: st.rot.map((x) => ({ label: x.k, a: x.soN ? x.soW / x.soN : null, an: `${x.soW}/${x.soN}`, b: x.bpN ? x.bpW / x.bpN : null, bn: `${x.bpW}/${x.bpN}` })) };
  const rk = rotRank(st);
  const act = rk.act;
  if (!act.length) return { ...a, answer: 'Chưa có pha nào trong phạm vi này.', n: 0, nText: '0 pha', cert: cert(0) };
  if (!st.lost) return { ...a, answer: `Chưa vòng nào mất điểm: ta thắng cả ${st.n} pha (${act.map((x) => `${x.k} ${x.won}`).join(', ')}) — ${NO_ADVICE} theo vòng.`, n: st.n, nText: `${st.n} pha`, cert: cert(Math.max(...act.map((x) => x.n))) };
  const w = rk.worst, f = rk.flag;
  const line = (x) => `thắng ${x.won}/${x.n} (${pct(x.won, x.n)})${x.soN ? `, side-out ${frac(x.soW, x.soN)}` : ''}`;
  let ans, n;
  if (f) {
    const { rw, rn } = rk.rest(f);
    ans = `Vòng ${f.k} đang mất điểm rõ nhất: ${line(f)}; các vòng khác thắng ${frac(rw, rn)}. Chênh lệch vượt sai số — nên xem lại đội hình / cách đỡ phát ở vòng này.`;
    if (w !== f) ans += ` ${w.k} còn thấp hơn (${w.won}/${w.n}) nhưng mới ${w.n} pha — chưa đủ chắc.`;
    n = f.n;
  } else {
    ans = act.length === 1 ? `Mới có số ở ${w.k}: ${line(w)}` : `Vòng ${w.k} đang thua nhiều nhất: ${line(w)}`;
    if (act.length === 1) ans += ` — các vòng khác chưa có pha nào để so; ${NO_ADVICE}.`;
    else if (w.n < N_MIN) ans += ` — mới ${w.n} pha, ${NO_ADVICE}.`;
    else { const { rw, rn } = rk.rest(w); ans += `; chênh với các vòng khác (thắng ${rw}/${rn}) còn trong sai số — ${NO_ADVICE}.`; }
    n = w.n;
  }
  return { ...a, answer: ans, n, nText: `${n} pha ở ${(f || w).k} · tổng ${st.n} pha`, cert: cert(n) };
}

export function artRecv(m, R, setN) {
  const st = stats(m, R, setN);
  const r = st.recv;
  const pl = playerRows(m, R, setN).filter((p) => p.rn).sort((x, y) => x.ravg - y.ravg);
  const a = baseArt('recv', 'Đỡ bước 1 theo từng người', setN);
  a.table = { head: ['VĐV', 'Lần', 'TB /3', '0–1–2–3'], rows: [...pl.map((p) => [shortP(m, p.pid), p.rn, dec(p.ravg), p.dist.join('–')]), ...(r.n ? [['Cả đội', r.n, dec(r.sum / r.n), r.dist.join('–')]] : [])] };
  a.chart = { type: 'hbars', items: pl.map((p) => ({ label: shortP(m, p.pid), v: p.ravg, max: 3, text: dec(p.ravg), cls: p.ravg >= 2 ? 'win' : p.ravg < 1.5 ? 'lose' : 'mid' })) };
  if (!st.soN) return { ...a, answer: 'Đối thủ chưa phát quả nào trong phạm vi này — chưa có dữ liệu đỡ phát.', n: 0, nText: '0 lần chấm', cert: cert(0) };
  if (!r.n) return { ...a, answer: `Chưa chấm đỡ bước 1 lần nào (đối thủ đã phát ${st.soN} quả). Chấm 0–3 sau mỗi pha đối thủ phát để có số này.`, n: 0, nText: '0 lần chấm', cert: cert(0) };
  let ans = `Cả đội đỡ trung bình ${dec(r.sum / r.n)}/3 (${r.n} lần). Bóng đỡ ≥2: giành ${frac(r.goodW, r.goodN)}; bóng ≤1: ${frac(r.badW, r.badN)}.`;
  const pr = passRank(m, R, setN);
  if (pr.flag) ans += ` ${shortP(m, pr.flag.pid)} ${dec(pr.flag.avg)}/3 (${pr.flag.n} lần) thấp rõ so với cả đội (vượt sai số) — nên cho libero ôm rộng sang phía người này.`;
  if (pr.worst && pr.list.length > 1 && pr.worst !== pr.flag) ans += ` Thấp nhất: ${shortP(m, pr.worst.pid)} ${dec(pr.worst.avg)}/3 (${pr.worst.n} lần) — ${pr.worst.n < N_MIN ? 'n nhỏ, ' : 'chênh còn trong sai số, '}${NO_ADVICE}.`;
  return { ...a, answer: ans, n: r.n, nText: `${r.n} lần chấm`, cert: cert(r.n) };
}

export function artScor(m, R, setN) {
  const st = stats(m, R, setN);
  const pl = playerRows(m, R, setN).filter((p) => p.pts + p.err > 0);
  const a = baseArt('scor', 'Ai đang gánh điểm, ai mắc lỗi / bị chắn', setN);
  a.table = { head: ['VĐV', 'Điểm', 'TC · chắn · ace', 'Lỗi (bị chắn)', 'Ghi trừ hỏng'], rows: pl.map((p) => [shortP(m, p.pid), p.pts, `${p.k} · ${p.b} · ${p.ace}`, `${p.err} (${p.bd})`, p.eff == null ? '–' : dec(p.eff, 2)]) };
  a.chart = { type: 'div', items: pl.map((p) => ({ label: shortP(m, p.pid), up: p.pts, dn: p.err })), legend: [['win', 'Điểm ghi'], ['lose', 'Lỗi (kể cả bị chắn)']] };
  if (!pl.length) return { ...a, answer: 'Chưa có pha nào ghi rõ cầu thủ.', n: 0, nText: '0 pha có tên', cert: cert(0) };
  const top = pl[0], errT = pl.slice().sort((x, y) => y.err - x.err)[0];
  const inv = pl.reduce((s, p) => s + p.pts + p.err, 0);
  let ans = top.pts ? `${fullP(m, top.pid)} đang gánh điểm: ${top.pts} điểm (tấn công ${top.k}, chắn ${top.b}, ace ${top.ace}).` : 'Chưa ai ghi điểm trực tiếp.';
  if (errT.err) ans += ` Nhiều lỗi nhất: ${shortP(m, errT.pid)} — ${errT.err} lỗi${errT.bd ? ` (bị chắn ${errT.bd})` : ''}.`;
  const ar = atkRank(pl);
  const eTxt = (p) => `${shortP(m, p.pid)} tấn công ${p.k} ghi / ${p.ae + p.bd} hỏng (${p.att} lần)`;
  if (ar.flag) ans += ` ${eTxt(ar.flag)} — kém rõ so với cả đội (vượt sai số), nên bớt dồn bóng.`;
  if (ar.worst && ar.worst !== ar.flag) ans += ` ${eTxt(ar.worst)} — hỏng nhiều hơn ghi nhưng ${ar.worst.att < N_MIN ? `mới ${ar.worst.att} lần` : 'chênh còn trong sai số'}, ${NO_ADVICE}.`;
  return { ...a, answer: ans, n: inv, nText: `${inv} pha có tên cầu thủ`, cert: cert(inv) };
}

export function artOpp(m, R, setN) {
  const st = stats(m, R, setN);
  const s = st.src;
  const own = s.aer + s.ser + s.xer;
  const G = [['Đối thủ tấn công', s.oat], ['Ta bị chắn', s.bkd], ['Bị ace / ta đỡ hỏng', s.rer], ['Ta lỗi tấn công', s.aer], ['Ta lỗi phát bóng', s.ser], ['Ta lỗi khác', s.xer], ['Không rõ cách', s.ul]].filter(([, v]) => v);
  const a = baseArt('opp', 'Đối thủ ghi điểm bằng cách nào', setN);
  a.table = { head: ['Cách đối thủ có điểm', 'Điểm', 'Tỉ lệ'], rows: G.map(([l, v]) => [l, v, pct(v, st.lost)]) };
  a.chart = { type: 'hbars', items: G.map(([l, v]) => ({ label: l, v, max: Math.max(1, ...G.map((x) => x[1])), text: String(v), cls: 'lose' })) };
  if (!st.lost) return { ...a, answer: 'Đối thủ chưa có điểm nào trong phạm vi này.', n: 0, nText: '0 điểm mất', cert: cert(0) };
  const top = G.slice().sort((x, y) => y[1] - x[1])[0];
  let ans = `Đối thủ có ${st.lost} điểm; nhiều nhất từ ${top[0].toLowerCase()}: ${top[1]}/${st.lost} (${pct(top[1], st.lost)}).`;
  if (own) ans += ` ${own}/${st.lost} điểm là ta tự lỗi${own * 2 >= st.lost ? ' — hơn nửa, đối thủ chưa phải ép nhiều' : ''}.`;
  if (st.lost < N_MIN) ans += ` Mới ${st.lost} điểm — ${NO_ADVICE}.`;
  return { ...a, answer: ans, n: st.lost, nText: `${st.lost} điểm mất`, cert: cert(st.lost) };
}

// Chuỗi mất điểm: các đoạn ≥3 điểm thua liên tiếp trong cùng set.
export function runsOf(rs, side = false, min = 3) {
  const out = [];
  let cur = null;
  rs.forEach((r, i) => {
    const same = cur && r.win === side && rs[i - 1].set === r.set && rs[i - 1].win === side;
    if (r.win === side) { if (same) cur.rs.push(r); else { cur = { rs: [r] }; out.push(cur); } } else cur = null;
  });
  return out.filter((x) => x.rs.length >= min);
}
export function artRuns(m, R, setN) {
  const rs = rsOf(R, setN);
  const runs = runsOf(rs, false).reverse();
  const a = baseArt('runs', 'Chuỗi mất điểm gần đây', setN);
  const howTxt = (list) => { const c = {}; list.forEach((r) => (c[r.how] = (c[r.how] || 0) + 1)); return LOSE_T.filter(([k]) => c[k]).sort((x, y) => c[y[0]] - c[x[0]]).map(([k, l]) => `${l} ${c[k]}`).join(', '); };
  a.table = { head: ['Set', 'Từ tỉ số', 'Mất liền', 'Vòng', 'Cách mất'], rows: runs.slice(0, 6).map((x) => [x.rs[0].set, `${x.rs[0].usB}–${x.rs[0].themB}`, x.rs.length, [...new Set(x.rs.map((r) => r.rot))].join(', '), howTxt(x.rs)]) };
  a.chart = { type: 'seq', rallies: rs.slice(-40).map((r) => ({ w: r.win, set: r.set })) };
  const cur = currentRun(rs.filter((r) => rs.length && r.set === rs[rs.length - 1].set));
  if (!rs.length) return { ...a, answer: 'Chưa có pha nào trong phạm vi này.', n: 0, nText: '0 pha', cert: cert(0) };
  let ans;
  if (!runs.length) {
    const lens = runsOf(rs, false, 1).map((x) => x.rs.length);
    ans = `Chưa có chuỗi mất từ 3 điểm liên tiếp trở lên${lens.length ? ` (dài nhất ${Math.max(...lens)} điểm)` : ''}.`;
  } else {
    const r0 = runs[0].rs;
    ans = `Có ${runs.length} chuỗi mất ≥3 điểm; gần nhất ở set ${r0[0].set}, từ ${r0[0].usB}–${r0[0].themB} mất liền ${r0.length} điểm (${[...new Set(r0.map((r) => r.rot))].join(', ')}; ${howTxt(r0)}).`;
    const all = runs.flatMap((x) => x.rs);
    const byRot = {}; all.forEach((r) => (byRot[r.rot] = (byRot[r.rot] || 0) + 1));
    const [rk, rv] = Object.entries(byRot).sort((x, y) => y[1] - x[1])[0];
    if (runs.length >= 2) ans += all.length >= N_MIN && rv * 2 >= all.length ? ` ${rv}/${all.length} điểm trong các chuỗi rơi vào ${rk}.` : ` Các chuỗi rải ở nhiều vòng — ${NO_ADVICE}.`;
  }
  if (cur.len >= 2) ans += ` Hiện ${cur.side === 'us' ? 'ta' : 'đối thủ'} đang có chuỗi ${cur.len} điểm.`;
  return { ...a, answer: ans, n: rs.length, nText: `${rs.length} pha`, cert: cert(rs.length) };
}

// So sánh 2 phương án: 2 xoay vòng, hoặc 2 VĐV cùng vị trí. Chỉ là chuyện ĐÃ xảy ra, không phải dự đoán.
export function cmpOptions(m, R, setN) {
  const st = stats(m, R, setN);
  const pl = playerRows(m, R, setN);
  const inv = (pid) => { const p = pl.find((x) => x.pid === pid); return p ? p.pts + p.err + p.rn + p.srv : 0; };
  const pos = ['OH', 'MB', 'OP', 'S', 'L'].map((k) => ({ pos: k, label: { OH: 'Chủ công', MB: 'Phụ công', OP: 'Đối chuyền', S: 'Chuyền hai', L: 'Libero' }[k],
    players: m.players.filter((p) => p.pos === k).map((p) => ({ pid: p.id, label: shortP(m, p.id), n: inv(p.id) })) })).filter((x) => x.players.length >= 2);
  return { rots: st.rot.map((x) => ({ k: x.k, n: x.n })), pos };
}
export function artCmp(m, R, setN, o) {
  const a = baseArt('cmp', 'So sánh 2 phương án', setN);
  a.note = 'So sánh những gì đã xảy ra trong trận — không phải dự đoán.';
  if (o.type === 'rot') {
    const st = stats(m, R, setN);
    const A = st.rot.find((x) => x.k === o.a), B = st.rot.find((x) => x.k === o.b);
    a.title = `So sánh ${A.k} và ${B.k}`;
    a.table = { head: ['', A.k, B.k], rows: [['Pha', A.n, B.n], ['Thắng–thua', `${A.won}–${A.lost}`, `${B.won}–${B.lost}`], ['Tỉ lệ thắng', frac(A.won, A.n), frac(B.won, B.n)], ['Đỡ phát (SO)', frac(A.soW, A.soN), frac(B.soW, B.soN)], ['Ta phát (BP)', frac(A.bpW, A.bpN), frac(B.bpW, B.bpN)]] };
    a.chart = { type: 'pair', legend: [['a', A.k], ['b', B.k]], items: [['Thắng', 'won', 'n'], ['Đỡ phát', 'soW', 'soN'], ['Ta phát', 'bpW', 'bpN']].map(([l, w, n]) => ({ label: l, a: A[n] ? A[w] / A[n] : null, an: `${A[w]}/${A[n]}`, b: B[n] ? B[w] / B[n] : null, bn: `${B[w]}/${B[n]}` })) };
    return { ...a, ...verdict(A.k, A.won, A.n, B.k, B.won, B.n, 'thắng'), nText: `${A.k}: ${A.n} pha · ${B.k}: ${B.n} pha` };
  }
  const pl = playerRows(m, R, setN);
  const z = { k: 0, b: 0, ace: 0, ae: 0, bd: 0, se: 0, re: 0, xe: 0, srv: 0, rn: 0, rsum: 0, pts: 0, err: 0, att: 0, eff: null, ravg: null };
  const A = pl.find((p) => p.pid === o.a) || { ...z, pid: o.a }, B = pl.find((p) => p.pid === o.b) || { ...z, pid: o.b };
  const la = shortP(m, o.a), lb = shortP(m, o.b);
  a.title = `So sánh ${la} và ${lb}`;
  a.table = { head: ['', la, lb], rows: [['Điểm ghi', A.pts, B.pts], ['Tấn công ghi / hỏng', `${A.k} / ${A.ae + A.bd}`, `${B.k} / ${B.ae + B.bd}`], ['Ghi trừ hỏng', A.eff == null ? '–' : dec(A.eff, 2), B.eff == null ? '–' : dec(B.eff, 2)], ['Chắn', A.b, B.b], ['Phát: ace / hỏng / lượt', `${A.ace} / ${A.se} / ${A.srv}`, `${B.ace} / ${B.se} / ${B.srv}`], ['Đỡ bước 1 TB (lần)', A.rn ? `${dec(A.ravg)} (${A.rn})` : '–', B.rn ? `${dec(B.ravg)} (${B.rn})` : '–'], ['Tổng lỗi', A.err, B.err]] };
  a.chart = { type: 'pair', legend: [['a', la], ['b', lb]], items: [
    { label: 'Tấn công ghi', a: A.att ? A.k / A.att : null, an: `${A.k}/${A.att}`, b: B.att ? B.k / B.att : null, bn: `${B.k}/${B.att}` },
    { label: 'Đỡ bước 1', a: A.rn ? A.ravg / 3 : null, an: A.rn ? `${dec(A.ravg)}/3` : '–', b: B.rn ? B.ravg / 3 : null, bn: B.rn ? `${dec(B.ravg)}/3` : '–' },
    { label: 'Phát ăn điểm', a: A.srv ? A.ace / A.srv : null, an: `${A.ace}/${A.srv}`, b: B.srv ? B.ace / B.srv : null, bn: `${B.ace}/${B.srv}` }] };
  if (A.att || B.att) return { ...a, ...verdict(la, A.k, A.att, lb, B.k, B.att, 'tấn công ghi'), nText: `${la}: ${A.att} lần tấn công · ${lb}: ${B.att}` };
  if (A.rn || B.rn) {
    const n = Math.min(A.rn, B.rn);
    const ans = n < N_MIN ? `Đỡ bước 1: ${la} ${A.rn ? dec(A.ravg) : '–'}/3 (${A.rn} lần), ${lb} ${B.rn ? dec(B.ravg) : '–'}/3 (${B.rn} lần). Cần ≥${N_MIN} lần mỗi người — ${NO_ADVICE}.`
      : `Đỡ bước 1: ${la} ${dec(A.ravg)}/3 (${A.rn} lần), ${lb} ${dec(B.ravg)}/3 (${B.rn} lần)${Math.abs(A.ravg - B.ravg) >= 0.5 ? '.' : ` — chênh ít, ${NO_ADVICE}.`}`;
    return { ...a, answer: ans, n, nText: `${la}: ${A.rn} lần đỡ · ${lb}: ${B.rn}`, cert: cert(n) };
  }
  return { ...a, answer: `Chưa có pha nào ghi rõ ${la} hoặc ${lb} trong phạm vi này — chưa so được.`, n: 0, nText: '0 pha', cert: cert(0) };
}
function verdict(la, aw, an, lb, bw, bn, what) {
  const n = Math.min(an, bn);
  const head = `${la} ${what} ${frac(aw, an)}, ${lb} ${frac(bw, bn)}.`;
  if (n < N_MIN) return { answer: `${head} Cần ≥${N_MIN} pha mỗi bên để so — ${NO_ADVICE}.`, n, cert: cert(n) };
  const g = clearGap(aw, an, bw, bn);
  const better = aw / an >= bw / bn ? la : lb;
  return { answer: g.clear ? `${head} Chênh lệch vượt sai số: ${better} đang tốt hơn rõ trong trận này.` : `${head} Chênh lệch còn nằm trong sai số (n = ${an} và ${bn}) — chưa tách được phương án nào tốt hơn.`, n, cert: cert(n) };
}

export function artPlayer(m, R, setN, pid) {
  const p = playerRows(m, R, setN).find((x) => x.pid === pid);
  const pp = playerById(m, pid);
  const a = baseArt('player', `${fullP(m, pid)}${pp && pp.pos ? ' · ' + POS_SHORT[pp.pos] : ''}`, setN);
  const x = p || { k: 0, b: 0, ace: 0, ae: 0, bd: 0, se: 0, re: 0, xe: 0, srv: 0, rn: 0, pts: 0, err: 0, att: 0, eff: null, ravg: null, dist: [0, 0, 0, 0] };
  a.table = { head: ['Chỉ số', 'Số'], rows: [['Điểm ghi (TC · chắn · ace)', `${x.pts} (${x.k} · ${x.b} · ${x.ace})`], ['Tấn công hỏng / bị chắn', `${x.ae} / ${x.bd}`], ['Ghi trừ hỏng', x.eff == null ? '–' : dec(x.eff, 2)], ['Phát: lượt / ace / hỏng', `${x.srv} / ${x.ace} / ${x.se}`], ['Đỡ bước 1 TB (lần)', x.rn ? `${dec(x.ravg)}/3 (${x.rn})` : '–'], ['Đỡ hỏng / lỗi khác', `${x.re} / ${x.xe}`]] };
  a.chart = { type: 'hbars', items: [['Ghi điểm', x.pts, 'win'], ['Lỗi', x.err, 'lose'], ['Lượt phát', x.srv, 'mid'], ['Lần đỡ bước 1', x.rn, 'mid']].map(([l, v, c]) => ({ label: l, v, max: Math.max(1, x.pts, x.err, x.srv, x.rn), text: String(v), cls: c })) };
  const inv = x.pts + x.err + x.srv + x.rn;
  if (!inv) return { ...a, answer: `${fullP(m, pid)} chưa có pha nào được ghi tên trong phạm vi này.`, n: 0, nText: '0 pha', cert: cert(0) };
  let ans = `${fullP(m, pid)}: ${x.pts} điểm (tấn công ${x.k}, chắn ${x.b}, ace ${x.ace}), ${x.err} lỗi.`;
  if (x.att) ans += ` Tấn công ${x.k}/${x.att} lần kết thúc pha${x.att < N_MIN ? ' — n nhỏ' : ''}.`;
  if (x.rn) ans += ` Đỡ bước 1 ${dec(x.ravg)}/3 (${x.rn} lần).`;
  if (inv < N_MIN) ans += ` ${NO_ADVICE[0].toUpperCase() + NO_ADVICE.slice(1)} về người này.`;
  return { ...a, answer: ans, n: inv, nText: `${inv} pha có tên`, cert: cert(inv) };
}

export function artNotOurs(m, R, setN, num) {
  const a = baseArt('notOurs', `Số ${num}`, setN);
  return { ...a, answer: `Đội ta (${m.teamName || 'đội nhà'}) không có số ${num}, nên mình chưa trả lời được câu này. Trợ lý chỉ phân tích các pha của trận ta đang ghi — không có số liệu riêng về cầu thủ đối thủ. Hồ sơ cầu thủ ${m.opponent || 'đối thủ'} (nếu đã dựng) nằm ở Báo cáo đối thủ.`,
    n: 0, nText: '0 pha', cert: cert(0), link: { href: '#/scout', text: 'Mở báo cáo đối thủ' } };
}
export const CAN_ANSWER = 'xoay vòng mất điểm, đỡ bước 1, ai ghi điểm / mắc lỗi, đối thủ ghi điểm thế nào, chuỗi mất điểm, so sánh 2 vòng hoặc 2 người, hoặc một VĐV theo tên / số áo';
export function artOverview(m, R, setN, unknown = false) {
  const st = stats(m, R, setN);
  const a = baseArt('overview', 'Tổng quan', setN);
  a.table = { head: ['Chỉ số', 'Số'], rows: [['Pha', st.n], ['Thắng – thua pha', `${st.won}–${st.lost}`], ['Đỡ phát (side-out)', frac(st.soW, st.soN)], ['Ta phát (break-point)', frac(st.bpW, st.bpN)], ['Set', `${R.winsUs}–${R.winsThem}`]] };
  a.chart = { type: 'hbars', items: WIN_T.concat(LOSE_T).filter(([k]) => st.src[k]).map(([k, l]) => ({ label: l, v: st.src[k], max: Math.max(1, ...Object.values(st.src)), text: String(st.src[k]), cls: WIN_T.some((w) => w[0] === k) ? 'win' : 'lose' })) };
  const c = nowConclusions(m, R, setN);
  const ans = (unknown ? `Mình chưa rõ câu này hỏi gì nên gửi tổng quan. Mình trả lời được: ${CAN_ANSWER}. ` : '') + c.bullets.slice(0, 3).map((b) => b.text).join(' ');
  return { ...a, answer: ans, n: st.n, nText: `${st.n} pha`, cert: cert(st.n) };
}

// ---------- Hiểu câu hỏi tự do (không cần AI) ----------
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const clean = (x) => fold(x).replace(/[^\w#]+/g, ' ').trim(); // tên có ký tự lạ (C++, (Mai)…) không làm vỡ biểu thức
export function matchIntent(q, m) {
  const t = ' ' + fold(q).replace(/[^\w#]+/g, ' ') + ' ';
  const pids = [];
  for (const mm of t.matchAll(/(?:#|\bso ao |\bso )\s*(\d{1,2})\b/g)) { const p = m.players.find((x) => String(x.num) === mm[1]); if (p && !pids.includes(p.id)) pids.push(p.id); }
  for (const p of m.players) {
    if (pids.includes(p.id) || !p.name) continue;
    const words = clean(p.name).split(' ').filter((w) => w.length >= 3);
    const full = clean(p.name);
    const last = words[words.length - 1];
    if (full.length >= 5 && t.includes(' ' + full + ' ')) pids.push(p.id);
    else if (last && new RegExp(`(^|[^\\w])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`).test(t) && m.players.filter((x) => x.name && clean(x.name).split(' ').filter((w) => w.length >= 3).pop() === last).length === 1) pids.push(p.id);
  }
  // Số áo không có trong đội ta (vd hỏi số 36 của đối thủ) → nói thẳng là trợ lý không có số liệu người đó, không trả lời lạc đề.
  const nums = [...t.matchAll(/(?:#|\bso ao |\bso )\s*(\d{1,3})\b/g)].map((x) => x[1]);
  const foreign = nums.find((n) => !m.players.some((x) => String(x.num) === n));
  if (foreign && !pids.length) return { k: 'notOurs', num: foreign };
  const rots = [...new Set([...t.matchAll(/\b(?:p|vong )([1-6])\b/g)].map((x) => 'P' + x[1]))];
  if (/so sanh|\bvs\b|\bhay la\b|khac nhau|\bvoi\b.*\bai\b/.test(t)) {
    if (rots.length >= 2) return { k: 'cmp', o: { type: 'rot', a: rots[0], b: rots[1] } };
    if (pids.length >= 2) return { k: 'cmp', o: { type: 'player', a: pids[0], b: pids[1] } };
    return { k: 'cmpBuild' };
  }
  if (pids.length) return { k: 'player', pid: pids[0] };
  if (/chuoi|lien tiep|gan day|mat lien|lien mach/.test(t)) return { k: 'runs' };
  if (/doi thu|doi phuong|ben kia|ho ghi|bi ghi|mat diem (bang|vi|do|the nao)/.test(t)) return { k: 'opp' };
  if (/do buoc|buoc 1|buoc mot|do bong|do phat|nhan bong|chuyen 1|\bdo 1\b|\bpass|\bdo (tot|kem|te)\b/.test(t)) return { k: 'recv' };
  if (/xoay|\bvong\b|\bp[1-6]\b|side ?out|break ?point|quyen phat/.test(t)) return { k: 'rot' };
  if (/ghi diem|ganh|tan cong|\bdap\b|\bloi\b|bi chan|chan bong|\bace\b|phat bong|hieu suat|\bai\b/.test(t)) return { k: 'scor' };
  return { k: 'overview' };
}

// Văn bản để "Sao chép" một thẻ (dán Zalo / ghi chú).
export function artText(a) {
  const rows = a.table && a.table.rows.length ? '\n' + [a.table.head, ...a.table.rows].map((r) => r.join(' | ')).join('\n') : '';
  return `${a.title} · ${a.scope}\n${a.answer}${rows}\nn = ${a.nText} · ${a.cert.label}${a.note ? '\n' + a.note : ''}`;
}
