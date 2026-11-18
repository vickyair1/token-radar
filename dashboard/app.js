// Token Radar's dashboard (model radar-3). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the regression's own inputs and the protocol's
// farm plan, the live-token view, and the model's calibration with a sandbox that
// re-ranks the board under changed constants. No network: every byte it shows is
// in data.js.
//
// The model in one line: implied = exp(intercept + slope x ln(TVL)) x category
// factor x growth x maturity. The intercept and slope are fitted from this
// snapshot's own live-token protocols (a log-log regression of market cap on TVL);
// the category factor is the category's shrunk median residual, or its
// super-category's pool when the category has too few live peers of its own.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var drawer = document.getElementById('drawer');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = null; // { slope, growth_weight, maturity_floor } or null when the shipped model runs

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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

  // The model in one function: the page recomputes a row from the snapshot figures and the
  // fitted regression, so the page's code and the board's data are visibly the same arithmetic.
  // base = exp(intercept + slope x ln(TVL)); implied = base x category factor x growth x maturity.
  function impliedOf(row, model, reg, factor) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = Math.min(model.growth_effect_max, Math.max(model.growth_effect_min, Math.exp(reg.growth_coef * model.growth_weight * (growth / 100))));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var base = Math.exp(reg.intercept + reg.slope * Math.log(row.tvl_usd));
    var implied = Math.max(1, Math.min(model.implied_cap_usd, Math.round(base * factor * growthMult * maturity)));
    return { implied: implied, base: Math.round(base), growthMult: growthMult, maturityMult: maturity, growthPct: growth, age: age };
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is special-cased.
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
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + " and keep the shares through the next rebalance, so the curator's fee history counts your wallet.";
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', keep the position open, and borrow a small amount against it so both sides of the market count.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee distribution.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app so the volume is yours, not just the crossing.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ', keep the receipt token, and use it once in a paired pool if one exists.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small hedge, and close it after a day so the account shows real trading activity.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then hold it to settlement instead of flipping it.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it through one rebase or rewards epoch.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ', hold it, and complete any identity check its page asks for before the position counts.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full term.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + "'s flagship app on " + chain + ' with $' + capital + ' — one swap, one stake or one deployment — and keep the position open.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' across two or more separate transactions and keep the receipts.';
    if (c.indexOf('ai') >= 0) return 'Run one ' + name + ' job with $' + capital + ' of credits on ' + chain + ' and keep the output receipt as proof of use.';
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
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'After supplying, use the protocol’s borrow side once, even for a small amount: supplying alone is half the activity the protocol sees.';
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
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p), cost: weeklyGas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: weeklyGas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: riskFor(p), cost: 'no fee to check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    ];
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
        var v = impliedOf(r, model, reg, r.category_factor);
        return Object.assign({}, r, { implied_value_usd: v.implied, base_value_usd: v.base, growth_multiplier: v.growthMult, maturity_multiplier: v.maturityMult });
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
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
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
      if (key === 'multiple') return r.implied_value_usd / r.tvl_usd;
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
    var th = el('th', { class: 'sortable' + (cls ? ' ' + cls : ''), text: label + arrow, onclick: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } });
    return th;
  }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols' + (sandbox !== null ? ' \u00b7 sandbox ranking' : '');
    if (rows.length === 0) {
      app.innerHTML = '';
      app.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters.' }));
      return;
    }
    var table = el('table');
    var head = el('tr', null,
      el('th', { class: 'num', text: '#' }),
      sortHeader('Protocol', 'name'),
      el('th', { text: 'Category' }),
      sortHeader('TVL', 'tvl', 'num'),
      sortHeader('7d', 'growth', 'num'),
      sortHeader('Age', 'age', 'num hide-m'),
      sortHeader('Eff. multiple', 'multiple', 'num hide-m'),
      sortHeader('Implied value', 'implied', 'num'));
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug })),
        el('td', null, el('span', { class: 'tag' + (r.on_watchlist ? '' : ' early'), text: (r.category || 'Uncategorised') + (r.on_watchlist ? '' : ' \u00b7 early') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num hide-m', text: fmtAge(r.age_days) }),
        el('td', { class: 'num hide-m', text: fmtMult(r.implied_value_usd / r.tvl_usd) }),
        el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) }));
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

  function renderModel() {
    document.getElementById('count').textContent = 'Model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of;
    var cal = DATA.calibration;
    var reg = cal.regression;
    var grid = el('div', { class: 'model-grid' });
    var method = el('div', { class: 'card' });
    method.appendChild(el('h3', { text: 'How the implied value is built' }));
    method.appendChild(el('p', { html: 'Every row\u2019s implied value is <code>exp(' + fmtNum(reg.intercept, 2) + ' + ' + fmtNum(reg.slope, 2) + ' \u00d7 ln(TVL)) \u00d7 category factor \u00d7 growth \u00d7 maturity</code>. The intercept and slope come from an ordinary least-squares regression of log market cap on log TVL across this snapshot\u2019s own live-token protocols — the market does not price TVL linearly, so a protocol ten times larger is worth roughly four to five times as much, not ten. A flat multiple would overvalue the biggest protocols several times over.' }));
    method.appendChild(el('p', { html: 'The category factor is the category\u2019s median residual from that line, shrunk toward 1 by n/(n+3). A category with fewer than 3 live peers borrows its super-category\u2019s pooled factor instead — vaults and curators, money markets, trading, bridges, staking, real world — and a category with no poolable peers gets no adjustment. Growth enters with its own fitted coefficient (' + fmtNum(reg.growth_coef, 2) + '), bounded to \u00b115%. Maturity (0.6\u20131.0 over three years running with no token) is a stated prior about launch readiness, not a fitted effect: the live set shows almost no age pattern, and the model says so.' }));
    method.appendChild(el('p', { html: 'Fit: <b>' + reg.trimmed_count + ' live protocols</b> (mcap/TVL trimmed to 0.005\u00d7\u20135\u00d7; CEX excluded), R\u00b2 <b>' + fmtNum(reg.r_squared, 2) + '</b>, residual RMSE <b>' + fmtNum(reg.rmse_log, 2) + '</b> log points. Leave-one-out check: each live protocol predicted from a fit that never saw it lands within <b>' + fmtNum(reg.loo_median_factor, 1) + '\u00d7</b> of its actual market cap at the median — that is the honest precision of a launch estimate from TVL alone, and the board\u2019s values should be read with it in mind.' }));
    grid.appendChild(method);
    var box = el('div', { class: 'card sandbox' });
    box.appendChild(el('h3', { text: 'Model sandbox' }));
    box.appendChild(el('p', { text: 'Change the constants and the board re-ranks live, under your numbers. Nothing here changes the submitted board.' }));
    var slope = reg.slope, gw = DATA.model.growth_weight, mf = DATA.model.maturity_floor;
    if (sandbox !== null) { slope = sandbox.slope; gw = sandbox.growth_weight; mf = sandbox.maturity_floor; }
    function slider(label, min, max, step, value, oninput) {
      var out = el('output', { text: value.toFixed(2) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), oninput: function () { out.textContent = parseFloat(input.value).toFixed(2); oninput(parseFloat(input.value)); } });
      var wrap = el('label', null, document.createTextNode(label + ' '), out, input);
      return wrap;
    }
    box.appendChild(slider('TVL slope (fitted ' + fmtNum(reg.slope, 2) + ')', 0.3, 1, 0.01, slope, function (v) { setSandbox({ slope: v }); }));
    box.appendChild(slider('Growth weight', 0, 1, 0.05, gw, function (v) { setSandbox({ growth_weight: v }); }));
    box.appendChild(slider('Maturity floor', 0.4, 0.9, 0.05, mf, function (v) { setSandbox({ maturity_floor: v }); }));
    box.appendChild(el('button', { text: 'Reset to the shipped model', onclick: function () { sandbox = null; render(); } }));
    grid.appendChild(box);
    var table = el('table');
    table.appendChild(el('thead', null, el('tr', null,
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live peers' }),
      el('th', { class: 'num', text: 'Raw factor' }), el('th', { class: 'num', text: 'Factor used' }),
      el('th', { text: 'Source' }))));
    var body = el('tbody');
    cal.rows.forEach(function (r) {
      var src = r.source === 'category' ? 'Own peers' : r.source === 'group' ? r.group + ' pool (' + r.group_peers + ' peers)' : 'No adjustment';
      body.appendChild(el('tr', { onclick: function () {} },
        el('td', { text: r.category }),
        el('td', { class: 'num', text: String(r.peers) }),
        el('td', { class: 'num', text: r.raw_factor === null ? 'n/a' : fmtMult(r.raw_factor) }),
        el('td', { class: 'num implied', text: fmtMult(r.factor) }),
        el('td', { text: src })));
    });
    table.appendChild(body);
    app.innerHTML = '';
    app.appendChild(grid);
    app.appendChild(table);
  }

  function setSandbox(patch) {
    if (sandbox === null) sandbox = { slope: DATA.calibration.regression.slope, growth_weight: DATA.model.growth_weight, maturity_floor: DATA.model.maturity_floor };
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
    var v = impliedOf(row, model, reg, row.category_factor);
    drawer.innerHTML = '';
    drawer.appendChild(el('button', { class: 'close', text: '\u2715 Close', onclick: closeDetail }));
    drawer.appendChild(el('h2', { text: row.name }));
    drawer.appendChild(el('p', { class: 'sub', text: row.slug + ' \u00b7 ' + (row.category || 'Uncategorised') + ' \u00b7 rank #' + row.rank + (row.on_watchlist ? ' (watchlist)' : ' (early radar)') }));
    var kv = el('div', { class: 'kv' });
    kv.appendChild(el('div', null, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'Implied value' })));
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
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Maturity (' + fmtAge(v.age) + ')' }), el('span', { text: '\u00d7 ' + v.maturityMult.toFixed(2) })));
    math.appendChild(el('div', { class: 'line' }, el('span', { text: 'Implied value' }), el('span', { text: fmtUsd(v.implied) })));
    math.appendChild(el('div', { class: 'src', text: factorNote(row) }));
    drawer.appendChild(math);
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
  }

  function render() {
    syncTabs();
    app.setAttribute('aria-busy', 'false');
    if (state.tab === 'live') renderLive();
    else if (state.tab === 'model') renderModel();
    else renderBoard();
  }

  function init() {
    document.getElementById('asof').textContent = DATA.as_of;
    var stats = document.getElementById('stats');
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Protocols ranked' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'Watchlist' })));
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) }), el('span', { text: 'Top implied value' })));
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
