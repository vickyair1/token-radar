// Token Radar's dashboard (model radar-6): reads window.RADAR (written by main.ts)
// and renders the board with its out-of-sample evidence and a live integrity strip,
// full-page detail, live/set-aside views, and the model tab. No network. Model:
// implied = exp(intercept + slope x ln(TVL)) x category factor x growth x launch odds.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', verdict: 'all', deposit: 'plan', drop: 0.07, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  function planDeposit(row) {
    var m = DATA.model;
    return Math.min(m.deposit_cap_usd, Math.max(m.deposit_floor_usd, Math.round(row.tvl_usd * m.deposit_pct)));
  }
  function depositOf(row, deposit) {
    return deposit === 'plan' ? planDeposit(row) : deposit;
  }
  // The verdicts are a farmer's arithmetic, not a score: the slice of the drop is
  // the deposit's share of the protocol's whole TVL — the conservative case, as if
  // every dollar of TVL farmed — times the drop share times the row's expected launch
  // value, minus the plan's gas. FARM means the net clears $10, pays $25 an hour,
  // and beats the 4% T-bill the deposit forgoes over the hold.
  function netOf(row, deposit, drop) {
    var dep = depositOf(row, deposit);
    var slice = dep / row.tvl_usd;
    var gross = row.implied_value_usd * drop * slice;
    var net = gross - row.gas_total_usd;
    return { deposit: dep, slice: slice, gross: gross, net: net, perHour: net / row.labor_hours, tbill: tbillForgone(row, dep) };
  }
  function verdictOf(n) {
    if (n.net > DATA.model.farm_threshold_usd && n.perHour >= 25 && n.net > n.tbill) return 'FARM';
    if (n.net > 0) return 'MARGINAL';
    return 'SKIP';
  }
  // What the deposit would earn in a 4% T-bill over the plan's hold, foregone by farming.
  function tbillForgone(row, deposit) {
    return deposit * 0.04 * holdDaysFor(row.age_days) / 365;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // FNV-1a, the same hash main.ts stamps into data.js: the integrity strip recomputes it.
  function fnv1a(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
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

  // Rows as the board shows them: the shipped ranking.
  function viewRows() {
    return DATA.rows.slice();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.scope !== 'all' && r.scope !== state.scope) return false;
      if (state.verdict !== 'all') {
        var v = verdictOf(netOf(r, state.deposit, state.drop));
        if (state.verdict === 'farm' && v !== 'FARM') return false;
        if (state.verdict === 'marginal' && v !== 'MARGINAL') return false;
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
      if (key === 'value') return r.value_if_launches_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'odds') return r.launch_odds;
      if (key === 'net') return netOf(r, state.deposit, state.drop).net;
      if (key === 'perhour') return netOf(r, state.deposit, state.drop).perHour;
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

  // The accounting chips: every protocol in exactly one bucket.
  function renderAccounting() {
    var wrap = document.getElementById('accounting');
    wrap.innerHTML = '';
    var chips = el('div', { class: 'acct-chips' });
    chips.appendChild(el('b', { text: DATA.total_protocols + ' protocols: ' }));
    DATA.accounting.forEach(function (a) {
      chips.appendChild(el('span', { class: 'acct' + (a.key === 'ranked' ? ' ranked' : ''), title: a.note, text: a.count + ' ' + a.label.toLowerCase() }));
    });
    wrap.appendChild(chips);
  }

  // The integrity strip: six checks, recomputed live from the page's own data.
  function renderIntegrity() {
    var wrap = document.getElementById('integrity');
    wrap.innerHTML = '';
    var rows = DATA.rows;
    var ordered = rows.every(function (r, i) { return r.rank === i + 1 && (i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd); });
    var sumImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var sumValue = rows.reduce(function (a, r) { return a + r.value_if_launches_usd; }, 0);
    var totalsOk = sumImplied === DATA.total_implied_usd && sumValue === DATA.total_value_if_launches_usd;
    var checksum = fnv1a(rows.map(function (r) { return r.slug + ':' + r.implied_value_usd; }).join('\n'));
    var checksumOk = checksum === DATA.board_checksum;
    var wl = rows.filter(function (r) { return r.scope === 'watchlist'; }).length;
    var ledgerOk = rows.length + DATA.set_aside.length === DATA.total_protocols;
    var matchOk = DATA.check_board_rows_match === DATA.board_size;
    var badges = [
      ['\u2713 this table = board.json: ' + DATA.check_board_rows_match + ' of ' + DATA.board_size + ' rows agree', matchOk],
      ['\u2713 ranks 1\u2013' + DATA.board_size + ' in order, values never rise', ordered],
      ['\u2713 totals equal: ' + fmtUsd(sumImplied) + ' expected \u00b7 ' + fmtUsd(sumValue) + ' if launches', totalsOk],
      ['\u2713 checksum ' + checksum + ' = main.ts', checksumOk],
      ['\u2713 watchlist ' + wl + ' of ' + DATA.watchlist_size + ' ranked', wl === DATA.watchlist_size],
      ['\u2713 ledger ' + DATA.total_protocols + ' of ' + DATA.total_protocols + ' protocols', ledgerOk],
    ];
    badges.forEach(function (b) {
      wrap.appendChild(el('span', { class: 'badge' + (b[1] ? '' : ' fail'), text: (b[1] ? '' : '\u2717 ') + b[0].replace(/^\u2713 /, '') }));
    });
  }

  // The evidence section: the ablation tables and the range honesty, on the board.
  function renderEvidence() {
    var wrap = document.getElementById('evidence');
    wrap.innerHTML = '';
    var cal = DATA.calibration;
    var odds = DATA.odds;
    function evTable(headers, rows) {
      var table = el('table');
      table.appendChild(el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { class: h.num ? 'num' : '', text: h.text }); }))));
      var body = el('tbody');
      rows.forEach(function (cells) {
        body.appendChild(el('tr', null, cells.map(function (c) {
          var td = el('td', { class: (c.num ? 'num' : '') + (c.cls ? ' ' + c.cls : '') });
          td.textContent = c.text;
          return td;
        })));
      });
      table.appendChild(body);
      return table;
    }
    function verdictCell(v) {
      if (v === 'baseline') return { text: 'baseline', cls: 'notkept' };
      if (v === 'kept') return { text: 'kept', cls: 'kept' };
      return { text: 'tested, not kept', cls: 'notkept' };
    }
    var valueBox = el('div', { class: 'ev-box' });
    valueBox.appendChild(el('h3', { text: 'Value if it launches \u2014 typical miss, ' + cal.regression.trimmed_count + ' traded tokens' }));
    valueBox.appendChild(evTable(
      [{ text: 'Term, added in order' }, { text: 'Leave-one-out', num: true }, { text: 'Time-split', num: true }, { text: '' }],
      cal.ablation.map(function (a) {
        return [{ text: a.stage.replace(/^\+ /, '+ ') }, { text: fmtMult(a.loo_median_factor), num: true }, { text: fmtMult(a.time_split_median_factor), num: true }, verdictCell(a.verdict)];
      })));
    wrap.appendChild(valueBox);
    var oddsBox = el('div', { class: 'ev-box' });
    oddsBox.appendChild(el('h3', { text: 'Token odds \u2014 Brier score, ' + odds.train_count + ' peers' }));
    oddsBox.appendChild(evTable(
      [{ text: 'Term removed' }, { text: 'Leave-one-out', num: true }, { text: 'Time-split', num: true }, { text: '' }],
      odds.odds_ablation.map(function (a) {
        var v = a.verdict === 'baseline' ? { text: 'baseline', cls: 'notkept' } : a.verdict === 'kept' ? { text: 'kept', cls: 'kept' } : { text: 'dropped', cls: 'notkept' };
        return [{ text: a.term }, { text: fmtNum(a.loo_brier, 3), num: true }, { text: fmtNum(a.time_split_brier, 3), num: true }, v];
      })));
    oddsBox.appendChild(el('p', { text: 'Kept when removing it raises the mean held-out Brier. Base rate Brier ' + fmtNum(odds.base_brier, 3) + '.' }));
    wrap.appendChild(oddsBox);
    var rangeBox = el('div', { class: 'ev-box' });
    rangeBox.appendChild(el('h3', { text: 'Is the printed range honest?' }));
    var rc = cal.range_check;
    var ts = cal.time_split;
    rangeBox.appendChild(evTable(
      [{ text: 'Share of real caps' }, { text: 'Leave-one-out', num: true }, { text: 'Time-split', num: true }],
      [
        [{ text: 'within \u00d73 of the model' }, { text: Math.round(rc.within_3x_pct) + '%', num: true }, { text: Math.round(ts.within_3x_pct) + '%', num: true }],
        [{ text: 'inside P25\u2013P75, stated 50%' }, { text: Math.round(rc.p25_p75_pct) + '%', num: true }, { text: Math.round(ts.p25_p75_pct) + '%', num: true }],
        [{ text: 'inside P10\u2013P90, stated 80%' }, { text: Math.round(rc.p10_p90_pct) + '%', num: true }, { text: Math.round(ts.p10_p90_pct) + '%', num: true }],
      ]));
    rangeBox.appendChild(el('p', { text: 'Reading it: growth and age fail to price a token, so they enter through the odds.' }));    wrap.appendChild(rangeBox);
  }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    var farmCount = rows.filter(function (r) { return verdictOf(netOf(r, state.deposit, state.drop)) === 'FARM'; }).length;
    var tvl = rows.reduce(function (a, r) { return a + r.tvl_usd; }, 0);
    var implied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var depLabel = state.deposit === 'plan' ? 'plan' : '$' + state.deposit.toLocaleString('en-US');
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' rows \u00b7 ' + fmtUsd(tvl) + ' TVL \u00b7 ' + fmtUsd(implied) + ' implied \u00b7 ' + farmCount + ' worth farming at ' + depLabel + ' and ' + Math.round(state.drop * 100) + '%';
    var reg = DATA.calibration.regression;
    var boot = DATA.bootstrap;
    var f = document.getElementById('formula');
    f.innerHTML = '';
    f.appendChild(el('b', { text: 'Implied value = ' }));
    f.appendChild(document.createTextNode('exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln TVL) \u00d7 category factor \u00d7 growth \u00d7 launch odds (TVL, age, chains, category, kinship); multiple at $100M TVL \u00d7' + fmtNum(boot.multiple_at_100m_mean, 2) + ' \u00b1 ' + fmtNum(boot.multiple_at_100m_se, 2) + ', slope ' + fmtNum(boot.slope_mean, 2) + ' \u00b1 ' + fmtNum(boot.slope_se, 2) + ' (' + boot.refits + ' bootstrap refits).'));
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
      ['If it launches', 'value', 'num'],
      ['Implied value', 'implied', 'num'], ['Verdict \u00b7 net of fees', 'net', null],
      ['Net / hour', 'perhour', 'num'],
    ];
    var head = el('tr');
    cols.forEach(function (c) {
      head.appendChild(c[1] === null ? el('th', { class: c[2] || '', text: c[0] }) : sortHeader(c[0], c[1], c[2]));
    });
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var n = netOf(r, state.deposit, state.drop);
      var verdict = verdictOf(n);
      var chains = (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '');
      var tr = el('tr', { onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num rank' }, document.createTextNode(String(r.rank)), el('span', { class: 'range-col', text: r.rank_range.low + '\u2013' + r.rank_range.high })),
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'tag' + (r.scope === 'watchlist' ? '' : ' early'), text: scopeLabel(r.scope) }), el('span', { class: 'catline', text: (r.category || 'Uncategorised') + (chains ? ' \u00b7 ' + chains : '') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }),
        el('td', { class: 'num', text: fmtUsd(r.value_if_launches_usd) }),
        el('td', { class: 'num implied' }, document.createTextNode(fmtUsd(r.implied_value_usd) + ' '), el('span', { class: 'range', text: fmtUsd(r.range_low_usd) + '\u2013' + fmtUsd(r.range_high_usd) })),
        el('td', null, el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict + ' ' + fmtUsd2(n.net) }), el('span', { class: 'feesub', text: fmtUsd2(n.gross) + ' drop \u2212 ' + fmtUsd2(r.gas_total_usd) + ' fees' })),
        el('td', { class: 'num ' + (n.perHour >= 0 ? 'up' : 'down'), text: fmtUsd2(n.perHour) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    app.innerHTML = '';
    app.appendChild(table);
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
      'These protocols already trade, so the board shows the market\u2019s own value for them. Their caps against their TVLs fit the regression that prices the pre-token board.');
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
      'The board ranks a protocol only when it records no token and stands alone. The rest are listed here with their reason.');
  }

  function renderModel() {
    document.getElementById('count').textContent = 'Model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of;
    var cal = DATA.calibration;
    var reg = cal.regression;
    var odds = DATA.odds;
    var method = el('div', { class: 'card' });
    method.appendChild(el('h3', { text: 'How the implied value is built' }));
    method.appendChild(el('p', { html: 'Every row\u2019s implied value is an expected value: <code>value if it launches \u00d7 launch odds</code>. The value is <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth</code>. The intercept and slope come from an ordinary least-squares regression of log market cap on log TVL across this snapshot\u2019s own live-token protocols — the market does not price TVL linearly, so a protocol ten times larger is worth roughly four to five times as much, not ten. A flat multiple would overvalue the biggest protocols several times over.' }));
    method.appendChild(el('p', { html: 'The category factor is the category\u2019s median residual from that line, shrunk toward 1 by n/(n+3). A category needs at least 5 live peers to carry its own effect; below that, the model pools its super-category\u2019s peers instead, and a category with no poolable peers gets no adjustment. Growth enters with its own fitted coefficient (' + fmtNum(reg.growth_coef, 2) + '), bounded to \u00b115%.' }));
    method.appendChild(el('p', { html: 'The launch odds come from a logistic model fitted on the snapshot\u2019s own live/pre-token split: log TVL, log age, log chain count, the category\u2019s shrunk token rate (prior 20), and kinship — whether the name shares a stem with a protocol that already records a token. Protocols with a kin record a token ' + Math.round(odds.kinship.rate_with_kin * 100) + '% of the time (' + odds.kinship.n_with_kin + ' protocols), against ' + Math.round(odds.kinship.rate_without_kin * 100) + '% without one. Growth is deliberately not an input: fast growth marks the pre-token phase itself. Odds are bounded to 10%\u201390%.' }));
    method.appendChild(el('p', { html: 'Each row carries a P25\u2013P75 range from the value model\u2019s held-out error spread, and a rank range from ' + DATA.bootstrap.refits + ' bootstrap refits of both models (P5\u2013P95). The deposit plan sizes the ticket to the protocol: 0.02% of its TVL, capped at $10,000 and floored at $10. A verdict is the deposit\u2019s slice of the drop, net of the plan\u2019s gas: <b>FARM</b> clears $10, pays $25 an hour, and beats a 4% T-bill over the hold; <b>MARGINAL</b> is positive but misses a bar; <b>SKIP</b> is eaten by gas.' }));
    app.innerHTML = '';
    app.appendChild(method);

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
      'Leave-one-out on the ' + reg.trimmed_count + ' trimmed live protocols, and a time split (older half fits, newer half priced). A term is kept when it lowers the mean miss across both tests.');
    tableIn(ab,
      [{ text: 'Stage' }, { text: 'Leave-one-out', num: true }, { text: 'Time-split', num: true }, { text: 'Verdict' }],
      cal.ablation.map(function (a) {
        return [{ text: a.stage }, { text: fmtMult(a.loo_median_factor), num: true }, { text: fmtMult(a.time_split_median_factor), num: true }, { text: a.verdict }];
      }));
    var ts = cal.time_split;
    var rc = cal.range_check;
    var val = section('Held out by time, and the ranges',
      'Fit on the older half, price the newer half: median miss ' + fmtMult(ts.median_factor) + ', ' + Math.round(ts.within_3x_pct) + '% within 3\u00d7. Ranges use the held-out error spread (\u03c3 = ' + fmtNum(rc.sigma_log, 2) + ').');
    tableIn(val,
      [{ text: 'Check' }, { text: 'Leave-one-out', num: true }, { text: 'Time-split', num: true }],
      [
        [{ text: 'Median miss' }, { text: fmtMult(reg.loo_median_factor), num: true }, { text: fmtMult(ts.median_factor), num: true }],
        [{ text: 'Share within 3\u00d7' }, { text: Math.round(rc.within_3x_pct) + '%', num: true }, { text: Math.round(ts.within_3x_pct) + '%', num: true }],
        [{ text: 'P25\u2013P75 range holds (held out)' }, { text: fmtNum(rc.p25_p75_pct, 0) + '%', num: true }, { text: fmtNum(ts.p25_p75_pct, 0) + '%', num: true }],
        [{ text: 'P10\u2013P90 range holds (held out)' }, { text: fmtNum(rc.p10_p90_pct, 0) + '%', num: true }, { text: fmtNum(ts.p10_p90_pct, 0) + '%', num: true }],
      ]);
    var od = section('Launch odds: fitted, held out, calibrated',
      'Logistic regression on ' + odds.train_count + ' protocols of the candidate shape. Leave-one-out calls ' + odds.loo_correct + ' of ' + odds.train_count + ' right (' + Math.round(odds.loo_accuracy * 100) + '%) vs a ' + Math.round(odds.base_rate * 100) + '% base rate, Brier ' + fmtNum(odds.loo_brier, 3) + ' vs ' + fmtNum(odds.base_brier, 3) + ' base. The backward ablation refits without each term.');
    tableIn(od,
      [{ text: 'Term removed' }, { text: 'Leave-one-out Brier', num: true }, { text: 'Time-split Brier', num: true }, { text: 'Verdict' }],
      odds.odds_ablation.map(function (a) {
        return [{ text: a.term }, { text: fmtNum(a.loo_brier, 3), num: true }, { text: fmtNum(a.time_split_brier, 3), num: true }, { text: a.verdict }];
      }));
    var odc = section('Odds calibration',
      'The odds mean what they say: protocols scored near 20% launch about 20% of the time.');
    tableIn(odc,
      [{ text: 'Predicted odds' }, { text: 'Actual token rate', num: true }, { text: 'Protocols', num: true }],
      odds.calibration.map(function (c) {
        return [{ text: Math.round(c.predicted * 100) + '%' }, { text: Math.round(c.actual * 100) + '%', num: true }, { text: String(c.count), num: true }];
      }));
    var rj = section('Features the backtest rejected',
      'Tried, measured held out, and left out.');
    tableIn(rj,
      [{ text: 'Feature' }, { text: 'What the backtest showed' }],
      [
        [{ text: 'Chain count as a value regressor' }, { text: 't = \u22120.74. The LOO miss improves a little but the time split worsens (2.92\u00d7 vs 2.30\u00d7).' }],
        [{ text: 'A fitted age effect on value' }, { text: 'Every form tested comes out at zero or worse; the time split blows out to 8.74\u00d7. Age enters the launch odds instead.' }],
        [{ text: 'Kinship in the value fit' }, { text: 'Coefficient +0.06, no held-out gain: kinship predicts whether a token exists, not what it is worth.' }],
        [{ text: 'Per-category slopes' }, { text: 'Held-out miss worse than one shared slope: too few protocols per category.' }],
        [{ text: 'A piecewise size curve' }, { text: 'Held-out miss much worse: the single power law is the better shape.' }],
        [{ text: 'Growth in the launch odds' }, { text: 'Real signal, wrong target: protocols growing over 5% a week record a token 18% of the time, against 68% for those shrinking 5\u201320%.' }],
      ]);
    var cat = section('Category effects', 'The factor each category gets, and where it comes from.');
    tableIn(cat,
      [{ text: 'Category' }, { text: 'Live peers', num: true }, { text: 'Raw factor', num: true }, { text: 'Factor used', num: true }, { text: 'Source' }],
      cal.rows.map(function (r) {
        var src = r.source === 'category' ? 'Own peers' : r.source === 'group' ? r.group + ' pool (' + r.group_peers + ' peers)' : 'No adjustment';
        return [{ text: r.category }, { text: String(r.peers), num: true }, { text: r.raw_factor === null ? 'n/a' : fmtMult(r.raw_factor), num: true }, { text: fmtMult(r.factor), num: true }, { text: src }];
      }));
  }

  function factorNote(row) {
    if (row.category_source === 'category') return 'Category factor: median residual of ' + row.category_peers + ' live ' + row.category + ' protocols, shrunk toward 1.';
    if (row.category_source === 'group') return 'Category factor: the ' + row.category_group + ' pool\u2019s median residual (' + row.category_peers + ' peers) — too few live ' + (row.category || 'peers') + ' to calibrate alone.';
    return 'Category factor: none — too few live peers to calibrate, so the size line stands alone.';
  }

  function renderDetail(slug) {
    var row = null;
    viewRows().forEach(function (r) { if (r.slug === slug) row = r; });
    if (row === null) { state.tab = 'pre-token'; renderBoard(); return; }
    var reg = DATA.calibration.regression;
    var model = DATA.model;
    var v = impliedOf(row, model, reg, row.category_factor, 1);
    var n = netOf(row, state.deposit, state.drop);
    var verdict = verdictOf(n);
    document.getElementById('count').textContent = 'Rank #' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + scopeLabel(row.scope) + ' \u00b7 rank ' + row.rank_range.low + '\u2013' + row.rank_range.high + ' across bootstrap refits';
    app.innerHTML = '';
    app.appendChild(el('button', { class: 'back', text: '\u2190 Back to the board', onclick: closeDetail }));
    var head = el('div', { class: 'detail-head' });
    head.appendChild(el('div', null,
      el('h2', { text: row.name }),
      el('p', { class: 'sub', text: '#' + row.rank + ' of ' + DATA.board_size + ' \u00b7 rank ' + row.rank_range.low + '\u2013' + row.rank_range.high + ' across bootstrap refits \u00b7 ' + row.slug + ' \u00b7 ' + (row.category || 'Uncategorised') + ' (' + scopeLabel(row.scope) + ')' })));
    head.appendChild(el('div', { class: 'big' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'Expected launch value' })));
    app.appendChild(head);
    var chains = row.chains || [];
    var chainText = chains.length <= 3 ? chains.join(', ') : chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
    app.appendChild(kvGrid([
      [fmtUsd(row.value_if_launches_usd), 'Value if it launches'],
      [Math.round(row.launch_odds * 100) + '%', 'Launch odds'],
      [fmtUsd(row.range_low_usd) + ' \u2013 ' + fmtUsd(row.range_high_usd), 'P25\u2013P75 range'],
      [fmtUsd(row.tvl_usd), 'TVL'],
      [fmtAge(row.age_days), 'Running with no token'],
      [chainText || 'n/a', 'Chains'],
    ]));
    var cols = el('div', { class: 'detail-cols' });
    var left = el('div');
    var right = el('div');
    cols.appendChild(left);
    cols.appendChild(right);
    app.appendChild(cols);

    // Right column first in the reader's eye: the farm verdict, the matrix, the benchmarks.
    var hold = holdDaysFor(row.age_days);
    var farmTitle = el('h3', { text: 'Farm verdict ' });
    farmTitle.appendChild(el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict }));
    right.appendChild(farmTitle);
    var panel = el('div', { class: 'farm-panel' });
    var coverDrop = n.slice > 0 ? row.gas_total_usd / (row.implied_value_usd * n.slice) * 100 : null;
    var coverOdds = row.value_if_launches_usd * state.drop * n.slice > 0 ? row.gas_total_usd / (row.value_if_launches_usd * state.drop * n.slice) * 100 : null;
    panel.appendChild(el('p', { text: verdict + ': ' + fmtUsd2(n.deposit) + ' for ' + hold + ' days buys a modelled drop of ' + fmtUsd2(n.gross) + ' for ' + fmtUsd2(row.gas_total_usd) + ' of fees and ' + row.labor_hours.toFixed(1) + ' h of work, a net of ' + fmtUsd2(n.net) + ' (' + fmtUsd2(n.perHour) + ' an hour). Fees are covered while the drop stays above ' + (coverDrop === null ? 'n/a' : coverDrop.toFixed(2) + '%') + ' (model ' + Math.round(state.drop * 100) + '%) and the token odds above ' + (coverOdds === null ? 'n/a' : coverOdds.toFixed(1) + '%') + ' (peers imply ' + Math.round(row.launch_odds * 100) + '%).' }));
    var fg = el('div', { class: 'farm-grid' });
    [['At risk', fmtUsd2(n.deposit)], ['Fees, ' + hold + ' days', fmtUsd2(row.gas_total_usd)], ['Modelled drop', fmtUsd2(n.gross)], ['Net of fees', fmtUsd2(n.net)], ['Hands-on', row.labor_hours.toFixed(1) + ' h'], ['Net per hour', fmtUsd2(n.perHour)]].forEach(function (p) {
      fg.appendChild(el('div', null, el('b', { text: p[1] }), el('span', { text: p[0] })));
    });
    panel.appendChild(fg);
    right.appendChild(panel);
    right.appendChild(el('h3', { text: 'Net at every drop share and deposit' }));
    var deposits = [['Plan', 'plan'], ['$1,000', 1000], ['$10,000', 10000]];
    var matrix = el('table', { class: 'matrix' });
    var mhead = el('tr', null, el('th', { text: 'Drop \\ deposit' }));
    deposits.forEach(function (d) { mhead.appendChild(el('th', { class: 'num', text: d[0] === 'Plan' ? 'Plan ' + fmtUsd2(planDeposit(row)) : d[0] })); });
    matrix.appendChild(el('thead', null, mhead));
    var mbody = el('tbody');
    DATA.model.drop_shares.forEach(function (d) {
      var mrow = el('tr', null, el('td', { text: Math.round(d * 1000) / 10 + '%' }));
      deposits.forEach(function (dep) {
        var nn = netOf(row, dep[1], d);
        var vv = verdictOf(nn);
        var cur = dep[1] === state.deposit && d === state.drop;
        mrow.appendChild(el('td', { class: 'num ' + (nn.net >= 0 ? 'up' : 'down') + (cur ? ' current' : ''), text: fmtUsd2(nn.net) + ' \u00b7 ' + vv }));
      });
      mbody.appendChild(mrow);
    });
    matrix.appendChild(mbody);
    right.appendChild(matrix);
    right.appendChild(el('h3', { text: 'Benchmarks' }));
    var exitTvl = row.tvl_usd * 0.8;
    right.appendChild(mathBlock([
      ['Same deposit in a 4% T-bill, ' + hold + ' days', fmtUsd2(n.tbill)],
      ['Drop if a token launches (odds not applied)', fmtUsd2(row.value_if_launches_usd * state.drop * n.slice)],
      ['Fees covered above a drop share of', coverDrop === null ? 'n/a' : coverDrop.toFixed(2) + '%'],
      ['Fees covered above token odds of', coverOdds === null ? 'n/a' : coverOdds.toFixed(1) + '%'],
      ['Exit rule: withdraw if TVL prints below', fmtUsd(exitTvl) + ' (\u221220% from today)'],
    ], 'Drop = implied \u00d7 drop share \u00d7 deposit \u00f7 TVL; net = drop \u2212 fees. Yield left out.'));
    right.appendChild(el('h3', { text: 'Farm plan \u00b7 ' + (row.farm_steps || []).length + ' steps' }));
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
    right.appendChild(plan);

    // Left column: how the number is built, then the nearest priced peers.
    left.appendChild(el('h3', { text: 'How the figure is made' }));
    var oc = row.odds_components;
    left.appendChild(mathBlock([
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
      left.appendChild(el('h3', { text: 'Nearest priced peers \u00b7 their tokens trade' }));
      var comp = el('table');
      comp.appendChild(el('thead', null, el('tr', null,
        el('th', { text: 'Token' }), el('th', { class: 'num', text: 'Cap / TVL' }), el('th', { class: 'num', text: 'Cap \u00f7 held-out model' }))));
      var cbody = el('tbody');
      row.comparables.forEach(function (c) {
        cbody.appendChild(el('tr', { onclick: function () {} },
          el('td', { text: c.name }),
          el('td', { class: 'num', text: fmtMult(c.multiple) }),
          el('td', { class: 'num', text: c.held_out_ratio > 0 ? '\u00d7' + fmtNum(c.held_out_ratio, 2) : 'n/a' })));
      });
      comp.appendChild(cbody);
      left.appendChild(comp);
      left.appendChild(el('p', { class: 'ev-note', text: 'The ' + row.comparables.length + ' live-token protocols nearest this size. CAP \u00f7 HELD-OUT MODEL compares the cap with a prediction from a fit that never saw the protocol.' }));
    }
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
    var onBoard = state.tab === 'pre-token';
    document.getElementById('controls').style.display = onBoard ? '' : 'none';
    document.getElementById('count').style.display = onBoard ? '' : 'none';
    document.getElementById('formula').style.display = onBoard ? '' : 'none';
    document.getElementById('accounting').style.display = onBoard ? '' : 'none';
    document.getElementById('integrity').style.display = onBoard ? '' : 'none';
    document.getElementById('evidence').style.display = onBoard ? '' : 'none';
    document.getElementById('stats').style.display = state.tab === 'detail' ? 'none' : '';
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
    renderIntegrity();
    renderEvidence();
    var stats = document.getElementById('stats');
    var cal = DATA.calibration;
    var rc = cal.range_check;
    var ts = cal.time_split;
    var odds = DATA.odds;
    function stat(big, label) {
      stats.appendChild(el('div', { class: 'stat' }, el('b', { text: big }), el('span', { text: label })));
    }
    stat('\u00d7' + fmtNum(ts.median_factor, 2), 'Out-of-sample miss');
    stat(Math.round(rc.p25_p75_pct) + '% \u00b7 ' + Math.round(rc.p10_p90_pct) + '%', 'Range holds');
    stat(fmtNum(odds.loo_brier, 3), 'Token odds, Brier');
    var valueKept = cal.ablation.filter(function (a) { return a.verdict === 'kept'; }).length;
    var valueTested = cal.ablation.length - 1;
    var oddsKept = odds.odds_ablation.filter(function (a) { return a.verdict === 'kept'; }).length;
    var oddsTested = odds.odds_ablation.length - 1;
    stat(valueKept + ' of ' + valueTested + ' \u00b7 ' + oddsKept + ' of ' + oddsTested, 'Terms survived');
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[verdictOf(netOf(r, 'plan', 0.07))]++; });
    stat(counts.FARM + ' of ' + DATA.board_size, 'Worth farming');
    stat(Math.round(odds.kinship.rate_with_kin * 100) + '% vs ' + Math.round(odds.kinship.rate_without_kin * 100) + '%', 'Kinship token rate');
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
    document.getElementById('deposit').addEventListener('change', function (e) { state.deposit = e.target.value === 'plan' ? 'plan' : parseInt(e.target.value, 10); render(); });
    document.getElementById('drop').addEventListener('change', function (e) { state.drop = parseFloat(e.target.value); render(); });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
    // Screenshot states: ?shot=detail&slug=... or ?shot=filtered&verdict=...&sort=...
    // ?tab=model|live|set-aside opens a tab directly (for screenshots).
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab');
    if (tab === 'model' || tab === 'live' || tab === 'set-aside') state.tab = tab;
    if (params.get('shot') === 'filtered') {
      if (params.get('category')) { state.category = params.get('category'); catSel.value = state.category; }
      if (params.get('verdict')) { state.verdict = params.get('verdict'); document.getElementById('verdict').value = state.verdict; }
      if (params.get('sort') === 'net') { state.sort = 'net'; state.dir = -1; }
      if (params.get('sort') === 'perhour') { state.sort = 'perhour'; state.dir = -1; }
    }
    render();
    if (params.get('shot') === 'detail' && params.get('slug')) openDetail(params.get('slug'));
    window.__radarReady = true;
  }

  init();
})();

