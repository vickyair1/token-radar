// Token Radar's dashboard (model radar-5): reads window.RADAR (written by main.ts)
// and renders the board, filters, full-page detail, live/set-aside views, and the
// model tab with a re-ranking sandbox. No network. Model: implied = exp(intercept +
// slope x ln(TVL)) x category factor x growth x launch odds — all fitted from the
// snapshot. The board leads with the table: the method strip and scatter live on
// the Model tab, so the first screen is the ranking itself.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', verdict: 'all', ticket: 1000, drop: 0.07, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = null; // { slope, growth_weight, odds_weight } or null when the shipped model runs

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsd2(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }
  function fmtNum(n, d) { return n.toFixed(d === undefined ? 2 : d); }

  // The model in one function: the page recomputes a row from the snapshot figures
  // and the fitted models, so the page's code and the board's data are visibly the
  // same arithmetic. value = base x category factor x growth; implied = value x odds.
  function impliedOf(row, model, reg, factor, oddsWeight) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = Math.min(model.growth_effect_max, Math.max(model.growth_effect_min, Math.exp(reg.growth_coef * model.growth_weight * (growth / 100))));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var base = Math.exp(reg.intercept + reg.slope * Math.log(row.tvl_usd));
    var value = Math.max(1, Math.round(base * factor * growthMult));
    var odds = Math.pow(row.launch_odds, oddsWeight === undefined ? 1 : oddsWeight);
    var implied = Math.max(1, Math.min(model.implied_cap_usd, Math.round(value * odds)));
    return { value: value, odds: odds, implied: implied, base: Math.round(base), growthMult: growthMult, growthPct: growth, age: age };
  }

  // The verdicts are a farmer's arithmetic, not a score: the slice of the drop is
  // the ticket's share of the protocol's whole TVL — the conservative case, as if
  // every dollar of TVL farmed — times the drop share times the row's expected launch
  // value, minus the plan's gas. A farm is worth doing when that leaves $10+.
  function netOf(row, ticket, drop) {
    var slice = ticket / row.tvl_usd;
    var gross = row.implied_value_usd * drop * slice;
    var net = gross - row.gas_total_usd;
    return { slice: slice, gross: gross, net: net, perHour: net / row.labor_hours };
  }
  function verdictOf(net) {
    if (net > DATA.model.farm_threshold_usd) return 'FARM';
    if (net > 0) return 'THIN';
    return 'SKIP';
  }
  // The ticket at which the slice just covers the gas: below it, farming loses money.
  function paysFrom(row, drop) {
    if (row.implied_value_usd <= 0 || drop <= 0) return null;
    return row.gas_total_usd * row.tvl_usd / (row.implied_value_usd * drop);
  }
  // What the ticket would earn in a 4% T-bill over the plan's hold, foregone by farming.
  function tbillForgone(row, ticket) {
    var hold = holdDaysFor(row.age_days);
    return ticket * 0.04 * hold / 365;
  }

  // The farm plan comes from the board's own data: main.ts derives each row's
  // steps from its record (category, chains, TVL, age, 7-day move) and writes them
  // into data.js beside the row, so the page shows the board's steps, not a second
  // derivation that could drift from them. The hold length still decides the T-bill.
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // A key/value grid from [value, label] pairs, and a math block from [label, value] lines.
  function kvGrid(pairs) {
    var kv = el('div', { class: 'kv' });
    pairs.forEach(function (p) { kv.appendChild(el('div', null, el('b', { text: p[0] }), el('span', { text: p[1] }))); });
    return kv;
  }
  function mathBlock(lines, note) {
    var math = el('div', { class: 'math' });
    lines.forEach(function (l) { math.appendChild(el('div', { class: 'line' }, el('span', { text: l[0] }), el('span', { text: l[1] }))); });
    if (note) math.appendChild(el('div', { class: 'src', text: note }));
    return math;
  }

  // Rows as the board shows them: the shipped ranking, or the sandbox's re-ranking.
  function viewRows() {
    var rows = DATA.rows.slice();
    if (sandbox !== null) {
      var model = Object.assign({}, DATA.model, sandbox);
      var reg = Object.assign({}, DATA.calibration.regression, { slope: sandbox.slope });
      rows = rows.map(function (r) {
        var v = impliedOf(r, model, reg, r.category_factor, sandbox.odds_weight);
        return Object.assign({}, r, { implied_value_usd: v.implied, value_if_launches_usd: v.value, base_value_usd: v.base, growth_multiplier: v.growthMult });
      });
      rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
      rows.forEach(function (r, i) { r.rank = i + 1; });
    }
    return rows;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.scope !== 'all' && r.scope !== state.scope) return false;
      if (state.verdict !== 'all') {
        var v = verdictOf(netOf(r, state.ticket, state.drop).net);
        if (state.verdict === 'farm' && v !== 'FARM') return false;
        if (state.verdict === 'thin' && v !== 'THIN') return false;
        if (state.verdict === 'skip' && v !== 'SKIP') return false;
      }
      return true;
    });
  }

  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'odds') return r.launch_odds;
      if (key === 'net') return netOf(r, state.ticket, state.drop).net;
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
  }

  function sortHeader(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' \u25bc' : ' \u25b2') : '';
    return el('th', { class: 'sortable' + (cls ? ' ' + cls : ''), text: label + arrow, onclick: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } });
  }

  function scopeLabel(scope) {
    if (scope === 'watchlist') return 'watchlist';
    if (scope === 'off-list') return 'off-list';
    return 'early';
  }

  function renderAccounting() {
    var wrap = document.getElementById('accounting');
    wrap.innerHTML = '';
    wrap.appendChild(el('b', { text: DATA.total_protocols + ' protocols in the snapshot: ' }));
    DATA.accounting.forEach(function (a, i) {
      if (i > 0) wrap.appendChild(document.createTextNode(' \u00b7 '));
      var span = el('span', { class: 'acct' + (a.key === 'ranked' ? ' ranked' : ''), title: a.note, text: a.count + ' ' + a.label.toLowerCase() });
      wrap.appendChild(span);
    });
  }

  // The board, first: one line of formula, then the table. The method strip and
  // scatter live on the Model tab, so the first screen is the ranking itself.
  function renderBoard() {
    var rows = sortedRows(filteredRows());
    var farmCount = viewRows().filter(function (r) { return verdictOf(netOf(r, state.ticket, state.drop).net) === 'FARM'; }).length;
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols \u00b7 ' + farmCount + ' worth farming at $' + state.ticket.toLocaleString('en-US') + ' and ' + Math.round(state.drop * 100) + '% of the launch' + (sandbox !== null ? ' \u00b7 sandbox ranking' : '');
    var reg = DATA.calibration.regression;
    var f = document.getElementById('formula');
    f.innerHTML = '';
    f.appendChild(el('b', { text: 'Implied value = ' }));
    f.appendChild(document.createTextNode('exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln TVL) \u00d7 category factor \u00d7 growth \u00d7 launch odds (TVL, age, chains, category, kinship); ablation on the Model tab.'));
    if (rows.length === 0) {
      app.innerHTML = '';
      app.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters.' }));
      return;
    }
    var mkt = DATA.market_growth_median;
    var table = el('table');
    var cols = [
      ['#', null, 'num'], ['Protocol', 'name', null], ['TVL', 'tvl', 'num'],
      ['7d' + (mkt === null ? '' : ' (mkt ' + fmtPct(mkt) + ')'), 'growth', 'num'],
      ['No token', 'age', 'num'], ['Launch odds', 'odds', 'num'],
      ['Implied value', 'implied', 'num'], ['Net @ $' + state.ticket.toLocaleString('en-US'), 'net', 'num'],
      ['Verdict', null, null],
    ];
    var head = el('tr');
    cols.forEach(function (c) {
      head.appendChild(c[1] === null ? el('th', { class: c[2] || '', text: c[0] }) : sortHeader(c[0], c[1], c[2]));
    });
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var n = netOf(r, state.ticket, state.drop);
      var verdict = verdictOf(n.net);
      var tr = el('tr', { onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug }), el('span', { class: 'tag' + (r.scope === 'watchlist' ? '' : ' early'), text: (r.category || 'Uncategorised') + ' \u00b7 ' + scopeLabel(r.scope) })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }),
        el('td', { class: 'num implied' }, document.createTextNode(fmtUsd(r.implied_value_usd) + ' '), el('span', { class: 'range', text: fmtUsd(r.range_low_usd) + '\u2013' + fmtUsd(r.range_high_usd) })),
        el('td', { class: 'num ' + (n.net >= 0 ? 'up' : 'down'), text: fmtUsd2(n.net) }),
        el('td', null, el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict })));
      body.appendChild(tr);
    });
    table.appendChild(body);
    app.innerHTML = '';
    app.appendChild(table);
  }

  // The board's own evidence: the fitted line against the live market caps it was
  // fitted on, the board's values on the same scale, and the ablation that shows
  // each stage earning its place out of sample. Shown on the Model tab, not the
  // board, so the board's first screen stays the ranking.
  function renderMethod() {
    var wrap = document.getElementById('method');
    wrap.innerHTML = '';
    var cal = DATA.calibration;
    var reg = cal.regression;
    var box = el('div', { class: 'method-box' });
    var copy = el('div');
    copy.appendChild(el('h3', { text: 'How a launch is priced' }));
    copy.appendChild(el('p', { html: 'Expected value = <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth</code> (what the launch would be worth) <code>\u00d7 launch odds</code> (how often protocols like this one already record a token). Each stage is fitted from this snapshot, and each earns its place out of sample: flat multiple ' + fmtMult(cal.ablation[0].loo_median_factor) + ' \u2192 size curve ' + fmtMult(cal.ablation[1].loo_median_factor) + ' \u2192 + category ' + fmtMult(cal.ablation[2].loo_median_factor) + ' \u2192 + momentum ' + fmtMult(cal.ablation[3].loo_median_factor) + ' median miss, leave-one-out. Full validation below.' }));
    box.appendChild(copy);
    var sc = DATA.scatter;
    var W = 560, H = 210, P = 34;
    var xs = sc.live.map(function (p) { return p[0]; }).concat(sc.board.map(function (p) { return p[0]; }));
    var ys = sc.live.map(function (p) { return p[1]; }).concat(sc.board.map(function (p) { return p[1]; }));
    var x0 = Math.min.apply(null, xs) - 0.4, x1 = Math.max.apply(null, xs) + 0.4;
    var y0 = Math.min.apply(null, ys) - 0.4, y1 = Math.max.apply(null, ys) + 0.4;
    var X = function (x) { return P + (x - x0) / (x1 - x0) * (W - 2 * P); };
    var Y = function (y) { return H - P - (y - y0) / (y1 - y0) * (H - 2 * P); };
    var parts = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log market cap against log TVL: live protocols, the fitted line, and the board\'s values">'];
    parts.push('<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" class="axis"/><line x1="' + P + '" y1="' + P + '" x2="' + P + '" y2="' + (H - P) + '" class="axis"/>');
    parts.push('<text x="' + (W / 2) + '" y="' + (H - 8) + '" class="axis-label" text-anchor="middle">log TVL</text><text x="12" y="' + (H / 2) + '" class="axis-label" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">log market cap</text>');
    sc.live.forEach(function (p) { parts.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.4" class="dot-live"/>'); });
    parts.push('<line x1="' + X(sc.line[0][0]).toFixed(1) + '" y1="' + Y(sc.line[0][1]).toFixed(1) + '" x2="' + X(sc.line[1][0]).toFixed(1) + '" y2="' + Y(sc.line[1][1]).toFixed(1) + '" class="fit-line"/>');
    sc.board.forEach(function (p) { parts.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.4" class="dot-board"/>'); });
    parts.push('</svg>');
    box.appendChild(el('div', { class: 'scatter', html: parts.join('') }));
    wrap.appendChild(box);
  }

  // A plain table view (live tokens, set aside): headers, rows of cells, a note.
  function simpleTable(headers, rows, countText, note) {
    document.getElementById('count').textContent = countText;
    var table = el('table');
    table.appendChild(el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { class: h.num ? 'num' : '', text: h.text }); }))));
    var body = el('tbody');
    rows.forEach(function (cells) {
      var tr = el('tr', { onclick: function () {} });
      cells.forEach(function (c) {
        var td = el('td', { class: c.cls || (c.num ? 'num' : '') });
        if (c.pair) {
          td.appendChild(el('span', { class: 'name', text: c.pair[0] }));
          td.appendChild(el('span', { class: 'slug', text: c.pair[1] }));
        } else {
          td.textContent = c.text;
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    app.innerHTML = '';
    app.appendChild(el('p', { class: 'empty', text: note }));
    app.appendChild(table);
  }

  function renderLive() {
    simpleTable(
      [{ text: 'Protocol' }, { text: 'Category' }, { text: 'TVL', num: true }, { text: 'Market cap', num: true }, { text: 'Mcap / TVL', num: true }, { text: '7d', num: true }],
      DATA.live.map(function (r) {
        var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
        return [
          { pair: [r.name, r.slug] }, { text: r.category || 'Uncategorised' },
          { text: fmtUsd(r.tvl_usd), num: true }, { text: fmtUsd(r.mcap_usd), num: true },
          { text: ratio === null ? 'n/a' : fmtMult(ratio), num: true },
          { text: fmtPct(r.change_7d), num: true, cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') },
        ];
      }),
      DATA.live_size + ' live-token protocols, by market cap',
      'These protocols already trade, so the board shows the market\u2019s own value for them, never a model\u2019s estimate. Their market caps against their TVLs are what fit the regression that prices the pre-token board.');
  }

  function renderSetAside() {
    simpleTable(
      [{ text: 'Protocol' }, { text: 'Category' }, { text: 'TVL', num: true }, { text: 'Why it is not ranked' }],
      DATA.set_aside.map(function (r) {
        return [
          { pair: [r.name, r.slug] }, { text: r.category || 'Uncategorised' },
          { text: fmtUsd(r.tvl_usd), num: true }, { text: r.reason },
        ];
      }),
      DATA.set_aside.length + ' protocols set aside, by TVL',
      'The board ranks a protocol only when it records no token and stands alone. Everything else is listed here with its reason, so all 758 protocols are accounted for.');
  }

  function renderModel() {
    document.getElementById('count').textContent = 'Model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of;
    renderMethod();
    var cal = DATA.calibration;
    var reg = cal.regression;
    var odds = DATA.odds;
    var grid = el('div', { class: 'model-grid' });
    var method = el('div', { class: 'card' });
    method.appendChild(el('h3', { text: 'How the implied value is built' }));
    method.appendChild(el('p', { html: 'Every row\u2019s implied value is an expected value: <code>value if it launches \u00d7 launch odds</code>. The value is <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth</code>. The intercept and slope come from an ordinary least-squares regression of log market cap on log TVL across this snapshot\u2019s own live-token protocols — the market does not price TVL linearly, so a protocol ten times larger is worth roughly four to five times as much, not ten. A flat multiple would overvalue the biggest protocols several times over.' }));
    method.appendChild(el('p', { html: 'The category factor is the category\u2019s median residual from that line, shrunk toward 1 by n/(n+3). A category needs at least 5 live peers to carry its own effect; below that, the model pools its super-category\u2019s peers instead — vaults and curators, money markets, trading, bridges, staking, real world — and a category with no poolable peers gets no adjustment. Growth enters with its own fitted coefficient (' + fmtNum(reg.growth_coef, 2) + '), bounded to \u00b115%.' }));
    method.appendChild(el('p', { html: 'The launch odds come from a logistic model fitted on the snapshot\u2019s own live/pre-token split: log TVL, log age, log chain count, the category\u2019s shrunk token rate (shrunk toward the base rate with a prior of 20), and kinship — whether the name shares a stem with a protocol that already records a token. Protocols with a kin record a token ' + Math.round(odds.kinship.rate_with_kin * 100) + '% of the time (' + odds.kinship.n_with_kin + ' protocols), against ' + Math.round(odds.kinship.rate_without_kin * 100) + '% without one. Growth is deliberately not an input: fast growth marks the pre-token phase itself, so it would punish exactly the momentum farmers want. Odds are bounded to 10%\u201390%.' }));
    method.appendChild(el('p', { html: 'Each row also carries a P25\u2013P75 range from the value model\u2019s held-out error spread: half of held-out market caps land inside it, nine in ten inside P10\u2013P90.' }));
    grid.appendChild(method);
    var box = el('div', { class: 'card sandbox' });
    box.appendChild(el('h3', { text: 'Model sandbox' }));
    box.appendChild(el('p', { text: 'Change the constants and the board re-ranks live, under your numbers. Nothing here changes the submitted board.' }));
    var slope = reg.slope, gw = DATA.model.growth_weight, ow = 1;
    if (sandbox !== null) { slope = sandbox.slope; gw = sandbox.growth_weight; ow = sandbox.odds_weight; }
    function slider(label, min, max, step, value, oninput) {
      var out = el('output', { text: value.toFixed(2) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), oninput: function () { out.textContent = parseFloat(input.value).toFixed(2); oninput(parseFloat(input.value)); } });
      return el('label', null, document.createTextNode(label + ' '), out, input);
    }
    box.appendChild(slider('TVL slope (fitted ' + fmtNum(reg.slope, 2) + ')', 0.3, 1, 0.01, slope, function (v) { setSandbox({ slope: v }); }));
    box.appendChild(slider('Growth weight', 0, 1, 0.05, gw, function (v) { setSandbox({ growth_weight: v }); }));
    box.appendChild(slider('Odds weight (1 = fitted odds)', 0, 1.5, 0.05, ow, function (v) { setSandbox({ odds_weight: v }); }));
    box.appendChild(el('button', { text: 'Reset to the shipped model', onclick: function () { sandbox = null; render(); } }));
    grid.appendChild(box);
    app.innerHTML = '';
    app.appendChild(grid);

    function section(title, note) {
      var card = el('div', { class: 'card wide' });
      card.appendChild(el('h3', { text: title }));
      if (note) card.appendChild(el('p', { text: note }));
      app.appendChild(card);
      return card;
    }
    function tableIn(card, headers, rows) {
      var table = el('table');
      table.appendChild(el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { class: h.num ? 'num' : '', text: h.text }); }))));
      var body = el('tbody');
      rows.forEach(function (cells) {
        body.appendChild(el('tr', { onclick: function () {} }, cells.map(function (c) { return el('td', { class: c.num ? 'num' : '', text: c.text }); })));
      });
      table.appendChild(body);
      card.appendChild(table);
    }
    var ab = section('Ablation: each stage earns its place out of sample',
      'Leave-one-out on the ' + reg.trimmed_count + ' trimmed live protocols: every stage is refitted with the held-out protocol removed, so these are honest out-of-sample numbers, not in-sample fits.');
    tableIn(ab,
      [{ text: 'Stage' }, { text: 'Median miss', num: true }, { text: 'Mean |error|', num: true }, { text: 'RMSE', num: true }, { text: 'Spearman', num: true }],
      cal.ablation.map(function (a) {
        return [{ text: a.stage }, { text: fmtMult(a.loo_median_factor), num: true }, { text: fmtNum(a.loo_mean_abs_log, 2), num: true }, { text: fmtNum(a.loo_rmse_log, 2), num: true }, { text: fmtNum(a.loo_spearman, 2), num: true }];
      }));
    var ts = cal.time_split;
    var rc = cal.range_check;
    var val = section('Held out by time, and the ranges',
      'Fit on the ' + ts.fit_count + ' live protocols listed before ' + ts.cut_date + ', price the ' + ts.test_count + ' listed after it: median miss ' + fmtMult(ts.median_factor) + ', ' + ts.within_3x_pct + '% within 3\u00d7. The ranges use the held-out error spread (\u03c3 = ' + fmtNum(rc.sigma_log, 2) + ' log points): P25\u2013P75 holds ' + fmtNum(rc.p25_p75_pct, 0) + '% of held-out market caps, P10\u2013P90 holds ' + fmtNum(rc.p10_p90_pct, 0) + '%.');
    tableIn(val,
      [{ text: 'Check' }, { text: 'Result', num: true }],
      [
        [{ text: 'Time split: median miss on the newer half' }, { text: fmtMult(ts.median_factor), num: true }],
        [{ text: 'Time split: share within 3\u00d7' }, { text: ts.within_3x_pct + '%', num: true }],
        [{ text: 'P25\u2013P75 range holds (held out)' }, { text: fmtNum(rc.p25_p75_pct, 0) + '%', num: true }],
        [{ text: 'P10\u2013P90 range holds (held out)' }, { text: fmtNum(rc.p10_p90_pct, 0) + '%', num: true }],
      ]);
    var od = section('Launch odds: fitted, held out, calibrated',
      'Logistic regression on ' + odds.train_count + ' protocols of the candidate shape (token or not). Features: log TVL, log age, log chain count, the category\u2019s token rate shrunk toward the base rate (prior 20), and kinship. Held out by leave-one-out it calls ' + odds.loo_correct + ' of ' + odds.train_count + ' right (' + Math.round(odds.loo_accuracy * 100) + '%) against a ' + Math.round(odds.base_rate * 100) + '% base rate, Brier ' + fmtNum(odds.loo_brier, 3) + '. The calibration table shows the odds mean what they say: protocols scored near 20% launch about 20% of the time.');
    tableIn(od,
      [{ text: 'Predicted odds' }, { text: 'Actual token rate', num: true }, { text: 'Protocols', num: true }],
      odds.calibration.map(function (c) {
        return [{ text: Math.round(c.predicted * 100) + '%' }, { text: Math.round(c.actual * 100) + '%', num: true }, { text: String(c.count), num: true }];
      }));
    var rj = section('Features the backtest rejected',
      'Tried, measured on the same held-out set, and left out — the page says so rather than quietly shipping them.');
    tableIn(rj,
      [{ text: 'Feature' }, { text: 'What the backtest showed' }],
      [
        [{ text: 'Chain count as a value regressor' }, { text: 'Coefficient \u22120.13, t = \u22120.74: not significant; the median miss improves a little but the RMSE and the time split both get worse.' }],
        [{ text: 'A fitted age effect on value' }, { text: 'Tested as a log term, a young-protocol indicator, an exponential decay, a log age capped at two years, and an age-by-size interaction: every form comes out at zero or makes the held-out miss worse. Age enters the launch odds instead, where it is fitted.' }],
        [{ text: 'Kinship in the value fit' }, { text: 'Coefficient +0.06, no held-out gain: kinship predicts whether a token exists, not what it is worth. It enters the launch odds, where it adds 10 held-out calls.' }],
        [{ text: 'Per-category slopes' }, { text: 'Held-out median miss worse than one shared slope: too few protocols per category to fit a slope.' }],
        [{ text: 'A piecewise size curve' }, { text: 'Held-out median miss much worse: the single power law is the better shape.' }],
        [{ text: 'Growth in the launch odds' }, { text: 'It looks better out of sample, but the signal is the pre-token phase itself: protocols growing over 5% a week record a token 18% of the time, against 68% for those shrinking 5\u201320%. Shipping it would slash the odds of exactly the momentum the board is meant to surface.' }],
      ]);
    var cat = section('Category effects', 'The factor each category gets, and where it comes from.');
    tableIn(cat,
      [{ text: 'Category' }, { text: 'Live peers', num: true }, { text: 'Raw factor', num: true }, { text: 'Factor used', num: true }, { text: 'Source' }],
      cal.rows.map(function (r) {
        var src = r.source === 'category' ? 'Own peers' : r.source === 'group' ? r.group + ' pool (' + r.group_peers + ' peers)' : 'No adjustment';
        return [{ text: r.category }, { text: String(r.peers), num: true }, { text: r.raw_factor === null ? 'n/a' : fmtMult(r.raw_factor), num: true }, { text: fmtMult(r.factor), num: true }, { text: src }];
      }));
  }

  function setSandbox(patch) {
    if (sandbox === null) sandbox = { slope: DATA.calibration.regression.slope, growth_weight: DATA.model.growth_weight, odds_weight: 1 };
    Object.assign(sandbox, patch);
    if (state.tab !== 'pre-token') { state.tab = 'pre-token'; syncTabs(); }
    render();
  }

  function factorLabel(row) {
    if (row.category_source === 'category') return 'Factor, own peers (' + row.category_peers + ')';
    if (row.category_source === 'group') return 'Factor, ' + row.category_group + ' pool (' + row.category_peers + ')';
    return 'Factor, no adjustment';
  }

  function factorNote(row) {
    if (row.category_source === 'category') return 'Category factor: median residual of ' + row.category_peers + ' live ' + row.category + ' protocols from the size line, shrunk toward 1.';
    if (row.category_source === 'group') return 'Category factor: the ' + row.category_group + ' pool\u2019s median residual (' + row.category_peers + ' live peers) — too few live ' + (row.category || 'peers') + ' to calibrate the category alone.';
    return 'Category factor: none — too few live peers in this category or its group to calibrate an adjustment, so the size line stands alone.';
  }

  // One protocol, a full page: the number built line by line, the odds built term
  // by term, the farm economics with the T-bill it forgoes and the ticket it pays
  // from, the drop-share by ticket matrix, and the farm plan as a table.
  function renderDetail(slug) {
    var row = null;
    viewRows().forEach(function (r) { if (r.slug === slug) row = r; });
    if (row === null) { state.tab = 'pre-token'; renderBoard(); return; }
    var reg = sandbox !== null ? Object.assign({}, DATA.calibration.regression, { slope: sandbox.slope }) : DATA.calibration.regression;
    var model = sandbox !== null ? Object.assign({}, DATA.model, sandbox) : DATA.model;
    var v = impliedOf(row, model, reg, row.category_factor, sandbox !== null ? sandbox.odds_weight : 1);
    var n = netOf(row, state.ticket, state.drop);
    var verdict = verdictOf(n.net);
    document.getElementById('count').textContent = 'Rank #' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + scopeLabel(row.scope);
    app.innerHTML = '';
    app.appendChild(el('button', { class: 'back', text: '\u2190 Back to the board', onclick: closeDetail }));
    var head = el('div', { class: 'detail-head' });
    head.appendChild(el('div', null,
      el('h2', { text: row.name }),
      el('p', { class: 'sub', text: row.slug + ' \u00b7 ' + (row.category || 'Uncategorised') + ' \u00b7 rank #' + row.rank + ' (' + scopeLabel(row.scope) + ')' })));
    head.appendChild(el('div', { class: 'big' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'Expected launch value' })));
    app.appendChild(head);
    var chains = row.chains || [];
    var chainText = chains.length <= 3 ? chains.join(', ') : chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
    app.appendChild(kvGrid([
      [fmtUsd(row.value_if_launches_usd), 'Value if it launches'],
      [Math.round(row.launch_odds * 100) + '%', 'Launch odds'],
      [fmtUsd(row.range_low_usd) + ' \u2013 ' + fmtUsd(row.range_high_usd), 'P25\u2013P75 range'],
      [fmtUsd(row.tvl_usd), 'TVL'],
      [fmtPct(row.change_7d), 'TVL change, 7d'],
      [fmtAge(row.age_days), 'Running with no token'],
      [chainText || 'n/a', 'Chains'],
      [fmtMult(row.category_factor), factorLabel(row)],
      [row.kinship ? 'Yes' : 'No', row.kinship ? 'Kinship: its name shares a stem with a protocol that records a token' : 'Kinship: no name-stem kin among the tokens that trade'],
      [fmtUsd2(n.perHour) + '/h', 'Net per hour of work ($' + state.ticket.toLocaleString('en-US') + ', ' + Math.round(state.drop * 100) + '%)'],
    ]));
    app.appendChild(el('h3', { text: 'How the number is built' }));
    var oc = row.odds_components;
    app.appendChild(mathBlock([
      ['Size line: exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln TVL)', fmtUsd(v.base)],
      ['Category factor (' + (row.category || 'uncategorised') + ')', '\u00d7 ' + fmtMult(row.category_factor)],
      ['Growth (' + (v.growthPct > 0 ? '+' : '') + v.growthPct.toFixed(2) + '% 7d)', '\u00d7 ' + v.growthMult.toFixed(2)],
      ['Value if it launches', fmtUsd(v.value)],
      ['Launch odds \u2014 constant', fmtNum(oc.constant, 2)],
      ['Launch odds \u2014 size (log TVL)', fmtNum(oc.tvl, 2)],
      ['Launch odds \u2014 time with no token (' + fmtAge(row.age_days) + ')', fmtNum(oc.age, 2)],
      ['Launch odds \u2014 chains (' + (row.chains || []).length + ')', fmtNum(oc.chains, 2)],
      ['Launch odds \u2014 category token rate (' + Math.round(row.category_token_rate * 100) + '%)', fmtNum(oc.category, 2)],
      ['Launch odds \u2014 kinship', (oc.kinship >= 0 ? '+' : '') + fmtNum(oc.kinship, 2)],
      ['Launch odds (logit ' + fmtNum(oc.total, 2) + ')', '\u00d7 ' + v.odds.toFixed(2)],
      ['Expected launch value', fmtUsd(v.implied)],
    ], factorNote(row) + ' The odds are a logistic model fitted on the snapshot\u2019s own live/pre-token split; kinship adds +' + fmtNum(DATA.odds.beta[5], 2) + ' to the logit when the name shares a stem with a token that trades.'));
    if (row.comparables && row.comparables.length > 0) {
      app.appendChild(el('h3', { text: 'Nearest live comparables' }));
      app.appendChild(mathBlock(
        row.comparables.map(function (c) { return [c.name, fmtMult(c.multiple) + ' mcap/TVL']; }),
        'The three live-token protocols nearest this size in its super-category. Their multiples are what the size line is fitted on.'));
    }
    var worth = el('h3', { text: 'Worth farming? ' });
    worth.appendChild(el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict }));
    app.appendChild(worth);
    var tb = tbillForgone(row, state.ticket);
    var pf = paysFrom(row, state.drop);
    app.appendChild(mathBlock([
      ['Your slice of the drop ($' + state.ticket.toLocaleString('en-US') + ' of $' + fmtUsd(row.tvl_usd).slice(1) + ' TVL)', (n.slice * 100).toFixed(4) + '%'],
      ['Share of the launch (' + Math.round(state.drop * 100) + '% drop)', fmtUsd2(n.gross)],
      ['Gas for the whole plan', '\u2212 ' + fmtUsd2(row.gas_total_usd)],
      ['Net, after gas', fmtUsd2(n.net)],
      ['Per hour (' + row.labor_hours.toFixed(1) + 'h of work)', fmtUsd2(n.perHour) + '/h'],
      ['T-bill forgone (4% over the ' + holdDaysFor(row.age_days) + '-day hold)', '\u2212 ' + fmtUsd2(tb)],
      ['Net after the T-bill', fmtUsd2(n.net - tb)],
      ['Pays from a ticket of', pf === null ? 'n/a' : fmtUsd2(pf)],
    ], 'The slice is the conservative case, as if every dollar of TVL farmed. The drop share is the one assumption — change the ticket and the drop share in the filters and every verdict re-computes. FARM means more than $' + DATA.model.farm_threshold_usd + ' after gas.'));
    app.appendChild(el('h3', { text: 'Net at every ticket and drop share' }));
    var matrix = el('table', { class: 'matrix' });
    var mhead = el('tr', null, el('th', { text: 'Drop \\ ticket' }));
    DATA.model.tickets.forEach(function (t) { mhead.appendChild(el('th', { class: 'num', text: '$' + t.toLocaleString('en-US') })); });
    matrix.appendChild(el('thead', null, mhead));
    var mbody = el('tbody');
    DATA.model.drop_shares.forEach(function (d) {
      var mrow = el('tr', null, el('td', { text: Math.round(d * 1000) / 10 + '%' }));
      DATA.model.tickets.forEach(function (t) {
        var nn = netOf(row, t, d);
        var vv = verdictOf(nn.net);
        var cur = t === state.ticket && d === state.drop;
        mrow.appendChild(el('td', { class: 'num ' + (nn.net >= 0 ? 'up' : 'down') + (cur ? ' current' : ''), text: fmtUsd2(nn.net) + ' \u00b7 ' + vv }));
      });
      mbody.appendChild(mrow);
    });
    matrix.appendChild(mbody);
    app.appendChild(matrix);
    app.appendChild(el('h3', { text: 'Farm plan' }));
    var plan = el('table', { class: 'plan' });
    plan.appendChild(el('thead', null, el('tr', null,
      el('th', { class: 'num', text: '#' }), el('th', { text: 'Step' }),
      el('th', { text: 'Cost' }), el('th', { text: 'Time' }))));
    var pbody = el('tbody');
    (row.farm_steps || []).forEach(function (s, i) {
      pbody.appendChild(el('tr', { onclick: function () {} },
        el('td', { class: 'num rank', text: String(i + 1) }),
        el('td', { text: s.text }),
        el('td', { text: s.cost }),
        el('td', { text: s.time })));
    });
    plan.appendChild(pbody);
    app.appendChild(plan);
  }

  function openDetail(slug) {
    state.selected = slug;
    state.tab = 'detail';
    render();
  }

  function closeDetail() {
    state.selected = null;
    state.tab = 'pre-token';
    render();
  }

  function syncTabs() {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab || (state.tab === 'detail' && b.getAttribute('data-tab') === 'pre-token'));
    });
    document.getElementById('controls').style.display = state.tab === 'pre-token' ? '' : 'none';
    document.getElementById('formula').style.display = state.tab === 'pre-token' ? '' : 'none';
    document.getElementById('method').style.display = state.tab === 'model' ? '' : 'none';
    // The detail view is a full page of its own: the board-level summary cards
    // and the snapshot accounting stay on the board, so the build and the farm
    // plan start inside the first screen instead of below it.
    document.getElementById('stats').style.display = state.tab === 'detail' ? 'none' : '';
    document.getElementById('accounting').style.display = state.tab === 'detail' ? 'none' : '';
  }

  function render() {
    syncTabs();
    app.setAttribute('aria-busy', 'false');
    if (state.tab === 'live') renderLive();
    else if (state.tab === 'set-aside') renderSetAside();
    else if (state.tab === 'model') renderModel();
    else if (state.tab === 'detail') renderDetail(state.selected);
    else renderBoard();
  }

  function init() {
    document.getElementById('asof').textContent = DATA.as_of;
    document.getElementById('selfcheck').textContent = 'checkBoard(): ' + DATA.check_board_rows_match + '/' + DATA.board_size + ' rows equal board.json.';
    renderAccounting();
    var stats = document.getElementById('stats');
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Protocols ranked' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('span', { text: 'Total expected value' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: fmtMult(DATA.calibration.regression.loo_median_factor) }), el('span', { text: 'Out-of-sample miss' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: Math.round(DATA.calibration.range_check.p25_p75_pct) + '%' }), el('span', { text: 'Range holds (held out)' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: Math.round(DATA.odds.loo_accuracy * 100) + '%' }), el('span', { text: 'Launch odds held out' })));
    var farmCount = DATA.rows.filter(function (r) { return verdictOf(netOf(r, 1000, 0.07).net) === 'FARM'; }).length;
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(farmCount) }), el('span', { text: 'Worth farming' })));
    var bestHour = null;
    DATA.rows.forEach(function (r) {
      var n = netOf(r, 1000, 0.07);
      if (verdictOf(n.net) === 'FARM' && (bestHour === null || n.perHour > bestHour)) bestHour = n.perHour;
    });
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: bestHour === null ? 'n/a' : fmtUsd2(bestHour) + '/h' }), el('span', { text: 'Best net per hour' })));
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    var catSel = document.getElementById('category');
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    var chainSel = document.getElementById('chain');
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    catSel.addEventListener('change', function (e) { state.category = e.target.value; render(); });
    chainSel.addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    document.getElementById('scope').addEventListener('change', function (e) { state.scope = e.target.value; render(); });
    document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; render(); });
    document.getElementById('ticket').addEventListener('change', function (e) { state.ticket = parseInt(e.target.value, 10); render(); });
    document.getElementById('drop').addEventListener('change', function (e) { state.drop = parseFloat(e.target.value); render(); });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
    // Screenshot states: ?shot=detail&slug=... opens one protocol; ?shot=filtered&...
    // applies a filter (verdict, sort, category). The page is otherwise identical.
    var params = new URLSearchParams(window.location.search);
    if (params.get('shot') === 'filtered') {
      if (params.get('category')) { state.category = params.get('category'); catSel.value = state.category; }
      if (params.get('verdict')) { state.verdict = params.get('verdict'); document.getElementById('verdict').value = state.verdict; }
      if (params.get('sort') === 'net') { state.sort = 'net'; state.dir = -1; }
    }
    render();
    if (params.get('shot') === 'detail' && params.get('slug')) openDetail(params.get('slug'));
    window.__radarReady = true;
  }

  init();
})();
