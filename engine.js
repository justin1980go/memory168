/* Portable, dependency-free counterpart of scripts/analyze.py. */
(function (root) {
  'use strict';
  const finite = Number.isFinite;
  const round = (v, n = 2) => finite(v) ? Number(v.toFixed(n)) : null;
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  function normalizeSymbol(value) {
    const s = String(value).trim().toUpperCase();
    const match = /^(\d{4,6}[A-Z]?)(?:\.(TW|TWO))?$/.exec(s);
    if (!match) throw new Error('請輸入有效台股代號，例如 2330、00830、00400A 或 6488.TWO。');
    return {code: match[1], market: match[2] || null};
  }
  function validateOptions(options) {
    const symbol = normalizeSymbol(options.symbol);
    if (!['TW', 'TWO'].includes(options.market)) throw new Error('請選擇上市或上櫃。');
    if (!['stock', 'etf'].includes(options.asset)) throw new Error('請選擇股票或 ETF。');
    for (const key of ['cost', 'nav']) {
      const v = options[key];
      if (v != null && (!finite(v) || v <= 0)) throw new Error(`${key === 'cost' ? '成本' : 'NAV'} 必須是大於零的數字。`);
    }
    return {...options, symbol: symbol.code, market: symbol.market || options.market};
  }
  function prepareRows(input) {
    if (!Array.isArray(input)) throw new Error('行情格式不正確。');
    const rows = input.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      ['open', 'high', 'low', 'close', 'volume'].every(k => finite(r[k])) &&
      r.low > 0 && r.high >= Math.max(r.open, r.close, r.low) &&
      r.low <= Math.min(r.open, r.close) && r.volume >= 0);
    if (rows.length !== input.length) throw new Error('行情包含缺漏或無效 OHLCV；為避免計算失真，請改用其他來源。');
    const unique = [...new Map(rows.map(r => [r.date, {...r}])).values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
    if (unique.length < 20) throw new Error(`僅取得 ${unique.length} 個交易日，至少需要 20 日才能計算 SMA20；請確認代號、市場或新掛牌日期。`);
    return unique;
  }
  function indicators(input) {
    const rows = prepareRows(input);
    let gain, loss, atr;
    rows.forEach((r, i) => {
      for (const n of [5, 10, 20]) r[`sma${n}`] = i + 1 >= n ? mean(rows.slice(i + 1 - n, i + 1).map(x => x.close)) : null;
      if (i > 0) {
        const d = r.close - rows[i - 1].close, g = Math.max(d, 0), l = Math.max(-d, 0);
        gain = i === 1 ? g : gain * 13 / 14 + g / 14;
        loss = i === 1 ? l : loss * 13 / 14 + l / 14;
      }
      r.rsi14 = i < 14 ? null : loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
      const tr = i === 0 ? r.high - r.low : Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close));
      atr = i === 0 ? tr : atr * 13 / 14 + tr / 14;
      r.atr14 = i >= 13 ? atr : null;
      r.vol_ma5 = i >= 4 ? mean(rows.slice(i - 4, i + 1).map(x => x.volume)) : null;
      r.volume_ratio = r.vol_ma5 > 0 ? r.volume / r.vol_ma5 : null;
    });
    return rows;
  }
  function analyze(input, rawOptions) {
    const options = validateOptions(rawOptions), rows = indicators(input);
    const row = rows.at(-1), prev = rows.at(-2), close = row.close;
    const levels = key => [...new Set(rows.slice(-20).map(r => round(r[key])))];
    const supports = levels('low').filter(x => x < close).sort((a, b) => b - a);
    const resistances = levels('high').filter(x => x > close).sort((a, b) => a - b);
    const atr = row.atr14;
    if (!(atr > 0)) throw new Error('近期價格沒有足夠波動，無法建立有效 ATR 區間。');
    const s1 = supports[0] ?? Math.max(0.01, close - atr);
    const s2 = supports[1] ?? Math.max(0.01, s1 - atr * 0.7);
    const r1 = resistances[0] ?? close + atr, r2 = resistances[1] ?? r1 + atr * 0.7;
    const target2 = Math.max(r2, r1 + 0.6 * atr);
    const invalid = Math.max(0.01, Math.min(s2, row.sma20 - 0.5 * atr));
    let trend = '震盪';
    if (close > row.sma5 && row.sma5 >= row.sma10 && close >= row.sma20 && row.rsi14 < 75) trend = '偏多';
    else if (close < row.sma5 && row.sma5 < row.sma10 && close < row.sma20) trend = '偏空';
    const result = {
      symbol: `${options.symbol}.${options.market}`, asset: options.asset,
      latest_date: row.date, close: round(close), previous_close: round(prev.close),
      day_high: round(row.high), day_low: round(row.low), volume: row.volume,
      change_pct: round((close / prev.close - 1) * 100), trend,
      sma5: round(row.sma5), sma10: round(row.sma10), sma20: round(row.sma20),
      rsi14: round(row.rsi14, 1), atr14: round(atr), volume_ratio: round(row.volume_ratio),
      support_1: round(s1), support_2: round(s2), resistance_1: round(r1), resistance_2: round(r2),
      entry_zone: [round(Math.max(s2, s1 - 0.35 * atr)), round(Math.min(close, s1 + 0.25 * atr))],
      no_chase_above: round(Math.max(r1, row.sma5 + 1.2 * atr)),
      target_1: round(r1), target_2: round(target2), invalidation: round(invalid),
      horizon: '1–5 個交易日（固定規則，非逐日預測）',
      scenarios: {
        base: {range: [round(s1), round(r1)], condition: '支撐未破，第一壓力未有效突破', action: '區間觀察，靠近壓力分批收斂部位'},
        bull: {range: [round(r1), round(target2)], condition: '有效突破第一壓力且回踩不破', action: '第二目標才啟用，碰到價位不等於站穩'},
        bear: {range: [round(Math.max(0.01, invalid - 0.5 * atr)), round(s1)], condition: '收盤跌破第一支撐且量能放大', action: '原短線劇本失效，重新評估風險'}
      }
    };
    if (options.cost != null) Object.assign(result, {cost: round(options.cost), pnl_pct: round((close / options.cost - 1) * 100), moving_guard: round(close >= options.cost ? Math.max(s1, options.cost * 0.98) : s1)});
    if (options.asset === 'etf' && options.nav != null) Object.assign(result, {nav: options.nav, premium_discount_pct: round((close / options.nav - 1) * 100)});
    const warnings = ['日成交資料可能延遲，不代表盤中即時價。', '使用未還原價格；除權息、分割或合併可能影響均線、ATR 與關鍵價位。'];
    if (row.rsi14 > 75) warnings.push('RSI 大於 75，標記為不宜追價；支撐區不代表已確認止跌。');
    if (rows.some((r, i) => i > 0 && Math.abs(r.close / rows[i - 1].close - 1) > 0.2)) warnings.push('歷史資料有單日超過 20% 的跳動，請先核對公司行動與交易狀態，再採用價位。');
    if (options.asset === 'etf') warnings.push(options.nav == null ? '未提供 NAV，本次未評估 ETF 折溢價。' : '折溢價以手動輸入 NAV 計算；本工具無法驗證 NAV 日期與行情日期是否一致。');
    result.warnings = warnings;
    return {result, rows};
  }
  const api = {normalizeSymbol, validateOptions, prepareRows, indicators, analyze};
  root.StockEngine = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
