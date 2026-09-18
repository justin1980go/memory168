(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = v => v == null ? '—' : new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 2}).format(v);
  const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${number(v)}%`;
  let report = null;
  function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
  function status(text, type = '') { $('status').textContent = text; $('status').className = `status ${type}`; }
  function row(parent, label, value, className) { const el = node('div', null, className); el.append(node('span', label), node('strong', value)); parent.append(el); }
  function chart(rows) {
    const svg = $('chart'); svg.replaceChildren();
    const data = rows.slice(-60), values = data.flatMap(r => [r.close, r.sma5, r.sma20]).filter(Number.isFinite);
    const lo = Math.min(...values), hi = Math.max(...values), padding = Math.max((hi - lo) * .12, hi * .005);
    const min = lo - padding, max = hi + padding;
    const x = i => 54 + i / (data.length - 1) * 724, y = v => 214 - (v - min) / (max - min) * 192;
    const add = (tag, attrs, text) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); if (text) el.textContent = text; svg.append(el); return el; };
    for (let i = 0; i < 4; i++) { const value = min + (max - min) * i / 3, yy = y(value); add('line', {x1: 54, x2: 778, y1: yy, y2: yy, stroke: '#e4e9df', 'stroke-dasharray': '3 4'}); add('text', {x: 44, y: yy + 4, fill: '#71817a', 'text-anchor': 'end', 'font-size': 11}, number(value)); }
    for (const [key, color] of [['close', '#127360'], ['sma5', '#c89146'], ['sma20', '#7a96ad']]) {
      const points = data.map((r, i) => r[key] == null ? null : `${x(i)},${y(r[key])}`).filter(Boolean).join(' ');
      add('polyline', {points, fill: 'none', stroke: color, 'stroke-width': key === 'close' ? 2.6 : 1.6, 'stroke-linejoin': 'round'});
    }
    for (const i of [0, Math.floor((data.length - 1) / 2), data.length - 1]) add('text', {x: x(i), y: 241, fill: '#71817a', 'font-size': 11, 'text-anchor': i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}, data[i].date);
    data.forEach((r, i) => { const dot = add('circle', {cx: x(i), cy: y(r.close), r: 4, fill: '#127360', 'fill-opacity': 0}); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${r.date} 收盤 ${r.close} / MA5 ${number(r.sma5)} / MA20 ${number(r.sma20)}`; dot.append(title); });
  }
  function render(result, rows) {
    $('result-symbol').textContent = result.symbol;
    $('result-title').textContent = `${result.asset === 'etf' ? 'ETF' : '股票'}日線分析`;
    $('trend').textContent = result.trend;
    $('close').textContent = number(result.close);
    $('change').textContent = `${pct(result.change_pct)} 較前一交易日`;
    $('change').className = result.change_pct >= 0 ? 'up' : 'down';
    const fetched = new Date(result.fetched_at).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', hour12: false});
    $('provenance').textContent = `行情日期 ${result.latest_date} ｜ ${result.source} ｜ ${rows.length} 個交易日 ｜ 查詢時間 ${fetched}（台北）${result.cached ? ' · 本頁 5 分鐘內快取' : ''}`;
    $('metrics').replaceChildren();
    for (const [label, value] of [['前收', number(result.previous_close)], ['當日高 / 低', `${number(result.day_high)} / ${number(result.day_low)}`], ['RSI14', number(result.rsi14)], ['ATR14', number(result.atr14)], ['MA5 / MA10', `${number(result.sma5)} / ${number(result.sma10)}`], ['MA20', number(result.sma20)], ['成交量（股）', number(result.volume)], ['量比 / 5 日均量', result.volume_ratio == null ? '—' : `${number(result.volume_ratio)} 倍`]]) row($('metrics'), label, value, 'metric');
    $('warnings').replaceChildren(...result.warnings.map(w => node('p', w)));
    $('levels').replaceChildren();
    for (const [label, value] of [['R2 · 第二壓力', result.resistance_2], ['R1 · 第一壓力', result.resistance_1], ['最近收盤', result.close], ['S1 · 第一支撐', result.support_1], ['S2 · 第二支撐', result.support_2]]) row($('levels'), label, number(value), 'level-row');
    $('plan-title').textContent = result.cost != null ? '持有與出場' : '等待合理進場';
    $('plan').replaceChildren();
    if (result.cost != null) { row($('plan'), '持有成本', number(result.cost), 'plan-row'); row($('plan'), '價差損益（未含費稅）', pct(result.pnl_pct), 'plan-row'); row($('plan'), '移動防守參考', number(result.moving_guard), 'plan-row'); }
    else { row($('plan'), '第一買區參考', result.entry_zone.map(number).join(' – '), 'plan-row'); row($('plan'), '不追價區', `> ${number(result.no_chase_above)}`, 'plan-row'); }
    row($('plan'), '第一賣點', number(result.target_1), 'plan-row');
    row($('plan'), '第二賣點 · 突破後啟用', number(result.target_2), 'plan-row');
    row($('plan'), '失效參考 · 收盤跌破', number(result.invalidation), 'plan-row');
    if (result.premium_discount_pct != null) row($('plan'), '相對輸入 NAV 折溢價', pct(result.premium_discount_pct), 'plan-row');
    $('scenarios').replaceChildren();
    for (const [key, title] of [['base', '基準 · 區間整理'], ['bull', '偏強 · 突破延伸'], ['bear', '偏弱 · 支撐失守']]) { const s = result.scenarios[key], el = node('div', null, 'scenario'); el.append(node('h4', title), node('strong', s.range.map(number).join(' – ')), node('p', s.condition), node('p', s.action, 'action')); $('scenarios').append(el); }
    chart(rows); $('results').hidden = false; $('empty').hidden = true;
  }
  $('asset').addEventListener('change', () => { $('nav-field').hidden = $('asset').value !== 'etf'; $('nav').disabled = $('asset').value !== 'etf'; });
  $('asset').dispatchEvent(new Event('change'));
  document.querySelectorAll('[data-symbol]').forEach(button => button.addEventListener('click', () => { $('symbol').value = button.dataset.symbol; $('market').value = 'TW'; $('asset').value = button.dataset.asset; $('asset').dispatchEvent(new Event('change')); $('symbol').focus(); }));
  $('query-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('submit').disabled) return;
    report = null; $('results').hidden = true; $('empty').hidden = true; $('submit').disabled = true; $('submit').textContent = '正在取得資料…';
    try {
      const optional = id => $(id).value.trim() === '' ? null : Number($(id).value);
      const options = StockEngine.validateOptions({symbol: $('symbol').value, market: $('market').value, asset: $('asset').value, cost: optional('cost'), nav: $('asset').value === 'etf' ? optional('nav') : null, source: $('source').value});
      $('market').value = options.market;
      const data = await StockData.load(options, message => status(message, 'loading'));
      const {result, rows} = StockEngine.analyze(data.rows, options);
      Object.assign(result, {source: data.source, source_url: data.source_url, fetched_at: data.fetched_at, cached: data.cached});
      if (result.latest_date !== StockData.today()) result.warnings.unshift(`最近可取得交易日為 ${result.latest_date}，不是今日行情；可能因休市、尚未更新或停牌，請先確認。`);
      if (data.fallback_note) result.warnings.unshift(data.fallback_note);
      report = {version: 'portable-web-1.0', ...result, history: data.rows};
      render(result, rows);
      status(`已完成 ${result.symbol} 分析 · 資料截至 ${result.latest_date}。`);
    } catch (error) { status(error.message || '查詢失敗，請稍後重試。', 'error'); $('empty').hidden = false; }
    finally { $('submit').disabled = false; $('submit').textContent = '查詢並分析 ↗'; }
  });
  $('download').addEventListener('click', () => { if (!report) return; const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json;charset=utf-8'})); const a = node('a'); a.href = url; a.download = `${report.symbol}-${report.latest_date}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $('print').addEventListener('click', () => window.print());
})();
