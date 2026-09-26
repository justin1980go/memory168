(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = v => v == null ? '—' : new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 2}).format(v);
  const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${number(v)}%`;
  let report = null, activeOptions = null, activeContext = null, generation = 0, busy = false, dirty = false;
  function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
  function status(text, type = '') { $('status').textContent = text; $('status').className = `status ${type}`; }
  function row(parent, label, value, className) { const el = node('div', null, className); el.append(node('span', label), node('strong', value)); parent.append(el); }
  function chart(rows) {
    const svg = $('chart'); svg.replaceChildren();
    const cutoff = new Date(`${rows.at(-1).date}T00:00:00Z`); cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
    const data = rows.filter(r => r.date >= cutoff.toISOString().slice(0, 10));
    const values = data.flatMap(r => [r.high, r.low, r.sma5, r.sma20]).filter(Number.isFinite);
    const lo = Math.min(...values), hi = Math.max(...values), padding = Math.max((hi - lo) * .12, hi * .005);
    const min = lo - padding, max = hi + padding;
    const x = i => 58 + i / (data.length - 1) * 714, y = v => 207 - (v - min) / (max - min) * 185;
    const add = (tag, attrs, text) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); if (text) el.textContent = text; svg.append(el); return el; };
    for (let i = 0; i < 4; i++) { const value = min + (max - min) * i / 3, yy = y(value); add('line', {x1: 54, x2: 778, y1: yy, y2: yy, stroke: '#e4e9df', 'stroke-dasharray': '3 4'}); add('text', {x: 44, y: yy + 4, fill: '#71817a', 'text-anchor': 'end', 'font-size': 11}, number(value)); }
    const width = Math.max(2, Math.min(9, 540 / data.length)), maxVolume = Math.max(...data.map(r => r.volume), 1);
    data.forEach((r, i) => {
      const color = r.close >= r.open ? '#bd5541' : '#127360';
      const wick = add('line', {x1: x(i), x2: x(i), y1: y(r.high), y2: y(r.low), stroke: color, 'stroke-width': 1.2});
      const body = add('rect', {x: x(i) - width / 2, y: Math.min(y(r.open), y(r.close)), width, height: Math.max(1, Math.abs(y(r.open) - y(r.close))), fill: color, opacity: r.provisional ? .5 : .9, class: 'candle'});
      add('rect', {x: x(i) - width / 2, y: 269 - r.volume / maxVolume * 36, width, height: Math.max(1, r.volume / maxVolume * 36), fill: color, opacity: .35});
      for (const el of [wick, body]) {const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${r.date}${r.provisional ? '（未完成）' : ''} 開 ${r.open} / 高 ${r.high} / 低 ${r.low} / ${r.provisional ? '成交' : '收'} ${r.close} / 量 ${number(r.volume)} 股`; el.append(title);}
    });
    add('text', {x: 54, y: 230, fill: '#71817a', 'font-size': 10}, '成交量');
    for (const [key, color] of [['sma5', '#c89146'], ['sma20', '#7a96ad']]) {
      const points = data.map((r, i) => r[key] == null ? null : `${x(i)},${y(r[key])}`).filter(Boolean).join(' ');
      add('polyline', {points, fill: 'none', stroke: color, 'stroke-width': key === 'close' ? 2.6 : 1.6, 'stroke-linejoin': 'round'});
    }
    for (const i of [0, Math.floor((data.length - 1) / 2), data.length - 1]) add('text', {x: x(i), y: 292, fill: '#71817a', 'font-size': 11, 'text-anchor': i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}, data[i].date);
  }
  function render(result, rows) {
    $('result-symbol').textContent = `${result.symbol} ${result.name || ''}`;
    $('result-title').textContent = `${result.asset === 'etf' ? 'ETF' : '股票'} · ${result.price_label}`;
    $('price-label').textContent = `${result.price_label} · TWD`;
    $('trend').textContent = result.trend;
    $('close').textContent = number(result.close);
    $('change').textContent = `${pct(result.change_pct)} 較前收／參考價`;
    $('change').className = result.change_pct >= 0 ? 'up' : 'down';
    const fetched = new Date(result.fetched_at).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', hour12: false});
    $('provenance').textContent = `價格時間 ${result.quote_time || result.latest_date + ' 收盤'} ｜ ${result.price_source} ｜ 查詢時間 ${fetched}（台北）${result.session.holiday ? ' ｜ ' + result.session.holiday : ''}。歷史日線：${result.source}${result.cached ? '（5 分鐘內快取；成交價另行查詢）' : ''}`;
    $('metrics').replaceChildren();
    for (const [label, value] of [['前收／參考價', number(result.previous_close)], ['當日高 / 低', `${number(result.day_high)} / ${number(result.day_low)}`], ['RSI14', number(result.rsi14)], ['ATR14', number(result.atr14)], ['MA5 / MA10', `${number(result.sma5)} / ${number(result.sma10)}`], ['MA20', number(result.sma20)], [result.provisional ? '累計量（股，未完成）' : '成交量（股）', number(result.volume)], [result.provisional ? '量比（盤中累計）' : '量比 / 5 日均量', result.volume_ratio == null ? '—' : `${number(result.volume_ratio)} 倍`]]) row($('metrics'), label, value, 'metric');
    $('warnings').replaceChildren(...result.warnings.map(w => node('p', w)));
    $('levels').replaceChildren();
    for (const [label, value] of [['R2 · 第二壓力', result.resistance_2], ['R1 · 第一壓力', result.resistance_1], [result.price_label, result.close], ['S1 · 第一支撐', result.support_1], ['S2 · 第二支撐', result.support_2]]) row($('levels'), label, number(value), 'level-row');
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
    chart(rows); $('chart-note').textContent = `${result.provisional ? '最後一根為未完成 K 線，會隨行情更新。' : ''}滑鼠移至 K 線可查看開高低收與量。原始成交價格，未做除權息／分割還原。`;
    $('results').hidden = false; $('empty').hidden = true;
  }
  function sourceLink(parent, label, url) {const a = node('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a);}
  function renderInfo(info) {
    $('info-time').textContent = `FinMind · 查詢 ${new Date(info.fetched_at).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', hour12: false})}`;
    for (const [key, id] of [['flow', 'flow-info'], ['dividends', 'dividend-info'], ['news', 'news-info']]) {
      const parent = $(id), part = info[key]; parent.replaceChildren();
      if (part.error) {parent.append(node('p', `暫時無法取得：${part.error}`, 'field-note')); continue;}
      if (!part.items.length) {parent.append(node('p', key === 'dividends' ? '查詢期間內未取得近期或已公告的除權息資料；不代表沒有配息計畫。' : key === 'news' ? '近 14 日未取得可列示的媒體新聞。' : '近 21 日未取得法人買賣超資料。', 'field-note')); continue;}
      if (key === 'flow') {
        const table = node('table', null, 'flow-table'), head = node('tr');
        ['日期', '外資', '投信', '自營商', '合計'].forEach(t => head.append(node('th', t))); const thead = node('thead'); thead.append(head); table.append(thead);
        const tbody = node('tbody');
        part.items.forEach(r => {const tr = node('tr'); tr.append(node('td', r.date.slice(5))); [...r.parts.map(p => p.net), r.total].forEach(v => tr.append(node('td', v == null ? '—' : `${v > 0 ? '+' : ''}${number(v / 1000)}`, v >= 0 ? 'up' : 'down'))); tbody.append(tr);}); table.append(tbody);
        const wrap = node('div', null, 'table-scroll'); wrap.append(table); parent.append(wrap, node('p', `${part.items.at(-1).date} ～ ${part.items[0].date}。單位：千股（1,000 股）；正值買超，負值賣超。「—」表示來源缺漏。`, 'field-note'));
        sourceLink(parent, '法人資料來源 ↗', 'https://finmind.github.io/tutor/TaiwanMarket/Chip/');
      } else if (key === 'dividends') {
        part.items.forEach(e => {const item = node('div', null, 'event-item'); item.append(node('strong', `${e.date} ${e.type}${e.upcoming ? ' · 已公告／待實施' : ''}`), node('p', `${e.type === '除息' ? '現金股利' : '股票股利（面額金額）'} ${e.amount == null ? '未提供' : number(e.amount) + ' 元／股'}${e.payment ? ' · 發放日 ' + e.payment : ''}`, 'field-note')); parent.append(item);});
        sourceLink(parent, '股利資料來源 ↗', 'https://finmind.github.io/tutor/TaiwanMarket/Fundamental/');
      } else {
        part.items.forEach(n => {const item = node('div', null, 'news-item'); sourceLink(item, n.title, n.url); item.append(node('p', `${n.date} · ${n.source}`, 'field-note')); parent.append(item);});
        parent.append(node('p', '依個股關聯與來源時間列示（來源未提供時區），已排除討論區與重複網址；並非完整重大新聞清單。', 'field-note'));
      }
    }
  }
  $('asset').addEventListener('change', () => { $('nav-field').hidden = $('asset').value !== 'etf'; $('nav').disabled = $('asset').value !== 'etf'; });
  $('asset').dispatchEvent(new Event('change'));
  document.querySelectorAll('[data-symbol]').forEach(button => button.addEventListener('click', () => { $('symbol').value = button.dataset.symbol; $('market').value = 'TW'; $('asset').value = button.dataset.asset; $('asset').dispatchEvent(new Event('change')); $('symbol').focus(); }));
  async function run(options) {
    if (busy) return;
    busy = true; const id = ++generation;
    report = null; $('results').hidden = true; $('empty').hidden = true; $('submit').disabled = true; $('submit').textContent = '正在取得資料…';
    document.querySelectorAll('#query-form input, #query-form select, .quick-picks button').forEach(el => {el.disabled = true;});
    try {
      $('market').value = options.market;
      const [data, context] = await Promise.all([StockData.load(options, message => status(message, 'loading')), StockMarket.load(options)]);
      const {result, rows} = StockMarket.build(data, options, context);
      activeOptions = options; activeContext = context; dirty = false;
      report = {version: 'portable-web-2.0', ...result, history: rows, recent_info: null};
      render(result, rows);
      status(`已完成 ${result.symbol} 分析 · ${result.price_label} ${result.close} · ${result.quote_time || result.latest_date}。`);
      $('refresh-state').textContent = result.session.inHours ? '盤中更新已就緒；依上方勾選設定執行。' : '目前不在一般交易時段，保留最後可取得價格。';
      for (const name of ['flow-info', 'dividend-info', 'news-info']) $(name).replaceChildren(node('p', '正在讀取近期資訊…', 'field-note'));
      $('info-time').textContent = '';
      StockInsights.load(options.symbol).then(info => {if (id !== generation || !report) return; report.recent_info = info; renderInfo(info);}).catch(() => {if (id !== generation) return; for (const name of ['flow-info', 'dividend-info', 'news-info']) $(name).textContent = '近期資訊暫時無法取得，請重新查詢。';});
    } catch (error) { status(error.message || '查詢失敗，請稍後重試。', 'error'); $('empty').hidden = false; }
    finally { busy = false; $('submit').disabled = false; $('submit').textContent = '查詢並分析 ↗'; document.querySelectorAll('#query-form input, #query-form select, .quick-picks button').forEach(el => {el.disabled = false;}); $('nav').disabled = $('asset').value !== 'etf'; }
  }
  $('query-form').addEventListener('submit', event => {
    event.preventDefault();
    try {const optional = id => $(id).value.trim() === '' ? null : Number($(id).value);
      const options = StockEngine.validateOptions({symbol: $('symbol').value, market: $('market').value, asset: $('asset').value, cost: optional('cost'), nav: $('asset').value === 'etf' ? optional('nav') : null, source: $('source').value});
      run(options);
    } catch (error) {status(error.message, 'error');}
  });
  const edited = () => {dirty = true; $('refresh-state').textContent = '設定已修改，請按「查詢並分析」套用；自動更新暫停。';};
  $('query-form').addEventListener('input', edited); $('query-form').addEventListener('change', edited);
  document.querySelectorAll('[data-symbol]').forEach(el => el.addEventListener('click', edited));
  function autoRefresh() {if (!activeOptions || busy || dirty || document.hidden || !$('auto-refresh').checked) return; const s = StockMarket.session(new Date(), activeContext?.calendars); if (s.inHours || (activeContext && report?.provisional && !s.inHours)) run(activeOptions);}
  setInterval(autoRefresh, 30000);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) autoRefresh();});
  $('launch-note').hidden = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  $('download').addEventListener('click', () => { if (!report) return; const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json;charset=utf-8'})); const a = node('a'); a.href = url; a.download = `${report.symbol}-${report.latest_date}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $('print').addEventListener('click', () => window.print());
})();
