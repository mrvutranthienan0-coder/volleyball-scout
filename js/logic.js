// Logic thuần: không đụng DOM, không đụng storage.
// Mọi con số (tỉ số, set, xoay vòng, thống kê) đều được TÍNH LẠI từ nhật ký sự kiện,
// nên sửa/xoá một pha ở giữa trận thì mọi thứ phía sau tự đúng lại.

export const POSITIONS = [
  ['', '—'],
  ['S', 'Chuyền hai'],
  ['OP', 'Đối chuyền'],
  ['OH', 'Chủ công'],
  ['MB', 'Phụ công'],
  ['L', 'Libero'],
];
export const POS_SHORT = { S: 'CH', OP: 'ĐC', OH: 'CC', MB: 'PC', L: 'L', '': '' };

// Đội hình xuất phát đề xuất theo hệ 5-1: chuyền hai P1, chủ công P2/P5, phụ công P3/P6, đối chuyền P4; libero riêng.
// Lấy theo thứ tự danh sách; thiếu vị trí nào thì lấp bằng VĐV chưa dùng (ưu tiên người không phải libero).
export function suggestLineup(players) {
  const used = new Set();
  const take = (ok) => {
    const p = players.find((x) => !used.has(x.id) && ok(x));
    if (p) used.add(p.id);
    return p ? p.id : null;
  };
  const libero = take((x) => x.pos === 'L');
  const lineup = ['S', 'OH', 'MB', 'OP', 'OH', 'MB'].map((pos) => take((x) => x.pos === pos));
  for (let i = 0; i < 6; i++) lineup[i] ||= take((x) => x.pos !== 'L') || take(() => true);
  // Không đủ 6 người trên sân mà đã giữ riêng libero → cho libero vào sân thay vì để trống ô.
  const gap = lineup.indexOf(null);
  if (gap >= 0 && libero) return { lineup: lineup.map((x, i) => (i === gap ? libero : x)), libero: null };
  return { lineup, libero };
}

// who: 'pick' = hỏi cầu thủ, 'server' = tự lấy người đang phát, 'none' = không hỏi.
// need: 'us' = chỉ khi ta phát, 'them' = chỉ khi đối thủ phát.
export const HOWS = [
  { k: 'atk', win: true, label: 'Tấn công', who: 'pick' },
  { k: 'blk', win: true, label: 'Chắn bóng', who: 'pick' },
  { k: 'ace', win: true, label: 'Phát bóng ăn điểm', who: 'server', need: 'us' },
  { k: 'oer', win: true, label: 'Đối thủ lỗi', who: 'none' },
  { k: 'aer', win: false, label: 'Lỗi tấn công', who: 'pick' },
  { k: 'bkd', win: false, label: 'Bị chắn', who: 'pick' },
  { k: 'ser', win: false, label: 'Lỗi phát bóng', who: 'server', need: 'us' },
  { k: 'rer', win: false, label: 'Đỡ hỏng / bị ace', who: 'pick', need: 'them' },
  { k: 'xer', win: false, label: 'Lỗi khác', who: 'pick' },
  { k: 'oat', win: false, label: 'Đối thủ tấn công ghi điểm', who: 'none' },
  { k: 'uw', win: true, label: 'Ghi điểm (không rõ cách)', who: 'none', hidden: true },
  { k: 'ul', win: false, label: 'Mất điểm (không rõ cách)', who: 'none', hidden: true },
];
export const HOW = Object.fromEntries(HOWS.map((h) => [h.k, h]));

export const setsToWin = (m) => Math.ceil(m.bestOf / 2);
export const setTarget = (m, n) => (n >= m.bestOf ? 15 : 25);

export function playerById(m, pid) {
  return m.players.find((p) => p.id === pid) || null;
}
export function playerLabel(m, pid) {
  const p = playerById(m, pid);
  if (!p) return '—';
  return p.name ? `#${p.num} ${p.name}` : `#${p.num}`;
}

function rotate(c, steps) {
  const k = ((steps % 6) + 6) % 6;
  for (let i = 0; i < k; i++) c.order.push(c.order.shift());
}

function finishSet(S, m, c, winner) {
  c.over = true;
  c.winner = winner;
  if (winner === 'us') S.winsUs++;
  if (winner === 'them') S.winsThem++;
  const need = setsToWin(m);
  if (S.winsUs >= need || S.winsThem >= need) {
    S.over = true;
    S.winner = S.winsUs > S.winsThem ? 'us' : 'them';
  }
}

// Tính lại toàn bộ trạng thái trận từ m.events.
// Điểm đỡ bước 1 chỉ nhận số nguyên 0–3; giá trị lạ (vd file nhập rc:5) coi như chưa chấm, không đưa vào số liệu.
export const okRc = (x) => Number.isInteger(x) && x >= 0 && x <= 3;
export function replay(m) {
  const S = { sets: [], cur: null, over: false, winner: null, winsUs: 0, winsThem: 0, rallies: [], ignored: [], forced: [] };
  m.events.forEach((ev, i) => {
    const c = S.cur;
    if (ev.t === 'chk') return; // đối soát tỉ số: chỉ để lưu vết, không đổi trạng thái
    if (ev.t === 'endmatch') {
      if (c && !c.over) c.over = true;
      S.over = true;
      S.manualEnd = true;
      if (!S.winner && S.winsUs !== S.winsThem) S.winner = S.winsUs > S.winsThem ? 'us' : 'them';
      return;
    }
    if (ev.t === 'start') {
      if (S.over) return S.ignored.push(i);
      // Set trước chưa kết thúc (vd do sửa/xoá pha) → đóng set đó lại, không để pha set sau tràn vào.
      if (c && !c.over) {
        S.forced.push(c.n); // set chưa đủ điểm mà đã sang set mới → cảnh báo, không im lặng
        finishSet(S, m, c, c.us === c.them ? null : c.us > c.them ? 'us' : 'them');
      }
      if (S.over) return S.ignored.push(i);
      // Đội hình hỏng (vd file cũ lineup: []) → báo lỗi rõ để màn hiện trạng thái lỗi, không tính ra xoay vòng "P0".
      if (!Array.isArray(ev.lineup) || ev.lineup.length !== 6 || ev.lineup.some((x) => typeof x !== 'string' || !x)) throw new Error(`Đội hình xuất phát set ${S.sets.length + 1} không hợp lệ (cần đúng 6 VĐV).`);
      const order = ev.lineup.slice();
      const setter = order.find((pid) => (playerById(m, pid) || {}).pos === 'S');
      S.cur = {
        n: S.sets.length + 1, order, lineup: order.slice(), libero: ev.libero || null,
        serve: ev.server, firstServer: ev.server, ref: setter || order[0],
        us: 0, them: 0, count: 0, over: false, winner: null, to: { us: 0, them: 0 }, subs: 0,
      };
      S.sets.push(S.cur);
      return;
    }
    if (!c || c.over || S.over) return S.ignored.push(i);
    if (ev.t === 'r') {
      const h = HOW[ev.how];
      if (!h) return S.ignored.push(i);
      const rec = {
        i, set: c.n, no: ++c.count, usB: c.us, themB: c.them, serve: c.serve,
        rot: 'P' + (c.order.indexOf(c.ref) + 1), server: c.serve === 'us' ? c.order[0] : null,
        win: h.win, how: ev.how, p: ev.p ?? null, rc: ev.how === 'rer' ? 0 : okRc(ev.rc) ? ev.rc : null,
        rp: ev.rp ?? (ev.how === 'rer' ? ev.p ?? null : null),
      };
      if (h.win) {
        c.us++;
        if (c.serve === 'them') { rotate(c, 1); c.serve = 'us'; }
      } else {
        c.them++;
        c.serve = 'them';
      }
      rec.usA = c.us; rec.themA = c.them;
      S.rallies.push(rec);
      const t = setTarget(m, c.n);
      if ((c.us >= t || c.them >= t) && Math.abs(c.us - c.them) >= 2) finishSet(S, m, c, c.us > c.them ? 'us' : 'them');
    } else if (ev.t === 'sub') {
      if (ev.out === c.libero) { c.libero = ev.in; c.subs++; return; }
      const idx = c.order.indexOf(ev.out);
      if (idx < 0 || c.order.includes(ev.in)) return S.ignored.push(i);
      c.order[idx] = ev.in;
      if (c.ref === ev.out) c.ref = ev.in;
      c.subs++;
    } else if (ev.t === 'to') {
      c.to[ev.side]++;
    } else if (ev.t === 'fix') {
      if (ev.rot) rotate(c, ev.rot);
      if (ev.serve) c.serve = ev.serve;
    } else if (ev.t === 'endset') {
      finishSet(S, m, c, c.us === c.them ? null : c.us > c.them ? 'us' : 'them');
    }
  });
  S.needStart = !S.over && (!S.cur || S.cur.over);
  return S;
}

// Người phát đầu mặc định cho set tiếp theo: set chẵn đổi bên so với set 1.
export function defaultServer(m, R) {
  const first = R.sets[0] ? R.sets[0].firstServer : m.firstServer;
  const n = R.sets.length + 1;
  return n % 2 === 0 ? (first === 'us' ? 'them' : 'us') : first;
}

// Chuỗi điểm hiện tại (tính từ cuối danh sách pha).
export function currentRun(rallies) {
  if (!rallies.length) return { side: null, len: 0 };
  const w = rallies[rallies.length - 1].win;
  let len = 0;
  for (let i = rallies.length - 1; i >= 0 && rallies[i].win === w; i--) len++;
  return { side: w ? 'us' : 'them', len };
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
export const dec = (x, d = 1) => x.toFixed(d).replace('.', ',');

// ---------- Cổng lời khuyên DÙNG CHUNG cho mọi màn (Hội ý, Kết luận hiện tại, Các pha, Trợ lý, Số liệu nói gì) ----------
// Chỉ coi là "kém rõ" khi mẫu ≥ N_MIN VÀ chênh lệch với phần còn lại vượt sai số. analysis.js dùng lại đúng các hàm này.
export const N_MIN = 8;
// Hai tỉ lệ a/n1 và b/n2 khác nhau thật hay chỉ do mẫu nhỏ (kiểm định z hai tỉ lệ, |z| ≥ 1,64).
export function clearGap(a, n1, b, n2) {
  if (n1 < N_MIN || n2 < N_MIN) return { clear: false, small: true };
  const p = (a + b) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const z = se ? (a / n1 - b / n2) / se : 0;
  return { clear: Math.abs(z) >= 1.64, small: false, z };
}
// Hai dãy điểm (vd điểm đỡ 0–3) khác nhau thật hay không (kiểm định t Welch gần đúng, |t| ≥ 1,64).
export function meanGap(a, b) {
  if (a.length < N_MIN || b.length < N_MIN) return { clear: false, small: true };
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const vr = (x, mu) => x.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, x.length - 1);
  const ma = mean(a), mb = mean(b);
  const se = Math.sqrt(vr(a, ma) / a.length + vr(b, mb) / b.length);
  const t = se ? (ma - mb) / se : 0;
  return { clear: Math.abs(t) >= 1.64, small: false, t };
}
// Xoay vòng: low = tỉ lệ thắng thấp nhất (mọi n); flag = vòng kém rõ (qua cổng). Cùng thứ tự xếp ở mọi màn.
export function rotGate(rotList, won, n) {
  const act = rotList.filter((x) => x.n);
  const rate = (x) => x.won / x.n;
  const bad = (x, y) => rate(x) - rate(y) || y.lost - x.lost;
  const pass = (x) => { const rw = won - x.won, rn = n - x.n; return x.n >= N_MIN && rn > 0 && rate(x) < rw / rn && clearGap(x.won, x.n, rw, rn).clear; };
  return { act, low: act.slice().sort(bad)[0] || null, flag: act.filter(pass).sort(bad)[0] || null };
}
// Người tấn công kém rõ: ghi / lần kết thúc pha thấp rõ so với phần còn lại của đội. p cần { k, ae, bd }.
export function atkFlagOf(list) {
  const act = list.filter((p) => p.k + p.ae + p.bd > 0);
  const tk = act.reduce((s, p) => s + p.k, 0), ta = act.reduce((s, p) => s + p.k + p.ae + p.bd, 0);
  const eff = (p) => (p.k - p.ae - p.bd) / (p.k + p.ae + p.bd);
  return act.filter((p) => { const att = p.k + p.ae + p.bd, rk = tk - p.k, ra = ta - att; return eff(p) < 0 && att >= N_MIN && ra > 0 && p.k / att < rk / ra && clearGap(p.k, att, rk, ra).clear; })
    .sort((x, y) => eff(x) - eff(y) || String(x.pid).localeCompare(String(y.pid)))[0] || null;
}
// Người đỡ bước 1 kém rõ: điểm đỡ thấp rõ so với phần còn lại của đội. list = [{ pid, v: [điểm đỡ…] }], all = mọi điểm đỡ kèm rp.
export function passFlagOf(list, all) {
  const avg = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return list.map((q) => ({ ...q, n: q.v.length, avg: avg(q.v) }))
    .filter((q) => { const o = all.filter((r) => r.rp !== q.pid).map((r) => r.rc); return o.length && q.avg < avg(o) && meanGap(q.v, o).clear; })
    .sort((x, y) => x.avg - y.avg || String(x.pid).localeCompare(String(y.pid)))[0] || null;
}

// Thống kê cho màn HLV. setN = null → cả trận.
export function stats(m, R, setN) {
  const rs = R.rallies.filter((r) => !setN || r.set === setN);
  const rot = {};
  for (let k = 1; k <= 6; k++) rot['P' + k] = { k: 'P' + k, won: 0, lost: 0, soW: 0, soN: 0, bpW: 0, bpN: 0 };
  const src = {};
  HOWS.forEach((h) => (src[h.k] = 0));
  const pl = {};
  const P = (pid) => (pl[pid] ||= { pid, k: 0, ae: 0, bd: 0, b: 0, ace: 0, se: 0, re: 0, xe: 0 });
  const recv = { n: 0, sum: 0, dist: [0, 0, 0, 0], goodN: 0, goodW: 0, badN: 0, badW: 0 };
  const pass = {};
  let won = 0, lost = 0;
  for (const r of rs) {
    const x = rot[r.rot];
    if (r.win) { won++; x.won++; } else { lost++; x.lost++; }
    if (r.serve === 'them') { x.soN++; if (r.win) x.soW++; } else { x.bpN++; if (r.win) x.bpW++; }
    src[r.how]++;
    if (r.p) {
      const s = P(r.p);
      const f = { atk: 'k', aer: 'ae', bkd: 'bd', blk: 'b', ace: 'ace', ser: 'se', rer: 're', xer: 'xe' }[r.how];
      if (f) s[f]++;
    }
    if (r.serve === 'them' && typeof r.rc === 'number') {
      recv.n++; recv.sum += r.rc; recv.dist[r.rc]++;
      if (r.rc >= 2) { recv.goodN++; if (r.win) recv.goodW++; } else { recv.badN++; if (r.win) recv.badW++; }
      if (r.rp) { const q = (pass[r.rp] ||= { pid: r.rp, n: 0, sum: 0 }); q.n++; q.sum += r.rc; }
    }
  }
  const players = Object.values(pl).map((s) => {
    const e = s.ae + s.bd;
    return { ...s, e, eff: s.k + e ? (s.k - e) / (s.k + e) : null };
  });
  const byNum = (a, b) => ((playerById(m, a.pid) || {}).num || 0) - ((playerById(m, b.pid) || {}).num || 0);
  players.sort(byNum);
  const passers = Object.values(pass).map((q) => ({ ...q, avg: q.sum / q.n })).sort(byNum);
  const rotList = Object.values(rot).map((x) => ({ ...x, n: x.won + x.lost, diff: x.won - x.lost }));
  // Vòng yếu nhất: vòng kém rõ (qua cổng) nếu có, không thì vòng tỉ lệ thắng thấp nhất đang thua nhiều hơn thắng.
  const rg = rotGate(rotList, won, rs.length);
  const worst = rg.flag || (rg.low && rg.low.won < rg.low.lost ? rg.low : null);
  const rcs = rs.filter((r) => r.serve === 'them' && typeof r.rc === 'number');
  const pv = {};
  rcs.forEach((r) => { if (r.rp) (pv[r.rp] ||= []).push(r.rc); });
  const passFlag = passFlagOf(Object.entries(pv).map(([pid, v]) => ({ pid, v })), rcs);
  const soN = rs.filter((r) => r.serve === 'them').length;
  const soW = rs.filter((r) => r.serve === 'them' && r.win).length;
  const bpN = rs.length - soN;
  const bpW = won - soW;
  return {
    n: rs.length, won, lost, rot: rotList, worst, worstFlag: !!rg.flag, rotLow: rg.low,
    atkFlag: atkFlagOf(players), passFlag,
    src, players, passers, recv, run: currentRun(rs), soN, soW, bpN, bpW,
    ace: src.ace, se: src.ser,
  };
}

// 1–3 nhận định dựa trên luật cố định. Viết dạng QUAN SÁT kèm số làm bằng chứng,
// không ra lệnh chiến thuật — HLV tự quyết.
export function insights(m, st, isCurrentSet) {
  if (st.n < 6) return [{ text: `Chưa đủ dữ liệu để nhận định: mới có ${st.n} pha (cần ít nhất 6).`, sev: 0 }];
  const out = [];
  const add = (sev, text) => out.push({ sev, text, order: out.length });
  const name = (pid) => playerLabel(m, pid);

  // Cùng cổng với lời khuyên: có người / vòng kém rõ thì nêu đúng người / vòng đó; chưa qua cổng thì chỉ kể số + "chưa đủ chắc".
  const unsure = (ok) => (ok ? '' : ' — chưa đủ chắc để kết luận');
  const w = st.worst;
  if (w && w.n >= 4 && w.diff <= -2) {
    add(10 + (w.lost - w.won) * 2, `Xoay vòng ${w.k} đang thua điểm: thắng ${w.won}/${w.n} pha (${w.diff}); khi đối thủ phát, ta giành ${pct(w.soW, w.soN)}${unsure(st.worstFlag)}.`);
  }
  if (isCurrentSet && st.run.side === 'them' && st.run.len >= 3) {
    add(10 + st.run.len * 2, `Đối thủ đang có chuỗi ${st.run.len} điểm liên tiếp.`);
  }
  const r = st.recv;
  if (r.n >= 5 && r.sum / r.n < 1.8) {
    add(8 + Math.round((1.8 - r.sum / r.n) * 10), `Đỡ bước 1 cả đội trung bình ${dec(r.sum / r.n)}/3 (${r.n} lần); khi đối thủ phát, ta giành ${pct(st.soW, st.soN)}.`);
  }
  let weak = st.passFlag ? st.passers.find((p) => p.pid === st.passFlag.pid) : null;
  if (!weak) for (const p of st.passers) if (p.n >= 4 && p.avg < 1.5 && (!weak || p.avg < weak.avg)) weak = p;
  if (weak) add(7 + Math.round((1.5 - weak.avg) * 10), `${name(weak.pid)} đỡ bước 1 trung bình ${dec(weak.avg)}/3 (${weak.n} lần)${unsure(st.passFlag && st.passFlag.pid === weak.pid)}.`);
  if (st.se >= 3 && st.se > st.ace * 2) {
    add(6 + st.se - st.ace, `Phát bóng: ${st.se} lần hỏng, ${st.ace} lần ăn điểm trực tiếp trong ${st.bpN} lượt ta phát.`);
  }
  let bad = st.atkFlag;
  if (!bad) for (const p of st.players) {
    if (p.e >= 3 && p.e > p.k && (!bad || p.e - p.k > bad.e - bad.k)) bad = p;
  }
  if (bad) add(6 + (bad.e - bad.k) * 2, `${name(bad.pid)} tấn công ${bad.k} ghi / ${bad.e} hỏng (lỗi ${bad.ae}, bị chắn ${bad.bd})${unsure(bad === st.atkFlag)}.`);
  if (st.lost >= 6 && st.src.oat / st.lost >= 0.4 && st.src.oat >= 4) {
    add(5 + st.src.oat, `Đối thủ ghi ${st.src.oat}/${st.lost} điểm bằng tấn công (${pct(st.src.oat, st.lost)} số điểm ta mất).`);
  }
  const own = st.src.aer + st.src.ser + st.src.xer;
  if (st.lost >= 6 && own / st.lost >= 0.5) {
    add(4 + own, `Ta tự mắc lỗi ${own}/${st.lost} điểm mất (${pct(own, st.lost)}).`);
  }
  let hot = null;
  for (const p of st.players) if (p.k >= 4 && p.eff >= 0.5 && (!hot || p.k > hot.k)) hot = p;
  if (hot) add(3 + hot.k / 2, `${name(hot.pid)} đang tấn công hiệu quả: ${hot.k} ghi / ${hot.e} hỏng.`);
  if (!out.length) return [{ text: `Không có điểm bất thường sau ${st.n} pha (thắng ${st.won}, thua ${st.lost}).`, sev: 0 }];
  out.sort((a, b) => b.sev - a.sev || a.order - b.order);
  return out.slice(0, 3);
}

export function setScores(R) {
  return R.sets.map((s) => `${s.us}–${s.them}`);
}
