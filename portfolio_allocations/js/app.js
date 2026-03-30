// ── State ────────────────────────────────────────────────────────────────────
let funds = [];           // { ticker, type, alloc }
let aggregated = [];      // final result rows
let fetchMeta  = [];      // { ticker, source, count, warning } per fund
let sortCol = 'portfolioPct';
let sortDir = -1;         // -1 = desc

// ── Fund table ───────────────────────────────────────────────────────────────
function renderFundsTable() {
  const tbody = document.getElementById('fundsBody');
  if (funds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#aaa;font-style:italic;padding:0.75rem">No funds added yet.</td></tr>';
  } else {
    tbody.innerHTML = funds.map((f, i) => `
      <tr>
        <td class="ticker-cell">${escapeHtml(f.ticker)}</td>
        <td>${f.type === 'mutual' ? 'Mutual Fund' : 'ETF / Index'}</td>
        <td>
          <input class="alloc-edit" type="number" value="${f.alloc}" min="0.01" max="100" step="0.01"
            onchange="updateAlloc(${i}, this.value)" title="Edit allocation %">
          <span class="alloc-pct-symbol">%</span>
        </td>
        <td><button class="del-btn" onclick="removeFund(${i})" title="Remove">&times;</button></td>
      </tr>
    `).join('');
  }
  updateAllocSummary();
}

function updateAllocSummary() {
  const total   = funds.reduce((sum, f) => sum + parseFloat(f.alloc), 0);
  const rounded = Math.round(total * 100) / 100;
  const capped  = Math.min(rounded, 100);
  const remaining = Math.round((100 - rounded) * 100) / 100;

  document.getElementById('totalAlloc').textContent = rounded + '%';

  const bar = document.getElementById('allocBar');
  bar.style.width = capped + '%';
  bar.className   = 'alloc-bar' +
    (rounded > 100.01 ? ' over' : rounded >= 99.99 ? ' complete' : '');

  const remEl = document.getElementById('allocRemaining');
  if (rounded >= 99.99 && rounded <= 100.01) {
    remEl.textContent  = 'Ready to analyze';
    remEl.className    = 'alloc-remaining ready';
  } else if (rounded > 100.01) {
    remEl.textContent  = (rounded - 100).toFixed(2) + '% over';
    remEl.className    = 'alloc-remaining over';
  } else {
    remEl.textContent  = remaining + '% remaining';
    remEl.className    = 'alloc-remaining';
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

  if (!ticker)          { showToast('Enter a ticker symbol.'); return; }
  if (isNaN(alloc) || alloc <= 0) { showToast('Enter a valid allocation %.'); return; }
  if (funds.some(f => f.ticker === ticker)) { showToast(`${ticker} already added.`); return; }

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
  if (isNaN(parsed) || parsed <= 0) { showToast('Enter a valid allocation %.'); renderFundsTable(); return; }
  funds[i].alloc = parsed;
  updateAllocSummary();
};

document.getElementById('clearFundsBtn').addEventListener('click', () => {
  if (funds.length === 0) return;
  if (confirm('Clear all funds?')) {
    funds = [];
    renderFundsTable();
    document.getElementById('resultsSection').classList.add('hidden');
  }
});

// ── Analysis ─────────────────────────────────────────────────────────────────
document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

async function runAnalysis() {

  setLoading(true, `Fetching holdings for ${funds.length} fund(s)...`);
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('fetchErrors').classList.add('hidden');

  const errors   = [];
  fetchMeta      = [];
  const stockMap = {}; // ticker -> { name, portfolioPct, funds: [] }
  const maxPct   = { val: 0 };

  for (const fund of funds) {
    setLoading(true, `Fetching ${fund.ticker}...`);
    try {
      const result = await fetchHoldings(fund.ticker, fund.type);
      const holdings = result.holdings;

      fetchMeta.push({
        ticker:  fund.ticker,
        source:  result.source  || 'unknown',
        count:   result.count   || 0,
        warning: result.warning || null
      });

      if (!Array.isArray(holdings) || holdings.length === 0) {
        errors.push(`${fund.ticker}: No holdings data returned. Check ticker or fund type.`);
        continue;
      }

      for (const h of holdings) {
        const sym  = (h.asset || '').toUpperCase();
        const name = h.name || '';
        const contribution = (parseFloat(h.weightPercentage) || 0) / 100 * fund.alloc;

        if (!sym || contribution <= 0) continue;

        if (!stockMap[sym]) {
          stockMap[sym] = { asset: sym, name, portfolioPct: 0, funds: [] };
        }
        stockMap[sym].portfolioPct += contribution;
        stockMap[sym].funds.push(fund.ticker);
        if (stockMap[sym].portfolioPct > maxPct.val) maxPct.val = stockMap[sym].portfolioPct;
      }
    } catch (err) {
      errors.push(`${fund.ticker}: ${err.message}`);
      fetchMeta.push({ ticker: fund.ticker, source: 'error', count: 0, warning: err.message });
    }
  }

  aggregated = Object.values(stockMap);
  aggregated.forEach(s => s._max = maxPct.val);

  setLoading(false);
  renderResults(errors);
}

// ── Results ──────────────────────────────────────────────────────────────────
function renderResults(errors = []) {
  document.getElementById('resultsSection').classList.remove('hidden');
  document.getElementById('holdingsCount').textContent = aggregated.length;

  renderDataSources();

  if (aggregated.length === 0) {
    document.getElementById('resultsBody').innerHTML =
      '<tr><td colspan="5" style="color:#aaa;text-align:center;padding:1.5rem">' +
      'No holdings data found. Check ticker symbols and fund types.' +
      '</td></tr>';
    if (errors.length) showErrors(errors);
    return;
  }

  applySort();
  renderResultsTable();

  if (errors.length > 0) showErrors(errors);
}

function renderDataSources() {
  let el = document.getElementById('dataSourcesInfo');
  if (!el) return;

  if (!fetchMeta.length) { el.classList.add('hidden'); return; }

  const rows = fetchMeta.map(m => {
    const warnHtml = m.warning
      ? `<div class="ds-warning">${escapeHtml(m.warning)}</div>`
      : '';
    const countClass = m.count >= 20 ? 'ds-count-good' : m.count > 0 ? 'ds-count-warn' : 'ds-count-err';
    return `
      <div class="ds-row">
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
  const search   = document.getElementById('searchBox').value.toLowerCase();
  const top20    = document.getElementById('top20Only').checked;

  let rows = [...aggregated];

  // Sort
  rows.sort((a, b) => {
    const av = a[sortCol] || '';
    const bv = b[sortCol] || '';
    if (typeof av === 'number') return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv)) * sortDir;
  });

  // Filter
  if (search) {
    rows = rows.filter(r =>
      r.asset.toLowerCase().includes(search) ||
      r.name.toLowerCase().includes(search)
    );
  }

  if (top20) rows = rows.slice(0, 20);

  const maxPct = rows.length ? rows[0].portfolioPct : 1;
  const tbody  = document.getElementById('resultsBody');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#aaa;text-align:center;padding:1rem">No results.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const barWidth = Math.max(2, Math.round((r.portfolioPct / maxPct) * 100));
    const pctStr   = r.portfolioPct.toFixed(3) + '%';
    const tags     = [...new Set(r.funds)].map(f => `<span class="fund-tag">${escapeHtml(f)}</span>`).join('');
    return `
      <tr>
        <td style="color:#aaa;font-size:0.8rem">${i + 1}</td>
        <td style="font-family:monospace;font-weight:bold">${escapeHtml(r.asset)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="pct-bar-cell">
          <div class="pct-bar-wrap">
            <div class="pct-bar" style="width:${barWidth}px"></div>
            <span class="pct-label">${pctStr}</span>
          </div>
        </td>
        <td><div class="fund-tags">${tags}</div></td>
      </tr>
    `;
  }).join('');
}

function applySort() {
  document.querySelectorAll('#resultsTable th.sortable').forEach(th => {
    th.classList.toggle('active', th.dataset.col === sortCol);
  });
}

document.querySelectorAll('#resultsTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) {
      sortDir *= -1;
    } else {
      sortCol = th.dataset.col;
      sortDir = sortCol === 'portfolioPct' ? -1 : 1;
    }
    applySort();
    renderResultsTable();
  });
});

document.getElementById('searchBox').addEventListener('input', renderResultsTable);
document.getElementById('top20Only').addEventListener('change', renderResultsTable);

// ── Export CSV ───────────────────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', () => {
  if (!aggregated.length) return;
  const rows = [...aggregated].sort((a, b) => b.portfolioPct - a.portfolioPct);
  const headers = ['Rank', 'Ticker', 'Name', 'Portfolio %', 'Held In'];
  const csv = [
    headers.join(','),
    ...rows.map((r, i) => [
      i + 1,
      r.asset,
      `"${r.name.replace(/"/g, '""')}"`,
      r.portfolioPct.toFixed(4),
      [...new Set(r.funds)].join(' | ')
    ].join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'portfolio_holdings.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Init ─────────────────────────────────────────────────────────────────────
renderFundsTable();
