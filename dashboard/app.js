// Token Radar's dashboard (model radar-4): reads window.RADAR (written by main.ts)
// and renders the board, filters, detail drawer, live/set-aside views, and the model
// tab with a re-ranking sandbox. No network. Model: implied = exp(intercept + slope
// x ln(TVL)) x category factor x growth x launch odds — all fitted from the snapshot.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var drawer = document.getElementById('drawer');
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

  // The model in one function: the page recomputes a row from the snapshot figures and
  // the fitted models, so the page's code and the board's data are visibly the same
  // arithmetic. value = base x category factor x growth; implied = value x launch odds.
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

  // The verdicts are a farmer's arithmetic, not a score: the slice of the drop is the
  // ticket's share of the protocol's whole TVL — the conservative case, as if every
  // dollar of TVL farmed — times the drop share times the row's expected launch value,
  // minus the plan's gas. A farm is worth doing when that leaves more than $10.
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL, age and the 7-day move decide the action, the capital, the hold and every cost
  // and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function cheapChain(chain) {
    return /base|arbitrum|optimism|polygon|solana|bsc|avalanche|linea|scroll|blast|mode|zksync|mantle|sei|sui|aptos|near|fantom|gnosis/i.test(chain);
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + " and keep the shares through the next rebalance, so the curator's fee history counts your wallet.";
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', keep the position open, and borrow a small amount against it so both sides of the market count.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee distribution.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in its app so the volume is yours, not just the crossing.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ', keep the receipt token, and use it once in a paired pool if one exists.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small hedge, and close it after a day so the account shows real trading activity.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then hold it to settlement instead of flipping it.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it through one rebase or rewards epoch.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ', hold it, and complete any identity check its page asks for before the position counts.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full term.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + "'s flagship app on " + chain + ' with $' + capital + ' — one swap, one stake or one deployment — and keep the position open.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' across two or more separate transactions and keep the receipts.';
    if (c.indexOf('ai') >= 0 || c.indexOf('decentralized ai') >= 0) return 'Run one ' + name + ' job with $' + capital + ' of credits on ' + chain + ' and keep the output receipt as proof of use.';
    if (c.indexOf('nft') >= 0 || c.indexOf('gaming') >= 0 || c.indexOf('launchpad') >= 0) return 'Join ' + name + "'s next drop on " + chain + ' with $' + capital + ', hold the asset, and complete one in-app action the drop rewards.';
    if (c.indexOf('cede') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and keep the position open through one full rewards period.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open through one full rewards period.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return "Watch impermanent loss: if the pool's price moves sharply, the position can be worth less than holding, so check the pair's range weekly.";
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Watch the health factor if you borrow: a falling collateral price can liquidate the position, so keep the borrow under half of what the protocol allows.';
    if (c.indexOf('bridge') >= 0) return 'Bridges take time to finalise and a failed crossing can strand funds for hours: start with a small test amount before the full size.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Staked and restaked positions can take days or weeks to exit: never stake funds you may need before the unbonding window ends.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Leverage cuts both ways: keep the position small enough that a full loss of the margin does not hurt, and never add to a losing trade.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('cede') >= 0) return 'Real-world assets carry issuer and custody risk the chain cannot see: read who holds the underlying before sizing up.';
    if (c.indexOf('stable') >= 0) return 'A stable asset can depeg: check what backs it and how it has held its peg before holding a large amount.';
    return 'Smart contracts carry risk no audit removes: never farm with money you cannot afford to lose, and size the position to that.';
  }
  function secondActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return "After the deposit, vote or signal in the curator's next allocation round if one is open — curator protocols weight governance participation.";
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'After supplying, use the protocol\'s borrow side once, even for a small amount: supplying alone is half the activity the protocol sees.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'After providing liquidity, stake the LP receipt if the protocol offers a gauge or farm: unstaked liquidity often earns no points.';
    if (c.indexOf('bridge') >= 0) return 'After bridging, make one swap or deposit with the bridged funds on the destination chain: a bare crossing is the weakest signal.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "After staking, use the receipt token once — in a pool or as collateral — so the position shows up in more than one of the protocol's records.";
    if (c.indexOf('chain') >= 0) return 'After the first use, deploy or interact with a second app on the chain: single-app wallets look like tourists.';
    return 'After the first deposit, make one more distinct action the protocol offers — a swap, a vote, a second pool — so the wallet reads as a user, not a deposit.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var cheap = cheapChain(chain);
    var gas = cheap ? 'under $1' : capital >= 150 ? 'about $8' : 'about $4';
    var weeklyGas = cheap ? 'a few cents' : 'about $2';
    var growth = p.change_7d === null || p.change_7d === undefined ? 0 : p.change_7d;
    var momentum = growth >= 20
      ? ' TVL is up ' + growth.toFixed(0) + '% in 7 days — the window is hot, so start this week rather than next.'
      : growth <= -20
        ? ' TVL is down ' + Math.abs(growth).toFixed(0) + '% in 7 days — size small until the trend steadies.'
        : '';
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
    ];
    if (p.chains && p.chains.length > 1) {
      steps.push({ text: 'Repeat the core action on ' + p.chains[1] + ' too: ' + p.name + ' is live on ' + p.chains.length + ' chains, and activity on more than one counts separately.', cost: weeklyGas + ' of gas', time: '10 minutes' });
    }
    steps.push(
      { text: secondActionFor(p), cost: weeklyGas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.' + momentum, cost: weeklyGas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: riskFor(p), cost: 'no fee to check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    );
    return steps;
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

  // The board's own evidence, above the table: the fitted line against the live market
  // caps it was fitted on, the board's values on the same scale, and the ablation that
  // shows each stage earning its place out of sample.
  function renderMethod() {
    var wrap = document.getElementById('method');
    wrap.innerHTML = '';
    var cal = DATA.calibration;
    var reg = cal.regression;
    var box = el('div', { class: 'method-box' });
    var copy = el('div');
    copy.appendChild(el('h3', { text: 'How a launch is priced' }));
    copy.appendChild(el('p', { html: 'Expected value = <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth</code> (what the launch would be worth) <code>\u00d7 launch odds</code> (how often protocols like this one already record a token). Each stage is fitted from this snapshot, and each earns its place out of sample: flat multiple ' + fmtMult(cal.ablation[0].loo_median_factor) + ' \u2192 size curve ' + fmtMult(cal.ablation[1].loo_median_factor) + ' \u2192 + category ' + fmtMult(cal.ablation[2].loo_median_factor) + ' \u2192 + momentum ' + fmtMult(cal.ablation[3].loo_median_factor) + ' median miss, leave-one-out. Full validation on the Model tab.' }));
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
    parts.push('<g class="legend"><circle cx="' + (P + 10) + '" cy="' + (P + 4) + '" r="3" class="dot-live"/><text x="' + (P + 18) + '" y="' + (P + 8) + '">live market caps</text><circle cx="' + (P + 10) + '" cy="' + (P + 20) + '" r="3" class="dot-board"/><text x="' + (P + 18) + '" y="' + (P + 24) + '">board values</text><line x1="' + (P + 7) + '" y1="' + (P + 36) + '" x2="' + (P + 13) + '" y2="' + (P + 36) + '" class="fit-line"/><text x="' + (P + 18) + '" y="' + (P + 40) + '">fitted line</text></g>');
    parts.push('</svg>');
    box.appendChild(el('div', { class: 'scatter', html: parts.join('') }));
    wrap.appendChild(box);
  }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    var farmCount = viewRows().filter(function (r) { return verdictOf(netOf(r, state.ticket, state.drop).net) === 'FARM'; }).length;
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols \u00b7 ' + farmCount + ' worth farming at $' + state.ticket.toLocaleString('en-US') + ' and ' + Math.round(state.drop * 100) + '% of the launch' + (sandbox !== null ? ' \u00b7 sandbox ranking' : '');
    renderMethod();
    if (rows.length === 0) {
      app.innerHTML = '';
      app.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters.' }));
      return;
    }
    var mkt = DATA.market_growth_median;
    var table = el('table');
    var head = el('tr', null,
      el('th', { class: 'num', text: '#' }),
      sortHeader('Protocol', 'name'),
      el('th', { text: 'Category' }),
      sortHeader('TVL', 'tvl', 'num'),
      sortHeader('7d' + (mkt === null ? '' : ' (mkt ' + fmtPct(mkt) + ')'), 'growth', 'num'),
      sortHeader('Launch odds', 'odds', 'num'),
      sortHeader('Implied value', 'implied', 'num'),
      sortHeader('Net @ $' + state.ticket.toLocaleString('en-US'), 'net', 'num'),
      el('th', { text: 'Verdict' }));
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var n = netOf(r, state.ticket, state.drop);
      var verdict = verdictOf(n.net);
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug })),
        el('td', null, el('span', { class: 'tag' + (r.scope === 'watchlist' ? '' : ' early'), text: (r.category || 'Uncategorised') + ' \u00b7 ' + scopeLabel(r.scope) })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
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

  function renderLive() {
    document.getElementById('count').textContent = DATA.live_size + ' live-token protocols, by market cap';
    var table = el('table');
    table.appendChild(el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: 'Mcap / TVL' }), el('th', { class: 'num', text: '7d' }))));
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
      body.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug })),
        el('td', null, el('span', { class: 'tag', text: r.category || 'Uncategorised' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : fmtMult(ratio) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) })));
    });
    table.appendChild(body);
    app.innerHTML = '';
    var note = el('p', { class: 'empty', text: 'These protocols already trade, so the board shows the market\u2019s own value for them, never a model\u2019s estimate. Their market caps against their TVLs are what fit the regression that prices the pre-token board.' });
    app.appendChild(note);
    app.appendChild(table);
  }

  function renderSetAside() {
    document.getElementById('count').textContent = DATA.set_aside.length + ' protocols set aside, by TVL';
    var table = el('table');
    table.appendChild(el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { text: 'Why it is not ranked' }))));
    var body = el('tbody');
    DATA.set_aside.forEach(function (r) {
      body.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug })),
        el('td', null, el('span', { class: 'tag', text: r.category || 'Uncategorised' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason })));
    });
    table.appendChild(body);
    app.innerHTML = '';
    var note = el('p', { class: 'empty', text: 'The board ranks a protocol only when it records no token and stands alone. Everything else is listed here with its reason, so all 758 protocols are accounted for.' });
    app.appendChild(note);
    app.appendChild(table);
  }

  function renderModel() {
    document.getElementById('count').textContent = 'Model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of;
    var cal = DATA.calibration;
    var reg = cal.regression;
    var odds = DATA.odds;
    var grid = el('div', { class: 'model-grid' });
    var method = el('div', { class: 'card' });
    method.appendChild(el('h3', { text: 'How the implied value is built' }));
    method.appendChild(el('p', { html: 'Every row\u2019s implied value is an expected value: <code>value if it launches \u00d7 launch odds</code>. The value is <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth</code>. The intercept and slope come from an ordinary least-squares regression of log market cap on log TVL across this snapshot\u2019s own live-token protocols — the market does not price TVL linearly, so a protocol ten times larger is worth roughly four to five times as much, not ten. A flat multiple would overvalue the biggest protocols several times over.' }));
    method.appendChild(el('p', { html: 'The category factor is the category\u2019s median residual from that line, shrunk toward 1 by n/(n+3). A category needs at least 5 live peers to carry its own effect; below that, the model pools its super-category\u2019s peers instead — vaults and curators, money markets, trading, bridges, staking, real world — and a category with no poolable peers gets no adjustment. Growth enters with its own fitted coefficient (' + fmtNum(reg.growth_coef, 2) + '), bounded to \u00b115%.' }));
    method.appendChild(el('p', { html: 'The launch odds come from a logistic model fitted on the snapshot\u2019s own live/pre-token split: log TVL, log age, log chain count, and the category\u2019s shrunk token rate. Growth is deliberately not an input: fast growth marks the pre-token phase itself, so it would punish exactly the momentum farmers want. Odds are bounded to 10%\u201390%.' }));
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
      'Logistic regression on ' + odds.train_count + ' protocols of the candidate shape (token or not). Features: log TVL, log age, log chain count, and the category\u2019s token rate shrunk toward the base rate. Held out by leave-one-out it calls ' + odds.loo_correct + ' of ' + odds.train_count + ' right (' + Math.round(odds.loo_accuracy * 100) + '%) against a ' + Math.round(odds.base_rate * 100) + '% base rate, Brier ' + fmtNum(odds.loo_brier, 3) + '. The calibration table shows the odds mean what they say: protocols scored near 20% launch about 20% of the time.');
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
        [{ text: 'Chain count as a value regressor' }, { text: 'Coefficient \u22120.13, t = \u22120.74: not significant, and the paired held-out error is no better.' }],
        [{ text: 'A fitted age effect on value' }, { text: 'Coefficient t = +0.28: no signal. Age enters the launch odds instead, where it is fitted.' }],
        [{ text: 'Per-category slopes' }, { text: 'Held-out median miss worse than one shared slope: too few protocols per category to fit a slope.' }],
        [{ text: 'A piecewise size curve' }, { text: 'Held-out median miss much worse: the single power law is the better shape.' }],
        [{ text: 'Growth in the launch odds' }, { text: 'Looks better out of sample, but the coefficient is a young-protocol artifact: it would punish the momentum farmers want.' }],
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

  function openDetail(slug) {
    var row = null;
    viewRows().forEach(function (r) { if (r.slug === slug) row = r; });
    if (row === null) return;
    state.selected = slug;
    var reg = sandbox !== null ? Object.assign({}, DATA.calibration.regression, { slope: sandbox.slope }) : DATA.calibration.regression;
    var model = sandbox !== null ? Object.assign({}, DATA.model, sandbox) : DATA.model;
    var v = impliedOf(row, model, reg, row.category_factor, sandbox !== null ? sandbox.odds_weight : 1);
    var n = netOf(row, state.ticket, state.drop);
    var verdict = verdictOf(n.net);
    drawer.innerHTML = '';
    drawer.appendChild(el('button', { class: 'close', text: '\u2715 Close', onclick: closeDetail }));
    drawer.appendChild(el('h2', { text: row.name }));
    drawer.appendChild(el('p', { class: 'sub', text: row.slug + ' \u00b7 ' + (row.category || 'Uncategorised') + ' \u00b7 rank #' + row.rank + ' (' + scopeLabel(row.scope) + ')' }));
    var kv = el('div', { class: 'kv' });
    kv.appendChild(el('div', null, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'Expected launch value' })));
    kv.appendChild(el('div', null, el('b', { text: fmtUsd(row.value_if_launches_usd) }), el('span', { text: 'Value if it launches' })));
    kv.appendChild(el('div', null, el('b', { text: Math.round(row.launch_odds * 100) + '%' }), el('span', { text: 'Launch odds' })));
    kv.appendChild(el('div', null, el('b', { text: fmtUsd(row.range_low_usd) + ' \u2013 ' + fmtUsd(row.range_high_usd) }), el('span', { text: 'P25\u2013P75 range' })));
    kv.appendChild(el('div', null, el('b', { text: fmtUsd(row.tvl_usd) }), el('span', { text: 'TVL' })));
    kv.appendChild(el('div', null, el('b', { text: fmtPct(row.change_7d) }), el('span', { text: 'TVL change, 7d' })));
    kv.appendChild(el('div', null, el('b', { text: fmtAge(row.age_days) }), el('span', { text: 'Running with no token' })));
    var chains = row.chains || [];
    var chainText = chains.length <= 3 ? chains.join(', ') : chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
    kv.appendChild(el('div', null, el('b', { text: chainText || 'n/a' }), el('span', { text: 'Chains' })));
    kv.appendChild(el('div', null, el('b', { text: fmtMult(row.category_factor) }), el('span', { text: factorLabel(row) })));
    drawer.appendChild(kv);
    drawer.appendChild(el('h3', { text: 'How the number is built' }));
    var math = el('div', { class: 'math' });
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Size line: exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln TVL)' }), el('span', { text: fmtUsd(v.base) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Category factor (' + (row.category || 'uncategorised') + ')' }), el('span', { text: '\u00d7 ' + fmtMult(row.category_factor) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Growth (' + (v.growthPct > 0 ? '+' : '') + v.growthPct.toFixed(2) + '% 7d)' }), el('span', { text: '\u00d7 ' + v.growthMult.toFixed(2) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Value if it launches' }), el('span', { text: fmtUsd(v.value) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Launch odds (category token rate ' + Math.round(row.category_token_rate * 100) + '%)' }), el('span', { text: '\u00d7 ' + v.odds.toFixed(2) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Expected launch value' }), el('span', { text: fmtUsd(v.implied) })));
    math.appendChild(el('div', { class: 'src', text: factorNote(row) }));
    drawer.appendChild(math);
    if (row.comparables && row.comparables.length > 0) {
      drawer.appendChild(el('h3', { text: 'Nearest live comparables' }));
      var comp = el('div', { class: 'math' });
      row.comparables.forEach(function (c) {
        comp.appendChild(el('div', { class: 'line' }, el('span', { text: c.name }), el('span', { text: fmtMult(c.multiple) + ' mcap/TVL' })));
      });
      comp.appendChild(el('div', { class: 'src', text: 'The three live-token protocols nearest this size in its super-category. Their multiples are what the size line is fitted on.' }));
      drawer.appendChild(comp);
    }
    drawer.appendChild(el('h3', { text: 'Worth farming? ' }));
    drawer.lastChild.appendChild(el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict }));
    var farm = el('div', { class: 'math' });
    farm.appendChild(el('div', { class: 'line' }, el('span', { text: 'Your slice of the drop ($' + state.ticket.toLocaleString('en-US') + ' of $' + fmtUsd(row.tvl_usd).slice(1) + ' TVL)' }), el('span', { text: (n.slice * 100).toFixed(4) + '%' })));
    farm.appendChild(el('div', { class: 'line' }, el('span', { text: 'Share of the launch (' + Math.round(state.drop * 100) + '% drop)' }), el('span', { text: fmtUsd2(n.gross) })));
    farm.appendChild(el('div', { class: 'line' }, el('span', { text: 'Gas for the whole plan' }), el('span', { text: '\u2212 ' + fmtUsd2(row.gas_total_usd) })));
    farm.appendChild(el('div', { class: 'line' }, el('span', { text: 'Net, after gas' }), el('span', { text: fmtUsd2(n.net) })));
    farm.appendChild(el('div', { class: 'line' }, el('span', { text: 'Per hour (' + row.labor_hours.toFixed(1) + 'h of work)' }), el('span', { text: fmtUsd2(n.perHour) + '/h' })));
    farm.appendChild(el('div', { class: 'src', text: 'The slice is the conservative case, as if every dollar of TVL farmed. The drop share is the one assumption — change the ticket and the drop share in the filters and every verdict re-computes. FARM means more than $' + DATA.model.farm_threshold_usd + ' after gas.' }));
    drawer.appendChild(farm);
    drawer.appendChild(el('h3', { text: 'Farm plan' }));
    var ol = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) {
      ol.appendChild(el('li', null, document.createTextNode(s.text), el('span', { class: 'meta', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' })));
    });
    drawer.appendChild(ol);
    drawer.hidden = false;
    render();
  }

  function closeDetail() {
    state.selected = null;
    drawer.hidden = true;
    drawer.innerHTML = '';
    render();
  }

  function syncTabs() {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab);
    });
    document.getElementById('controls').style.display = state.tab === 'pre-token' ? '' : 'none';
    document.getElementById('method').style.display = state.tab === 'pre-token' ? '' : 'none';
  }

  function render() {
    syncTabs();
    app.setAttribute('aria-busy', 'false');
    if (state.tab === 'live') renderLive();
    else if (state.tab === 'set-aside') renderSetAside();
    else if (state.tab === 'model') renderModel();
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
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(farmCount) }), el('span', { text: 'Worth farming ($1,000, 7%)' })));
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
    // Screenshot states: ?shot=detail&slug=... opens one protocol; ?shot=filtered&category=...
    // applies a filter. The page is otherwise identical.
    var params = new URLSearchParams(window.location.search);
    if (params.get('shot') === 'filtered' && params.get('category')) {
      state.category = params.get('category');
      catSel.value = state.category;
    }
    render();
    if (params.get('shot') === 'detail' && params.get('slug')) openDetail(params.get('slug'));
    window.__radarReady = true;
  }

  init();
})();
