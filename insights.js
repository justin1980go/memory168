(function (root) {
  'use strict';
  const cache = new Map();
  const number = v => v == null || String(v).trim() === '' ? NaN : Number(v);
  const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  function safeURL(value) {try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null;} catch {return null;}}
  function flow(rows) {
    const dates = [...new Set(rows.map(r => r.date).filter(day))].sort().slice(-5);
    const groups = [ ['外資', ['Foreign_Investor', 'Foreign_Dealer_Self']], ['投信', ['Investment_Trust']], ['自營商', ['Dealer_self', 'Dealer_Hedging']] ];
    return dates.reverse().map(date => {
      const parts = groups.map(([label, names]) => {
        const matched = rows.filter(r => r.date === date && names.includes(r.name));
        // A partial source response must not silently turn absent data into zero.
        const valid = names.every(n => matched.some(r => r.name === n)) && matched.every(r => Number.isFinite(number(r.buy)) && Number.isFinite(number(r.sell)));
        return {label, net: valid ? matched.reduce((sum, r) => sum + number(r.buy) - number(r.sell), 0) : null};
      });
      return {date, parts, total: parts.every(p => p.net != null) ? parts.reduce((sum, p) => sum + p.net, 0) : null};
    });
  }
  function dividends(rows, today) {
    const cutoff = new Date(`${today}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 120);
    const events = [];
    for (const r of rows) {
      for (const [type, dateField, fields] of [['除息', 'CashExDividendTradingDate', ['CashEarningsDistribution', 'CashStatutorySurplus']], ['除權', 'StockExDividendTradingDate', ['StockEarningsDistribution', 'StockStatutorySurplus']]]) {
        const date = r[dateField], values = fields.map(f => number(r[f]));
        if (day(date) && date >= cutoff.toISOString().slice(0, 10)) events.push({type, date, amount: values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : null,
          payment: type === '除息' && day(r.CashDividendPaymentDate) ? r.CashDividendPaymentDate : null,
          announcement: day(r.AnnouncementDate) ? r.AnnouncementDate : r.date, upcoming: date > today});
      }
    }
    return [...new Map(events.map(e => [`${e.type}/${e.date}`, e])).values()].sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || (a.upcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date))).slice(0, 8);
  }
  function news(rows) {
    // Keep media headlines, not forum posts tagged with a stock number. Do not claim semantic importance.
    return [...new Map(rows.filter(r => safeURL(r.link) && typeof r.title === 'string' && r.title.trim() && /^\d{4}-\d{2}-\d{2}/.test(r.date || '') &&
      !/\/forum\/|ptt\.cc|dcard\.tw/i.test(r.link)).sort((a, b) => b.date.localeCompare(a.date)).map(r => [safeURL(r.link), {date: r.date, title: r.title, source: r.source || new URL(r.link).hostname, url: safeURL(r.link)}])).values()].slice(0, 8);
  }
  async function dataset(name, code, start, end) {
    const params = new URLSearchParams({dataset: name, data_id: code, start_date: start});
    // News API accepts a single start_date and explicitly rejects end_date.
    if (name !== 'TaiwanStockNews') params.set('end_date', end);
    const payload = await root.StockData.getJSON(`https://api.finmindtrade.com/api/v4/data?${params}`);
    if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error(String(payload.msg || '資料格式錯誤').slice(0, 180));
    if (payload.data.some(r => String(r.stock_id) !== code)) throw new Error('回傳股票代號不一致。');
    return payload.data;
  }
  async function recentNews(code, today) {
    let all = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - i);
      all = all.concat(await dataset('TaiwanStockNews', code, date.toISOString().slice(0, 10), today));
      const selected = news(all);
      if (selected.length >= 8) return selected;
    }
    return news(all);
  }
  async function load(code) {
    const today = root.StockData.today(), hit = cache.get(code);
    if (hit && Date.now() - hit.at < 600000 && hit.today === today) return hit.data;
    const offset = days => {const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);};
    const specs = [['flow', 'TaiwanStockInstitutionalInvestorsBuySell', 21, flow], ['dividends', 'TaiwanStockDividend', 400, r => dividends(r, today)], ['news', 'TaiwanStockNews', 14, news]];
    const results = await Promise.allSettled(specs.map(async ([key, name, days, parse]) => key === 'news' ? recentNews(code, today) : parse(await dataset(name, code, offset(days), today))));
    const data = {fetched_at: new Date().toISOString(), source: 'FinMind'};
    specs.forEach(([key, name], i) => {data[key] = results[i].status === 'fulfilled' ? {items: results[i].value, dataset: name, error: null} : {items: [], dataset: name, error: results[i].reason.message};});
    // Cache complete responses only; manual retry can recover partial provider failures.
    if (results.every(r => r.status === 'fulfilled')) cache.set(code, {at: Date.now(), today, data});
    return data;
  }
  root.StockInsights = {load, flow, dividends, news, safeURL};
  if (typeof module !== 'undefined') module.exports = root.StockInsights;
})(globalThis);
