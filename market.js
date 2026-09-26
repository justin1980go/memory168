(function (root) {
  'use strict';
  const number = v => v == null || String(v).trim() === '' ? NaN : Number(v);
  const isoDay = value => /^\d{8}$/.test(String(value)) ? `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}` : null;
  const isDay = day => {const d = new Date(`${day}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(day || '') && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;};
  const calendarCache = new Map();
  function clock(now = new Date()) {
    const shifted = new Date(now.getTime() + 8 * 3600000);
    return {date: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 19), weekday: shifted.getUTCDay()};
  }
  function parseCalendar(payload, year) {
    if (!Array.isArray(payload.data) || Number(payload.queryYear) !== year || payload.data.length === 0) throw new Error('休市日曆尚未提供。');
    // Calendar also contains start/end-of-year trading days; those are NOT holidays.
    const closed = payload.data.filter(r => isDay(r[0]) && !/開始交易|最後交易/.test(`${r[1]} ${r[2]}`)).map(r => ({date: r[0], name: r[1]}));
    return {year, closed};
  }
  async function calendars(now) {
    const year = Number(clock(now).date.slice(0, 4)), list = [];
    for (const y of [year, year - 1]) {
      let record = calendarCache.get(y);
      if (!record || Date.now() - record.at > 86400000) {
        const payload = await root.StockData.getJSON(`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${y - 1911}`);
        record = {at: Date.now(), value: parseCalendar(payload, y)}; calendarCache.set(y, record);
      }
      list.push(record.value);
      if (clock(now).date.slice(5, 7) !== '01') break;
    }
    return list;
  }
  function parseMIS(payload, options) {
    if (payload.rtcode !== '0000' || !Array.isArray(payload.msgArray)) throw new Error('即時行情回應不完整。');
    const exchange = options.market === 'TWO' ? 'otc' : 'tse';
    const q = payload.msgArray.find(r => r.c === options.symbol && r.ex === exchange);
    if (!q) throw new Error('即時行情查無此代號，請確認上市／上櫃市場。');
    const date = isoDay(q.d);
    let close = number(q.z), time = q.t;
    // A missing last trade is never substituted with the bid/ask price.
    if (!(close > 0) && number(q.trade?.z) > 0) {close = number(q.trade.z); time = q.trade.t;}
    const serverDate = isoDay(payload.queryTime?.sysDate), serverTime = payload.queryTime?.sysTime;
    const stamp = isDay(date) && /^\d{2}:\d{2}:\d{2}$/.test(time || '') ? new Date(`${date}T${time}+08:00`).getTime() : NaN;
    const row = {date, open: number(q.o), high: number(q.h), low: number(q.l), close, volume: number(q.v) * 1000};
    const valid = Number.isFinite(stamp) && time >= '09:00:00' && time <= '13:30:00' && q.ts !== '1' &&
      ['open', 'high', 'low', 'close', 'volume'].every(k => Number.isFinite(row[k])) && row.low > 0 && row.volume >= 0 &&
      row.low <= Math.min(row.open, close) && row.high >= Math.max(row.open, close);
    return {row: valid ? row : null, date, time, stamp, previous_close: number(q.y), name: q.n || '',
      server_at: isDay(serverDate) && /^\d{2}:\d{2}:\d{2}$/.test(serverTime || '') ? `${serverDate}T${serverTime}+08:00` : null,
      source: '證交所基本市況報導（含上櫃）', source_url: 'https://mis.twse.com.tw/stock/index.jsp',
      error: valid ? null : '目前沒有有效的一般交易成交價（可能尚未成交、暫停交易或來源未更新）。'};
  }
  function connection() {
    const local = typeof location !== 'undefined' && location.protocol === 'http:' && location.hostname === '127.0.0.1';
    if (local) return {ready: true, mode: 'local', base: 'api/quote'};
    const configured = String(root.STOCK_CONFIG?.quoteApiBase || '').trim();
    if (!configured) return {ready: false, mode: 'unconfigured', message: '線上行情 API 尚未設定：請在 config.js 填入已部署的 Workers 網址。也可使用「啟動看盤.exe」取得本機盤中行情。'};
    try {
      const u = new URL(configured);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error();
      return {ready: true, mode: 'online', base: `${u.origin}/quote`};
    } catch {return {ready: false, mode: 'invalid', message: 'config.js 的行情 API 必須是 HTTPS 根網址，不含 /quote、查詢參數、帳號或密碼。'};}
  }
  function quoteURL(options) {
    const c = connection();
    if (!c.ready) throw new Error(c.message);
    return `${c.base}?code=${encodeURIComponent(options.symbol)}&market=${options.market}`;
  }
  async function load(options) {
    const now = new Date();
    const jobs = await Promise.allSettled([
      Promise.resolve().then(() => root.StockData.getJSON(quoteURL(options))).then(p => parseMIS(p, options)),
      calendars(now)
    ]);
    return {quote: jobs[0].status === 'fulfilled' ? jobs[0].value : null,
      error: jobs[0].status === 'rejected' ? jobs[0].reason.message : null,
      calendars: jobs[1].status === 'fulfilled' ? jobs[1].value : [],
      calendar_error: jobs[1].status === 'rejected' ? '休市日曆暫時無法取得，交易日狀態僅供參考。' : null,
      now: new Date()};
  }
  function session(now, calendars = []) {
    const c = clock(now), cal = calendars.find(x => x.year === Number(c.date.slice(0, 4)));
    const holiday = cal?.closed.find(x => x.date === c.date);
    const weekend = c.weekday === 0 || c.weekday === 6;
    return {...c, closed: weekend || !!holiday, known: weekend || !!cal, holiday: holiday?.name || (weekend ? '週末休市' : null),
      inHours: !weekend && !holiday && c.time >= '09:00:00' && c.time < '13:30:00'};
  }
  function lastCompletedDate(now, calendars = []) {
    const c = clock(now), d = new Date(`${c.date}T00:00:00Z`);
    if (c.time < '13:30:00') d.setUTCDate(d.getUTCDate() - 1);
    for (let i = 0; i < 30; i++) {
      const day = d.toISOString().slice(0, 10), cal = calendars.find(x => x.year === d.getUTCFullYear());
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !cal?.closed.some(x => x.date === day)) return day;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return null;
  }
  function build(history, options, context) {
    const now = context.now || new Date(), s = session(now, context.calendars), q = context.quote;
    let rows = root.StockEngine.prepareRows(history.rows), mode = 'closed', label = '最後收盤', source = history.source, quoteTime = null;
    const warnings = [];
    if (context.error) warnings.push(context.error);
    if (context.calendar_error) warnings.push(context.calendar_error);
    if (q?.error) warnings.push(q.error);
    if (q?.server_at && Math.abs(new Date(q.server_at).getTime() - now.getTime()) > 300000) warnings.push('電腦時間與行情伺服器時間差超過 5 分鐘，請校正電腦時鐘。');
    const usable = q?.row && q.date <= s.date && q.stamp <= now.getTime() + 60000;
    const live = usable && q.date === s.date && !s.closed && s.time >= '09:00:00' && s.time < '13:30:00';
    // Drop any unfinished current-day historical bar before choosing a price basis.
    if (s.inHours || (!s.closed && s.time < '09:00:00')) rows = rows.filter(r => r.date < s.date);
    if (live) {
      rows = rows.filter(r => r.date < q.date).concat({...q.row, provisional: true});
      mode = now.getTime() - q.stamp > 120000 ? 'delayed' : 'live';
      label = mode === 'live' ? '盤中最新成交' : '盤中最近成交（時間較早）'; source = q.source; quoteTime = `${q.date} ${q.time}`;
      warnings.push('盤中 K 線尚未完成；均線、ATR、支撐壓力與操作價位會隨成交變動。');
      warnings.push('盤中累計量尚未累積完整交易日，量比不可直接等同全天強弱。');
      if (mode === 'delayed') warnings.push('最近成交距今超過 2 分鐘，可能是成交稀疏或來源延遲；請核對報價時間。');
    } else if (usable && q.date >= rows.at(-1).date && (q.date < s.date || s.time >= '13:30:00')) {
      // Prefer the published daily bar for a completed date (includes final daily volume).
      const last = rows.at(-1);
      const closingCorrection = q.date === last.date && q.time === '13:30:00' && ['close', 'high', 'low', 'open'].some(k => Math.abs(last[k] - q.row[k]) > 0.001);
      if (q.date > last.date || closingCorrection) {
        rows = rows.filter(r => r.date < q.date).concat({...q.row, provisional: q.time < '13:30:00'});
        source = q.source; quoteTime = `${q.date} ${q.time}`;
        warnings.push('最後一根 K 線取自一般交易行情，成交量為來源累計量，可能與盤後完整日成交量不同。');
        if (q.time < '13:30:00') {mode = 'pending'; label = '最近成交（收盤待確認）'; warnings.push('尚未取得該日完整收盤資料，暫以來源最後成交分析，不能視為已確認收盤。');}
      }
    }
    if (!live && s.inHours) {mode = 'unavailable'; label = '歷史收盤參考（盤中行情不可用）'; warnings.push('目前為一般交易時段，但未取得今日有效成交，以下以歷史收盤參考，不代表當下價格。');}
    const expected = lastCompletedDate(now, context.calendars);
    if (!live && rows.at(-1).date < expected) {warnings.push(`最新可驗證價格日期為 ${rows.at(-1).date}，早於預期最近交易日 ${expected}；可能停牌、臨時休市或來源延遲。`); if (mode === 'closed') {mode = 'stale'; label = '最後可驗證收盤（待更新）';}}
    const analysis = root.StockEngine.analyze(rows, options), r = analysis.result;
    if (live && q.previous_close > 0) {r.previous_close = q.previous_close; r.change_pct = Number(((r.close / q.previous_close - 1) * 100).toFixed(2));}
    r.warnings = warnings.concat(r.warnings.filter(w => !w.startsWith('日成交資料')));
    if (history.fallback_note) r.warnings.push(history.fallback_note);
    Object.assign(r, {price_mode: mode, price_label: label, quote_time: quoteTime, name: q?.name || '', session: s,
      price_source: source, source: history.source, source_url: history.source_url,
      fetched_at: now.toISOString(), history_fetched_at: history.fetched_at, cached: history.cached,
      quote_fetched: !!q, provisional: mode === 'live' || mode === 'delayed' || mode === 'pending'});
    return analysis;
  }
  root.StockMarket = {load, build, parseMIS, parseCalendar, session, lastCompletedDate, clock, connection, quoteURL};
  if (typeof module !== 'undefined') module.exports = root.StockMarket;
})(globalThis);
