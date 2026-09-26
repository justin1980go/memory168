(function (root) {
  'use strict';
  const memory = new Map();
  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const num = value => value == null || String(value).trim() === '' ? NaN : Number(String(value).replaceAll(',', '').trim());
  async function getJSON(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!response.ok) throw new Error(`行情服務回應 HTTP ${response.status}${response.status === 429 ? '，請稍後再試' : ''}。`);
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('行情來源逾時，請稍後再試或改用其他來源。');
      if (error instanceof TypeError) throw new Error('無法連線至行情來源，請檢查網路或稍後再試（也可能是來源限制跨站讀取）。');
      if (error instanceof SyntaxError) throw new Error('行情來源未回傳有效 JSON，可能暫時限制存取。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function parseFinMind(payload, code) {
    if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error(`FinMind：${String(payload.msg || '資料格式錯誤').slice(0, 200)}`);
    if (!payload.data.length) throw new Error('查無日行情，請確認股票代號，或改用證交所來源。');
    if (payload.data.some(r => String(r.stock_id) !== code)) throw new Error('行情回傳代號不一致，已停止分析。');
    return payload.data.map(r => ({date: r.date, open: num(r.open), high: num(r.max), low: num(r.min), close: num(r.close), volume: num(r.Trading_Volume)}));
  }
  function parseTWSE(payload) {
    if (!Array.isArray(payload.data)) {
      if (/沒有符合條件|查無資料/.test(payload.stat || '')) return [];
      throw new Error(`證交所：${String(payload.stat || '資料格式錯誤').slice(0, 200)}`);
    }
    return payload.data.map(r => {
      const d = String(r[0]).split('/');
      return {date: `${Number(d[0]) + 1911}-${d[1]}-${d[2]}`, open: num(r[3]), high: num(r[4]), low: num(r[5]), close: num(r[6]), volume: num(r[1])};
    });
  }
  async function finmind(code) {
    const end = today(), start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 190);
    const params = new URLSearchParams({dataset: 'TaiwanStockPrice', data_id: code, start_date: start.toISOString().slice(0, 10), end_date: end});
    const rows = parseFinMind(await getJSON(`https://api.finmindtrade.com/api/v4/data?${params}`), code);
    return {rows, source: 'FinMind · TaiwanStockPrice', source_url: 'https://finmind.github.io/tutor/TaiwanMarket/Technical/'};
  }
  async function twse(code, progress) {
    let rows = [];
    const date = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
    for (let i = 0; i < 6; i++) {
      progress(`正在讀取證交所日行情（${i + 1}/6 個月份）…`);
      const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
      const p = new URLSearchParams({response: 'json', date: stamp, stockNo: code});
      rows = rows.concat(parseTWSE(await getJSON(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?${p}`)));
      date.setUTCMonth(date.getUTCMonth() - 1);
      if (i < 5) await new Promise(resolve => setTimeout(resolve, 450));
    }
    return {rows, source: '臺灣證券交易所 · STOCK_DAY', source_url: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html'};
  }
  async function load(options, progress = () => {}) {
    const key = `${options.symbol}/${options.market}/${options.source}/${today()}`;
    const hit = memory.get(key);
    if (hit && Date.now() - hit.timestamp < 300000) return {...hit.data, cached: true};
    if (options.source === 'twse' && options.market !== 'TW') throw new Error('證交所來源只支援上市；上櫃請選擇自動或 FinMind。');
    if (!['auto', 'finmind', 'twse'].includes(options.source)) throw new Error('未知行情來源。');
    let data;
    progress('正在連線讀取日成交資料…');
    try { data = options.source === 'twse' ? await twse(options.symbol, progress) : await finmind(options.symbol); }
    catch (error) {
      if (options.source !== 'auto' || options.market !== 'TW') throw error;
      progress('FinMind 暫時無法取得資料，改向證交所查詢…');
      try { data = await twse(options.symbol, progress); data.fallback_note = `FinMind 查詢失敗：${error.message} 本次改採證交所。`; }
      catch (second) { throw new Error(`FinMind：${error.message}；證交所：${second.message}`); }
    }
    data.rows = root.StockEngine.prepareRows(data.rows);
    if (data.rows.at(-1).date > today()) throw new Error('行情日期晚於電腦目前的台北日期，請檢查系統時間或資料來源。');
    data.fetched_at = new Date().toISOString();
    memory.set(key, {timestamp: Date.now(), data});
    return {...data, cached: false};
  }
  root.StockData = {load, today, parseFinMind, parseTWSE, getJSON};
  if (typeof module !== 'undefined') module.exports = root.StockData;
})(globalThis);
