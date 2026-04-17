// js/app.js
// -- State ----------------------------------------------------------------
let funds = [];
let aggregated = [];
let fetchMeta  = [];
let sortCol = 'portfolioPct';
let sortDir = -1;
let currentPortfolioType = '';
let allocMode = 'pct';
let totalPortfolioValue = 0;
let currentPortfolioName = '';

const ACCENTURE_FUNDS = [
  { ticker: 'VEMRX', name: 'Vanguard Emerging Markets Stock Index Fund Admiral Shares' },
  { ticker: 'VIGIX', name: 'Vanguard Growth Index Fund Institutional Shares' },
  { ticker: 'VMCPX', name: 'Vanguard Mid-Cap Index Fund Institutional Plus Shares' },
  { ticker: 'VGSNX', name: 'Vanguard Real Estate Index Fund Admiral Shares' },
  { ticker: 'VSCPX', name: 'Vanguard Small-Cap Index Fund Institutional Plus Shares' },
  { ticker: 'VIVIX', name: 'Vanguard Value Index Fund Institutional Shares' },
];

// -- Tooltip tap support (mobile) -----------------------------------------
document.addEventListener('click', e => {
  const wrap = e.target.closest('.tooltip-wrap');
  document.querySelectorAll('.tooltip-wrap.active').forEach(el => {
    if (el !== wrap) el.classList.remove('active');
  });
  if (wrap) wrap.classList.toggle('active');
});

// -- Alloc mode selector --------------------------------------------------
const allocModeSelect = document.getElementById('allocMode');

allocModeSelect.addEventListener('change', function () {
  allocMode = this.value;
  updateAllocModeUI();
  if (currentPortfolioType === 'accenture401k') buildAccentureFundRows();
  else renderFundsTable();
});

function updateAllocModeUI() {
  const header        = document.getElementById('allocColHeader');
  const hint          = document.getElementById('allocModeHint');
  const newAllocInput = document.getElementById('newAlloc');
  const summaryRow    = document.querySelector('.alloc-progress-row');

  if (allocMode === 'pct') {
    header.textContent          = 'Allocation %';
    newAllocInput.placeholder   = '%';
    hint.textContent            = '';
    summaryRow.style.display    = '';
  } else if (allocMode === 'dollar') {
    header.textContent          = 'Dollar Amount ($)';
    newAllocInput.placeholder   = '$';
    hint.textContent            = 'Enter dollar value — live prices used for stocks';
    summaryRow.style.display    = 'none';
  } else {
    header.textContent          = 'Shares';
    newAllocInput.placeholder   = '# shares';
    hint.textContent            = 'Enter number of shares — live prices fetched to calculate weights';
    summaryRow.style.display    = 'none';
  }
  document.getElementById('allocWarning').classList.add('hidden');
}

// -- Portfolio type selection ---------------------------------------------
const portfolioTypeSelect = document.getElementById('portfolioType');
const portfolioContent    = document.getElementById('portfolioContent');
const blankState          = document.getElementById('blankState');
const fundAllocSection    = document.getElementById('fundAllocSection');
const fundAddRow          = document.getElementById('fundAddRow');

portfolioTypeSelect.addEventListener('change', function () {
  currentPortfolioType = this.value;
  blankState.classList.add('hidden');
  portfolioContent.classList.remove('hidden');
  fundAllocSection.classList.remove('hidden');

  funds = [];
  aggregated = [];
  currentPortfolioName = '';
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('portfolioName').value = '';
  document.getElementById('saveBtn').disabled = true;

  const accentureNote      = document.getElementById('accentureNote');
  const customInstructions = document.getElementById('customInstructions');

  if (currentPortfolioType === 'accenture401k') {
    fundAddRow.classList.add('hidden');
    accentureNameRow.classList.remove('hidden');
    accentureNote.classList.remove('hidden');
    customInstructions.classList.add('hidden');
    buildAccentureFundRows();  } else {
    fundAddRow.classList.remove('hidden');
    accentureNameRow.classList.add('hidden');
    accentureNote.classList.add('hidden');
    customInstructions.classList.remove('hidden');
    renderFundsTable();
  }

  updateAllocModeUI();

  const email = getEmail();
  if (email) lookupPortfolios(email);
  else document.getElementById('savedPortfoliosWrap').classList.add('hidden');
});

// -- Accenture 401K fund rows ---------------------------------------------
function buildAccentureFundRows() {
  const tbody      = document.getElementById('fundsBody');
  const allocLabel = allocMode === 'dollar' ? '$' : allocMode === 'shares' ? '# shares' : '%';

  tbody.innerHTML = ACCENTURE_FUNDS.map(fund => `
    <tr data-ticker="${fund.ticker}">
      <td><strong>${fund.ticker}</strong></td>
      <td>${fund.name}</td>
      <td>
        <input type="number" class="alloc-edit accenture-alloc" data-ticker="${fund.ticker}"
          placeholder="${allocLabel}" min="0" step="0.01" style="width:90px">
        <span class="alloc-pct-symbol">${allocLabel}</span>
      </td>
      <td><em style="color:#aaa;font-size:0.8rem">locked</em></td>
    </tr>
  `).join('');

  const note = document.createElement('tr');
  note.innerHTML = `<td colspan="4" style="font-style:italic;color:#aaa;font-size:0.85rem;padding:0.75rem 0.5rem">
    Accenture funds not listed above do not publish their holdings publicly.
  </td>`;
  tbody.appendChild(note);

  tbody.querySelectorAll('.accenture-alloc').forEach(input => {
    input.addEventListener('input', syncAccentureToFunds);
  });
}

function syncAccentureToFunds() {
  funds = [];
  document.querySelectorAll('.accenture-alloc').forEach(input => {
    const val = parseFloat(input.value);
    if (val > 0) funds.push({ ticker: input.dataset.ticker, type: 'mutual', alloc: val });
  });
  if (allocMode === 'pct') updateAllocSummary();
  else document.getElementById('analyzeBtn').disabled = funds.length === 0;
}

// -- Fund table (custom) --------------------------------------------------
function renderFundsTable() {
  document.getElementById('saveBtn').disabled = true;
  const tbody      = document.getElementById('fundsBody');
  const allocLabel = allocMode === 'dollar' ? '$' : allocMode === 'shares' ? 'shares' : '%';

  if (funds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#aaa;font-style:italic;padding:0.75rem">No funds added yet.</td></tr>';
  } else {
    tbody.innerHTML = funds.map((f, i) => `
      <tr>
        <td class="ticker-cell">${escapeHtml(f.ticker)}</td>
        <td>${f.type === 'mutual' ? 'Mutual Fund' : f.type === 'stock' ? 'Stock' : 'ETF / Index'}</td>
        <td>
          <input class="alloc-edit" type="number" value="${f.alloc}" min="0.01" step="0.01"
            onchange="updateAlloc(${i}, this.value)" title="Edit allocation">
          <span class="alloc-pct-symbol">${allocLabel}</span>
        </td>
        <td><button class="del-btn" onclick="removeFund(${i})" title="Remove">&times;</button></td>
      </tr>
    `).join('');
  }
  updateAllocSummary();
}

function updateAllocSummary() {
  if (allocMode !== 'pct') {
    document.getElementById('analyzeBtn').disabled = funds.length === 0;
    return;
  }

  const total     = funds.reduce((sum, f) => sum + parseFloat(f.alloc || 0), 0);
  const rounded   = Math.round(total * 100) / 100;
  const capped    = Math.min(rounded, 100);
  const remaining = Math.round((100 - rounded) * 100) / 100;

  document.getElementById('totalAlloc').textContent = rounded + '%';

  const bar = document.getElementById('allocBar');
  bar.style.width = capped + '%';
  bar.className   = 'alloc-bar' +
    (rounded > 100.01 ? ' over' : rounded >= 99.99 ? ' complete' : '');

  const remEl = document.getElementById('allocRemaining');
  if (rounded >= 99.99 && rounded <= 100.01) {
    remEl.textContent = 'Ready to analyze';
    remEl.className   = 'alloc-remaining ready';
  } else if (rounded > 100.01) {
    remEl.textContent = (rounded - 100).toFixed(2) + '% over';
    remEl.className   = 'alloc-remaining over';
  } else {
    remEl.textContent = remaining + '% remaining';
    remEl.className   = 'alloc-remaining';
  }

  const warn = document.getElementById('allocWarning');
  const btn  = document.getElementById('analyzeBtn');
  if (Math.abs(rounded - 100) > 0.01) {
    warn.classList.remove('hidden');
    btn.disabled = true;
  } else {
    warn.classList.add('hidden');
    btn.disabled = funds.length === 0;
  }
}

document.getElementById('addFundBtn').addEventListener('click', () => {
  const ticker = document.getElementById('newTicker').value.trim().toUpperCase();
  const type   = document.getElementById('newType').value;
  const alloc  = parseFloat(document.getElementById('newAlloc').value);

  if (!ticker)                    { showToast('Enter a ticker symbol.'); return; }
  if (isNaN(alloc) || alloc <= 0) { showToast('Enter a valid allocation.'); return; }
  if (type !== 'stock' && funds.some(f => f.ticker === ticker)) {
    showToast(`${ticker} already added.`); return;
  }

  funds.push({ ticker, type, alloc });
  document.getElementById('newTicker').value = '';
  document.getElementById('newAlloc').value  = '';
  renderFundsTable();
});

window.removeFund = function(i) {
  funds.splice(i, 1);
  renderFundsTable();
};

window.updateAlloc = function(i, val) {
  const parsed = parseFloat(val);
  if (isNaN(parsed) || parsed <= 0) { showToast('Enter a valid allocation.'); renderFundsTable(); return; }
  funds[i].alloc = parsed;
  updateAllocSummary();
};

document.getElementById('clearFundsBtn').addEventListener('click', () => {
  if (funds.length === 0) return;
  if (confirm('Clear all funds?')) {
    funds = [];
    if (currentPortfolioType === 'accenture401k') buildAccentureFundRows();
    else renderFundsTable();
    document.getElementById('resultsSection').classList.add('hidden');
  }
});

// -- Analysis -------------------------------------------------------------
document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  setLoading(true, 'Preparing analysis...');
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('fetchErrors').classList.add('hidden');

  const errors   = [];
  fetchMeta      = [];
  const stockMap = {};
  totalPortfolioValue = 0;

  let resolvedFunds = [...funds];

  if (allocMode === 'dollar') {
    totalPortfolioValue = resolvedFunds.reduce((s, f) => s + f.alloc, 0);
  } else if (allocMode === 'shares') {
    setLoading(true, 'Fetching live prices...');
    for (const f of resolvedFunds) {
      try {
        const price = await fetchPrice(f.ticker);
        f.dollarValue = f.alloc * price;
      } catch (e) {
        errors.push(`${f.ticker}: Could not fetch price — ${e.message}`);
        f.dollarValue = 0;
      }
    }
    totalPortfolioValue = resolvedFunds.reduce((s, f) => s + (f.dollarValue || 0), 0);
  }

  if (allocMode !== 'pct') {
    resolvedFunds = resolvedFunds.map(f => {
      const dollarVal = allocMode === 'dollar' ? f.alloc : (f.dollarValue || 0);
      return { ...f, pctWeight: totalPortfolioValue > 0 ? (dollarVal / totalPortfolioValue) * 100 : 0 };
    });
  } else {
    resolvedFunds = resolvedFunds.map(f => ({ ...f, pctWeight: f.alloc }));
  }

  for (const fund of resolvedFunds) {
    if (fund.type === 'stock') {
      const sym = fund.ticker.toUpperCase();
      if (!stockMap[sym]) stockMap[sym] = { asset: sym, name: sym, portfolioPct: 0, portfolioDollar: 0, funds: [] };
      stockMap[sym].portfolioPct    += fund.pctWeight;
      stockMap[sym].portfolioDollar += allocMode === 'dollar' ? fund.alloc : (fund.dollarValue || 0);
      stockMap[sym].funds.push(fund.ticker + ' (direct)');
      fetchMeta.push({ ticker: fund.ticker, source: 'direct holding', count: 1, warning: null });
      continue;
    }

    setLoading(true, `Fetching ${fund.ticker}...`);
    try {
      const result   = await fetchHoldings(fund.ticker, fund.type);
      const holdings = result.holdings;

      fetchMeta.push({
        ticker:  fund.ticker,
        source:  result.source  || 'unknown',
        count:   result.count   || 0,
        warning: result.warning || null
      });

      if (!Array.isArray(holdings) || holdings.length === 0) {
        errors.push(`${fund.ticker}: No holdings data returned.`);
        continue;
      }

      for (const h of holdings) {
        const sym          = (h.asset || '').toUpperCase();
        const name         = h.name || '';
        const contribution = (parseFloat(h.weightPercentage) || 0) / 100 * fund.pctWeight;
        const dollarContrib = allocMode !== 'pct'
          ? (parseFloat(h.weightPercentage) || 0) / 100 * (allocMode === 'dollar' ? fund.alloc : (fund.dollarValue || 0))
          : 0;

        if (!sym || contribution <= 0) continue;
        if (!stockMap[sym]) stockMap[sym] = { asset: sym, name, portfolioPct: 0, portfolioDollar: 0, funds: [] };
        stockMap[sym].portfolioPct    += contribution;
        stockMap[sym].portfolioDollar += dollarContrib;
        stockMap[sym].funds.push(fund.ticker);
      }
    } catch (err) {
      errors.push(`${fund.ticker}: ${err.message}`);
      fetchMeta.push({ ticker: fund.ticker, source: 'error', count: 0, warning: err.message });
    }
  }

  aggregated = Object.values(stockMap);
  setLoading(false);
  renderResults(errors);
  document.getElementById('saveBtn').disabled = aggregated.length === 0;
}

// -- Results --------------------------------------------------------------
function renderResults(errors = []) {
  document.getElementById('resultsSection').classList.remove('hidden');
  document.getElementById('holdingsCount').textContent = aggregated.length;
  document.getElementById('dollarColHeader').classList.toggle('hidden', allocMode === 'pct');
  renderDataSources();

  if (aggregated.length === 0) {
    document.getElementById('resultsBody').innerHTML =
      '<tr><td colspan="6" style="color:#aaa;text-align:center;padding:1.5rem">No holdings data found.</td></tr>';
    if (errors.length) showErrors(errors);
    return;
  }

  applySort();
  renderResultsTable();
  if (errors.length > 0) showErrors(errors);
}

function renderDataSources() {
  const el = document.getElementById('dataSourcesInfo');
  if (!el) return;
  if (!fetchMeta.length) { el.classList.add('hidden'); return; }

  const rows = fetchMeta.map(m => {
    const warnHtml   = m.warning ? `<div class="ds-warning">${escapeHtml(m.warning)}</div>` : '';
    const countClass = m.count >= 20 ? 'ds-count-good' : m.count > 0 ? 'ds-count-warn' : 'ds-count-err';
    return `<div class="ds-row">
      <span class="ds-ticker">${escapeHtml(m.ticker)}</span>
      <span class="ds-source">${escapeHtml(m.source)}</span>
      <span class="${countClass}">${m.count} rows</span>
      ${warnHtml}
    </div>`;
  }).join('');

  el.innerHTML = '<strong>Data Sources</strong>' + rows;
  el.classList.remove('hidden');
}

function renderResultsTable() {
  const search = document.getElementById('searchBox').value.toLowerCase();
  const top20  = document.getElementById('top20Only').checked;

  let rows = [...aggregated];
  rows.sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    if (typeof av === 'number') return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv)) * sortDir;
  });

  if (search) rows = rows.filter(r =>
    r.asset.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
  );
  if (top20) rows = rows.slice(0, 20);

  const maxPct = rows.length ? rows[0].portfolioPct : 1;
  const tbody  = document.getElementById('resultsBody');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#aaa;text-align:center;padding:1rem">No results.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const barWidth  = Math.max(2, Math.round((r.portfolioPct / maxPct) * 100));
    const pctStr    = r.portfolioPct.toFixed(3) + '%';
    const dollarStr = allocMode !== 'pct'
      ? '$' + r.portfolioDollar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
    const tags      = [...new Set(r.funds)].map(f => `<span class="fund-tag">${escapeHtml(f)}</span>`).join('');
    const dollarCell = allocMode !== 'pct' ? `<td>${dollarStr}</td>` : '';

    return `<tr>
      <td style="color:#aaa;font-size:0.8rem">${i + 1}</td>
      <td style="font-family:monospace;font-weight:bold">${escapeHtml(r.asset)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="pct-bar-cell">
        <div class="pct-bar-wrap">
          <div class="pct-bar" style="width:${barWidth}px"></div>
          <span class="pct-label">${pctStr}</span>
        </div>
      </td>
      ${dollarCell}
      <td><div class="fund-tags">${tags}</div></td>
    </tr>`;
  }).join('');
}

function applySort() {
  document.querySelectorAll('#resultsTable th.sortable').forEach(th => {
    th.classList.toggle('active', th.dataset.col === sortCol);
  });
}

document.querySelectorAll('#resultsTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) { sortDir *= -1; }
    else { sortCol = th.dataset.col; sortDir = sortCol === 'portfolioPct' ? -1 : 1; }
    applySort();
    renderResultsTable();
  });
});

document.getElementById('searchBox').addEventListener('input', renderResultsTable);
document.getElementById('top20Only').addEventListener('change', renderResultsTable);

// -- Export CSV -----------------------------------------------------------
document.getElementById('exportBtn').addEventListener('click', () => {
  if (!aggregated.length) return;
  downloadCsv();
});

function buildCsv() {
  const rows    = [...aggregated].sort((a, b) => b.portfolioPct - a.portfolioPct);
  const headers = allocMode !== 'pct'
    ? ['Rank', 'Ticker', 'Name', 'Portfolio %', 'Dollar Value', 'Held In']
    : ['Rank', 'Ticker', 'Name', 'Portfolio %', 'Held In'];

  return [
    headers.join(','),
    ...rows.map((r, i) => {
      const base = [i + 1, r.asset, `"${r.name.replace(/"/g, '""')}"`, r.portfolioPct.toFixed(4)];
      if (allocMode !== 'pct') base.push(r.portfolioDollar.toFixed(2));
      base.push([...new Set(r.funds)].join(' | '));
      return base.join(',');
    })
  ].join('\n');
}

function downloadCsv() {
  const csv  = buildCsv();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'portfolio_holdings.csv'; a.click();
  URL.revokeObjectURL(url);
}

// -- Send Results Email ---------------------------------------------------
document.getElementById('emailBtn').addEventListener('click', async () => {
  const email = getEmail();
  const name  = document.getElementById('portfolioName').value.trim();

  if (!email) { showToast('Enter your email address first.'); return; }
  if (!name)  { showToast('Please save and name your portfolio before sending.'); return; }
  if (!aggregated.length) { showToast('Run an analysis first.'); return; }

  const csv = buildCsv();

  try {
    showToast('Sending email...');
    const res = await fetch(`${serverBase()}/email-results`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, portfolioName: name, csv })
    });
    const data = await res.json();
    if (!res.ok) { showToast('Email failed: ' + (data.error || 'Unknown error')); return; }
    showToast(`Results sent to ${email}!`);
  } catch (e) {
    showToast('Could not send email — please try again.');
  }
});

// -- Helpers --------------------------------------------------------------
function setLoading(on, msg = '') {
  document.getElementById('loadingMsg').classList.toggle('hidden', !on);
  document.getElementById('loadingText').textContent = msg;
  document.getElementById('analyzeBtn').disabled = on;
}

function showErrors(errors) {
  const el = document.getElementById('fetchErrors');
  el.innerHTML = '<strong>Warnings / Errors:</strong><ul style="margin-top:0.4rem;padding-left:1.2rem">' +
    errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
  el.classList.remove('hidden');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getEmail() { return document.getElementById('userEmail').value.trim().toLowerCase(); }

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function updateEmailBtn() {
  const name  = document.getElementById('portfolioName').value.trim();
  const email = getEmail();
  document.getElementById('emailBtn').disabled = !(name && email && aggregated.length > 0);
}


document.getElementById('userEmail').addEventListener('blur', () => {
  const email = getEmail();
  if (email && currentPortfolioType) lookupPortfolios(email);
});

async function lookupPortfolios(email) {
  if (!email || !currentPortfolioType) return;
  try {
    const res  = await fetch(`${serverBase()}/portfolio/list?email=${encodeURIComponent(email)}&portfolioType=${encodeURIComponent(currentPortfolioType)}`);
    const list = await res.json();
    renderSavedList(list);
    document.getElementById('savedPortfoliosWrap').classList.remove('hidden');
  } catch {
    showToast('Could not reach server.');
  }
}

function renderSavedList(list) {
  const el = document.getElementById('savedList');
  if (!list.length) {
    el.innerHTML = '<span class="saved-empty">No saved portfolios yet.</span>';
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="saved-item">
      <div class="saved-item-info">
        <span class="saved-name">${escapeHtml(p.name)}</span>
        <span class="saved-meta">${p.fundCount} fund${p.fundCount !== 1 ? 's' : ''} &middot; saved ${formatDate(p.savedAt)}</span>
      </div>
      <div class="saved-item-actions">
        <button class="btn-load"   data-name="${escapeHtml(p.name)}">Load</button>
        <button class="btn-delete" data-name="${escapeHtml(p.name)}">Delete</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.btn-load').forEach(btn =>
    btn.addEventListener('click', () => loadPortfolio(btn.dataset.name))
  );
  el.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => deletePortfolio(btn.dataset.name))
  );
}

async function loadPortfolio(name) {
  const email = getEmail();
  if (!email) { showToast('Enter your email address first.'); return; }
  try {
    const res = await fetch(`${serverBase()}/portfolio/load?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
    if (!res.ok) { showToast('Portfolio not found.'); return; }
    const p = await res.json();
    funds = p.funds;
    if (p.allocMode) { allocMode = p.allocMode; allocModeSelect.value = allocMode; updateAllocModeUI(); }

    if (currentPortfolioType === 'accenture401k') {
      buildAccentureFundRows();
      funds.forEach(f => {
        const input = document.querySelector(`.accenture-alloc[data-ticker="${f.ticker}"]`);
        if (input) input.value = f.alloc;
      });
      syncAccentureToFunds();
    } else {
      renderFundsTable();
    }

    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('portfolioName').value = name;
    currentPortfolioName = name;
    showToast(`Loaded "${name}" — review allocations then click Analyze.`);
  } catch {
    showToast('Could not load portfolio.');
  }
}

async function deletePortfolio(name) {
  if (!confirm(`Delete portfolio "${name}"?`)) return;
  const email = getEmail();
  try {
    await fetch(`${serverBase()}/portfolio/delete?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    lookupPortfolios(email);
    showToast(`Deleted "${name}".`);
  } catch {
    showToast('Could not delete.');
  }
}

document.getElementById('accenturePortfolioName').addEventListener('input', function () {
  document.getElementById('portfolioName').value = this.value;
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const email = getEmail();
  const name  = document.getElementById('portfolioName').value.trim();
  if (!email)        { showToast('Enter your email address first.'); return; }
  if (!name)         { showToast('Enter a portfolio name.'); return; }
  if (!funds.length) { showToast('Add funds before saving.'); return; }
  try {
    const res = await fetch(`${serverBase()}/portfolio/save`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, name, funds, portfolioType: currentPortfolioType, allocMode })
    });
    if (!res.ok) { showToast('Save failed.'); return; }
    currentPortfolioName = name;
    showToast(`Saved "${name}" successfully.`);
    lookupPortfolios(email);
  } catch {
    showToast('Could not save.');
  }
});

// -- Server banner --------------------------------------------------------
function initServerBanner() {
  const host = window.location.hostname;
  if (window.location.port === '3001') return;
  if (host.includes('railway.app'))    return;
  if (DEPLOYED_SERVER_URL && host === new URL(DEPLOYED_SERVER_URL).hostname) return;

  const banner = document.getElementById('serverBanner');
  const input  = document.getElementById('serverUrlInput');
  const btn    = document.getElementById('serverConnectBtn');
  const status = document.getElementById('serverStatus');

  banner.classList.remove('hidden');
  const saved = localStorage.getItem('serverUrl');
  if (saved) { input.value = saved; testServerUrl(saved, status); }

  btn.addEventListener('click', () => {
    const url = input.value.trim().replace(/\/$/, '');
    if (!url) { status.textContent = 'Enter a server address.'; status.className = 'server-status error'; return; }
    localStorage.setItem('serverUrl', url);
    testServerUrl(url, status);
  });
}

async function testServerUrl(url, statusEl) {
  statusEl.textContent = 'Testing...';
  statusEl.className   = 'server-status';
  try {
    await fetch(`${url}/holdings?ticker=TEST&type=etf`, { signal: AbortSignal.timeout(5000) });
    statusEl.textContent = 'Connected';
    statusEl.className   = 'server-status ok';
  } catch {
    statusEl.textContent = 'Cannot reach server.';
    statusEl.className   = 'server-status error';
  }
}

// -- Init -----------------------------------------------------------------
initServerBanner();