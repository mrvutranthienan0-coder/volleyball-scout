// Lớp AI trực tiếp: nói để ghi pha (Jev hiểu câu), hỏi AI lúc hội ý (Claude), cảnh báo xu hướng (Jev).
// Mọi lời gọi đi qua máy chủ nhỏ giữ khoá (worker/). App chỉ giữ ĐỊA CHỈ máy chủ + MÃ ĐỘI, không giữ khoá AI.
// Không có mạng / quá giờ / chưa cài → trả lỗi có message tiếng Việt, app giữ nguyên cách ghi tay.
// Pha trả về đúng định dạng nhật ký của app: { t: 'r', how, p, ts } (xem README "Lược đồ JSON").
import { HOW, HOWS } from './logic.js';
import { aiData } from './ai.js';

const LS = 'vbs.ai';
export const OFFLINE_MSG = 'Không có mạng — ghi tay';
const DEFAULT_TIMEOUT = 9000; // máy chủ tự cắt ở 8 giây, app chờ thêm 1 giây cho đường truyền

// ---------- Cấu hình (localStorage, bọc try/catch) ----------
export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LS) || '{}');
    return { url: String(c.url || ''), code: String(c.code || ''), timeoutMs: +c.timeoutMs || DEFAULT_TIMEOUT };
  } catch { return { url: '', code: '', timeoutMs: DEFAULT_TIMEOUT }; }
}
export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  next.url = String(next.url || '').trim().replace(/\/+$/, '');
  next.code = String(next.code || '').trim();
  try { localStorage.setItem(LS, JSON.stringify(next)); return true; } catch { return false; }
}
export const isConfigured = () => { const c = getConfig(); return !!(c.url && c.code); };

// ---------- Gọi máy chủ ----------
const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
async function call(path, body) {
  const cfg = getConfig();
  if (!cfg.url || !cfg.code) return err('not_configured', 'Chưa cài máy chủ AI — ghi tay');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return err('offline', OFFLINE_MSG, { offline: true });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Code': cfg.code },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!j) return err('bad_response', 'Máy chủ AI trả về dữ liệu lạ — ghi tay');
    return j.ok ? j : err(j.error?.code || 'error', j.error?.message || 'Máy chủ AI lỗi — ghi tay', { status: res.status });
  } catch (e) {
    if (e.name === 'AbortError') return err('timeout', 'AI trả lời chậm — ghi tay', { offline: false });
    const off = typeof navigator !== 'undefined' && navigator.onLine === false;
    return err(off ? 'offline' : 'network', off ? OFFLINE_MSG : 'Không gọi được máy chủ AI — ghi tay', { offline: true });
  } finally {
    clearTimeout(timer);
  }
}
export const checkConnection = () => call('/health');

// ---------- Ngữ cảnh từ trận đang ghi ----------
// m = trận (match), R = replay(m). lineup = thứ tự trên sân HIỆN TẠI (lineup[0] = người đứng P1 = người phát khi ta phát).
export function contextFromMatch(m, R) {
  return {
    roster: m.players.filter((p) => Number.isInteger(+p.num)).map((p) => ({ id: p.id, num: +p.num, name: p.name || '', pos: p.pos || '' })),
    lineup: R.cur ? R.cur.order.slice() : [],
    serving: R.cur ? R.cur.serve : 'us',
    rallyCount: R.rallies.length, // để phát hiện trận đã đổi trong lúc chờ xác nhận
  };
}

// Tạo pha theo đúng luật chọn người của app (HOWS[].who): 'none' → p null, 'server' → người đứng P1 khi ta phát.
export function rallyEvent(how, p, ctx) {
  const h = HOW[how];
  if (!h) throw new Error('how không hợp lệ: ' + how);
  let pid = p ?? null;
  if (h.who === 'none') pid = null;
  if (h.who === 'server') pid = ctx && ctx.serving === 'us' && ctx.lineup && ctx.lineup[0] ? ctx.lineup[0] : pid;
  return { t: 'r', how, p: pid, ts: Date.now() };
}

// ---------- API mức hàm ----------
export async function parseRally(text, ctx) {
  const r = await call('/parse-rally', { text, roster: ctx.roster, lineup: ctx.lineup, serving: ctx.serving });
  if (r.ok && r.event) r.event = rallyEvent(r.event.how, r.event.p, ctx);
  return r;
}
export async function askAI(question, stats, opts = {}) {
  return call('/ask', { question, stats, ...(opts.wantPlan != null ? { wantPlan: !!opts.wantPlan } : {}) });
}
// stats cho /ask lấy đúng JSON gọn mà nút "Hỏi AI" đang soạn (js/ai.js) → một nguồn số liệu.
export const askAIForMatch = (question, m, setN = null, opts) => askAI(question, aiData(m, setN), opts);

// Pha gần đây dạng gọn cho /trend (số áo thay id để Jev đọc được).
export function recentRallies(m, R, n = 20) {
  const num = (pid) => { const p = pid && m.players.find((x) => x.id === pid); return p ? +p.num : null; };
  return R.rallies.slice(-n).map((r) => ({ no: r.no, set: r.set, serve: r.serve, win: r.win, how: r.how, num: num(r.p), rp: num(r.rp), rc: r.rc, rot: r.rot }));
}
export async function checkTrend(m, R, n = 20) {
  const rallies = recentRallies(m, R, n);
  if (rallies.length < 5) return { ok: true, alert: null, why: 'too_few_rallies' };
  return call('/trend', { rallies, roster: contextFromMatch(m, R).roster });
}

// ---------- Giao diện (phong cách C: nền xám ấm, ô bo lớn, pastel) ----------
const CSS = `
.ail{--ail-ink:#1D1B20;--ail-muted:#6F6A75;--ail-bg:#F3F1EC;--ail-tile:#fff;--ail-mint:#DDF2E3;--ail-mint-d:#2E8B57;--ail-lav:#E6E1FA;--ail-lav-d:#6A55D8;--ail-peach:#FDE4D6;--ail-peach-d:#D9653B;--ail-sky:#DDEBFA;--ail-sky-d:#2F6FD1;
  font-family:'Be Vietnam Pro',system-ui,sans-serif;color:var(--ail-ink);display:flex;flex-direction:column;gap:10px}
.ail *{box-sizing:border-box}
.ail-tile{background:var(--ail-tile);border-radius:24px;padding:16px}
.ail-ptt{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border:0;border-radius:99px;background:var(--ail-ink);color:#fff;font-weight:600;font-size:16px;line-height:1.2;font-family:inherit;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}
.ail-ptt[aria-pressed=true]{background:var(--ail-peach-d)}
.ail-ptt:disabled{opacity:.5}
.ail-ptt svg{width:22px;height:22px;flex:none}
.ail-status{margin:0;font-size:14px;line-height:1.45;color:var(--ail-muted);min-height:20px}
.ail-status.ok{color:var(--ail-mint-d)} .ail-status.bad{color:var(--ail-peach-d)}
.ail-quote{font-size:15px;font-weight:600;margin:0 0 10px}
.ail-why{font-size:13px;color:var(--ail-peach-d);margin:0 0 10px}
.ail-lab{font-size:13px;font-weight:600;color:var(--ail-muted);margin:10px 0 6px}
.ail-chips{display:flex;flex-wrap:wrap;gap:8px}
.ail-chip{min-height:44px;padding:8px 14px;border-radius:99px;border:2px solid transparent;background:var(--ail-bg);color:var(--ail-ink);font-weight:600;font-size:14px;line-height:1.2;font-family:inherit;cursor:pointer}
.ail-chip[aria-pressed=true]{background:var(--ail-lav);border-color:var(--ail-lav-d)}
.ail-chip.win[aria-pressed=true]{background:var(--ail-mint);border-color:var(--ail-mint-d)}
.ail-chip.lose[aria-pressed=true]{background:var(--ail-peach);border-color:var(--ail-peach-d)}
.ail-chip small{font-weight:500;color:var(--ail-muted);margin-left:4px}
.ail-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.ail-btn{flex:1;min-height:48px;border-radius:99px;border:0;font-weight:600;font-size:15px;line-height:1.2;font-family:inherit;cursor:pointer;background:var(--ail-bg);color:var(--ail-ink)}
.ail-btn.primary{background:var(--ail-ink);color:#fff}
.ail-field{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--ail-muted)}
.ail-field input,.ail-ask input{min-height:48px;border-radius:16px;border:2px solid #E6E2DA;padding:0 14px;font-weight:500;font-size:15px;font-family:inherit;color:var(--ail-ink);background:#fff;width:100%}
.ail-answer{background:var(--ail-lav);border-radius:24px;padding:16px;font-size:15px;line-height:1.5}
.ail-answer .warn{font-size:13px;color:var(--ail-peach-d);margin-top:8px}
.ail-answer ol{margin:10px 0 0;padding-left:20px}
.ail-alert{background:var(--ail-peach);border-radius:24px;padding:16px;font-size:15px;line-height:1.45}
.ail-alert b{display:block;font-size:13px;color:var(--ail-peach-d);margin-bottom:4px}
.ail-ask{display:flex;gap:8px} .ail-ask .ail-btn{flex:none;padding:0 18px}
`;
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('ail-style')) return;
  const s = document.createElement('style');
  s.id = 'ail-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const REASON = {
  not_rally: 'Câu nói chưa giống kết quả một pha.',
  outcome_mismatch: 'Chưa rõ ta được hay mất điểm.',
  serve_mismatch: 'Cách này không khớp bên đang phát.',
  low_conf_how: 'AI chưa chắc pha kết thúc thế nào.',
  low_conf_outcome: 'AI chưa chắc ta được hay mất điểm.',
  low_conf_player: 'AI chưa chắc là ai.',
  no_player: 'Chưa nghe rõ số áo.',
  number_mismatch: 'Số áo nghe được khác số AI chọn.',
  player_from_text: 'Số áo lấy từ câu nói, kiểm lại giúp.',
};
const playerLabel = (ctx, pid) => { const p = ctx.roster.find((x) => x.id === pid); return p ? `#${p.num}${p.name ? ' ' + p.name.split(' ').slice(-1)[0] : ''}` : 'Không rõ'; };
export const describeEvent = (ev, ctx) => `${HOW[ev.how].win ? 'Ghi điểm' : 'Mất điểm'} · ${HOW[ev.how].label}${ev.p ? ' · ' + playerLabel(ctx, ev.p) : ''}`;

// Nút "Giữ để nói" + bảng xác nhận. opts: { getContext(): ctx, onRally(event, info), onManual(reason) }.
// Trả về { inject(text) (dùng khi thử/khi không có micro), el, destroy() }.
export function mountVoice(el, opts) {
  injectCss();
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  el.classList.add('ail');
  el.innerHTML = `
    <button type="button" class="ail-ptt" aria-pressed="false" data-testid="ail-ptt">${MIC}<span>${SR ? 'Giữ để nói pha vừa rồi' : 'Máy này không nghe được giọng nói'}</span></button>
    <p class="ail-status" role="status" aria-live="polite" data-testid="ail-status"></p>
    <div class="ail-tile ail-confirm" data-testid="ail-confirm" hidden></div>`;
  const btn = el.querySelector('.ail-ptt');
  const status = el.querySelector('.ail-status');
  const box = el.querySelector('.ail-confirm');
  if (!SR) btn.disabled = true;
  const say = (text, cls = '') => { status.textContent = text; status.className = 'ail-status ' + cls; };
  let busy = false, pending = false, rec = null, heard = '';
  const ctxKey = (c) => JSON.stringify([c.serving, c.lineup, c.rallyCount]);

  const manual = (reason) => { pending = false; box.hidden = true; box.innerHTML = ''; opts.onManual && opts.onManual(reason); };
  function commit(ev, info, ctx) {
    pending = false; box.hidden = true; box.innerHTML = '';
    say('Đã ghi: ' + describeEvent(ev, ctx), 'ok');
    opts.onRally(ev, info);
  }
  function showConfirm(res, ctx) {
    const f = res.fields;
    const howOpts = f.how.top.filter((x) => HOW[x.k] && !HOW[x.k].hidden).map((x) => x.k);
    if (res.event && !howOpts.includes(res.event.how)) howOpts.unshift(res.event.how);
    let how = res.event ? res.event.how : howOpts[0] || null;
    let pid = res.event ? res.event.p : null;
    const pOpts = [...new Set([...f.player.top.map((x) => x.id).filter(Boolean), ...(pid ? [pid] : []), ...ctx.lineup])];
    const draw = () => {
      const h = how && HOW[how];
      const needP = h && h.who === 'pick';
      box.innerHTML = `
        <p class="ail-quote">“${esc(res.text)}”</p>
        <p class="ail-why">${esc(res.reasons.map((r) => REASON[r]).filter(Boolean).join(' '))}</p>
        <p class="ail-lab">Pha kết thúc thế nào?</p>
        <div class="ail-chips" data-testid="ail-how">${howOpts.map((k) => `<button type="button" class="ail-chip ${HOW[k].win ? 'win' : 'lose'}" data-how="${k}" aria-pressed="${k === how}">${esc(HOW[k].label)}<small>${HOW[k].win ? 'ta được' : 'ta mất'}</small></button>`).join('')}</div>
        ${needP ? `<p class="ail-lab">Ai?</p><div class="ail-chips" data-testid="ail-player">${pOpts.map((id) => `<button type="button" class="ail-chip" data-pid="${esc(id)}" aria-pressed="${id === pid}">${esc(playerLabel(ctx, id))}</button>`).join('')}</div>` : ''}
        <div class="ail-row">
          <button type="button" class="ail-btn" data-act="manual" data-testid="ail-manual">Ghi tay</button>
          <button type="button" class="ail-btn primary" data-act="ok" data-testid="ail-ok" ${!h || (needP && !pid) ? 'disabled' : ''}>Ghi pha này</button>
        </div>`;
    };
    box.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.how) { how = b.dataset.how; draw(); }
      else if (b.dataset.pid) { pid = b.dataset.pid; draw(); }
      else if (b.dataset.act === 'manual') { say(''); manual('user'); }
      else if (b.dataset.act === 'ok') {
        // Trận đã đổi (có pha khác được ghi, đổi bên phát/xoay vòng) trong lúc bảng mở → không ghi theo ngữ cảnh cũ.
        if (ctxKey(opts.getContext()) !== ctxKey(ctx)) { say('Trận đã thay đổi trong lúc chờ — ghi tay pha này.', 'bad'); manual('stale'); return; }
        commit(rallyEvent(how, pid, ctx), { ...res, confirmed: true }, ctx);
      }
    };
    draw();
    box.hidden = false;
    pending = true;
    say('Kiểm lại rồi bấm "Ghi pha này".');
  }
  async function handle(text) {
    text = String(text || '').trim();
    if (!text) { say('Không nghe rõ — nói lại hoặc ghi tay.', 'bad'); return null; }
    if (busy) { say('Đang xử lý câu trước — nói lại sau một chút.', 'bad'); return null; }
    if (pending) { say('Còn một pha chờ xác nhận — bấm "Ghi pha này" hoặc "Ghi tay" trước.', 'bad'); return null; }
    busy = true; btn.disabled = true;
    say(`Đang hiểu: “${text}”…`);
    const ctx = opts.getContext();
    try {
      const res = await parseRally(text, ctx);
      if (!res.ok) {
        say(res.error.message, 'bad');
        box.innerHTML = `<p class="ail-quote">“${esc(text)}”</p><div class="ail-row"><button type="button" class="ail-btn primary" data-act="manual" data-testid="ail-manual">Ghi tay</button></div>`;
        box.onclick = (e) => { if (e.target.closest('[data-act=manual]')) manual(res.error.code); };
        box.hidden = false;
        return res;
      }
      if (res.needs_confirm || !res.event) showConfirm(res, ctx);
      else commit(res.event, res, ctx);
      return res;
    } catch (e) {
      say('Máy chủ AI trả về dữ liệu lạ — ghi tay.', 'bad');
      manual('bad_response');
      return null;
    } finally {
      busy = false; btn.disabled = !SR;
    }
  }

  // Giữ để nói: nhấn giữ bắt đầu nghe, thả tay thì gửi.
  function start(e) {
    if (!SR || busy || pending || rec) return;
    e && e.preventDefault();
    heard = '';
    rec = new SR();
    rec.lang = 'vi-VN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let fin = '', tmp = '';
      for (const r of ev.results) (r.isFinal ? (fin += r[0].transcript + ' ') : (tmp += r[0].transcript));
      heard = (fin + tmp).trim();
      say('Nghe: ' + heard);
    };
    rec.onerror = (ev) => {
      const m = { 'not-allowed': 'Chưa cho phép dùng micro — ghi tay.', 'service-not-allowed': 'Chưa cho phép dùng micro — ghi tay.', network: OFFLINE_MSG, 'no-speech': 'Không nghe thấy gì — nói lại hoặc ghi tay.' }[ev.error];
      if (m) say(m, 'bad');
    };
    rec.onend = () => { const t = heard; rec = null; btn.setAttribute('aria-pressed', 'false'); if (t) handle(t); };
    try { rec.start(); btn.setAttribute('aria-pressed', 'true'); say('Đang nghe… thả tay khi nói xong.'); } catch { rec = null; }
  }
  const stop = () => { if (rec) try { rec.stop(); } catch { /* đã dừng */ } };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  // Có mạng lại → xoá câu báo mất mạng cũ để scout không hiểu nhầm.
  const onOnline = () => { if (status.textContent === OFFLINE_MSG) say(''); };
  window.addEventListener('online', onOnline);
  return { el, inject: handle, destroy() { stop(); window.removeEventListener('online', onOnline); el.innerHTML = ''; } };
}

// Form cài máy chủ AI: địa chỉ + mã đội + nút kiểm tra kết nối.
export function mountSettings(el, opts = {}) {
  injectCss();
  const c = getConfig();
  el.classList.add('ail');
  el.innerHTML = `
    <form class="ail-tile" data-testid="ail-settings" style="display:flex;flex-direction:column;gap:12px">
      <label class="ail-field">Địa chỉ máy chủ AI<input name="url" type="url" inputmode="url" placeholder="https://vbs-ai.<tên>.workers.dev" value="${esc(c.url)}" required></label>
      <label class="ail-field">Mã đội<input name="code" type="password" autocomplete="off" value="${esc(c.code)}" required></label>
      <div class="ail-row" style="margin-top:0">
        <button type="button" class="ail-btn" data-act="test" data-testid="ail-test">Kiểm tra</button>
        <button type="submit" class="ail-btn primary" data-testid="ail-save">Lưu</button>
      </div>
      <p class="ail-status" role="status" aria-live="polite" data-testid="ail-settings-status"></p>
    </form>`;
  const form = el.querySelector('form');
  const st = el.querySelector('.ail-status');
  const save = () => setConfig({ url: form.url.value, code: form.code.value });
  form.addEventListener('submit', (e) => { e.preventDefault(); st.textContent = save() ? 'Đã lưu.' : 'Không lưu được (bộ nhớ trình duyệt bị chặn).'; opts.onSave && opts.onSave(getConfig()); });
  el.querySelector('[data-act=test]').addEventListener('click', async () => {
    save();
    st.textContent = 'Đang kiểm tra…';
    const r = await checkConnection();
    st.className = 'ail-status ' + (r.ok ? 'ok' : 'bad');
    st.textContent = r.ok ? (r.budget ? `Kết nối được. Hôm nay đã dùng ${r.budget.used}/${r.budget.max} lượt AI.` : 'Kết nối được.') : r.error.message;
  });
  return { el };
}

// Ô "Hỏi AI" khi hội ý. opts.getStats() → JSON số liệu (thường là aiData(m, setN)).
export function mountAsk(el, opts) {
  injectCss();
  el.classList.add('ail');
  el.innerHTML = `
    <form class="ail-ask" data-testid="ail-ask"><input name="q" placeholder="Hỏi AI, ví dụ: vì sao mất điểm ở P2?" maxlength="500" required><button class="ail-btn primary" type="submit">Hỏi</button></form>
    <p class="ail-status" role="status" aria-live="polite"></p>
    <div class="ail-answer" data-testid="ail-answer" hidden></div>`;
  const form = el.querySelector('form'), st = el.querySelector('.ail-status'), out = el.querySelector('.ail-answer');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    st.textContent = 'Đang hỏi…'; st.className = 'ail-status'; out.hidden = true;
    const r = await askAI(q, opts.getStats());
    if (!r.ok) { st.textContent = r.error.message; st.className = 'ail-status bad'; return; }
    st.textContent = '';
    out.innerHTML = `<div>${esc(r.answer)}</div>` +
      (r.plan && r.plan.items ? `<ol>${r.plan.items.map((i) => `<li><b>${esc(i.label)}</b> — ${esc(i.detail)} <small>(${esc(i.evidence)})</small></li>`).join('')}</ol>` : '') +
      (r.unverified_numbers && r.unverified_numbers.length ? `<p class="warn">Số chưa đối chiếu được với số liệu trận: ${esc(r.unverified_numbers.join(', '))} — HLV kiểm lại.</p>` : '');
    out.hidden = false;
  });
  return { el };
}

// Thẻ cảnh báo xu hướng (null → ẩn).
export function renderTrend(el, alert) {
  injectCss();
  el.classList.add('ail');
  el.innerHTML = alert ? `<div class="ail-alert" data-testid="ail-trend"><b>Để ý</b>${esc(alert.text)}</div>` : '';
}

export { HOWS };
