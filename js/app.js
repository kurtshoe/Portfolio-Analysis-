// -- State ----------------------------------------------------------------
let funds = [];
let aggregated = [];
let fetchMeta  = [];
let sortCol = 'portfolioPct';
let sortDir = -1;
let currentPortfolioType = '';

const ACCENTURE_FUNDS = [
  'CGNPF','FIDCD','FDICL','FDOTC','VEMRX',
  'VIGIX','VGINF','VMCPX','VGSNX','VSCPX','VTISF','VIVIX'
];

// -- Portfolio type selection ---------------------------------------------
const portfolioTypeSelect  = document.getElementById('portfolioType');
const portfolioContent     = document.getElementById('portfolioContent');
const blankState           = document.getElementById('blankState');
const fundAllocSection     = document.getElementById('fundAllocSection');
const fundAddRow           = document.getElementById('fundAddRow');
const accentureNameRow     = document.getElementById('accentureNameRow');

portfolioTypeSelect.addEventListener('change', function () {
  currentPortfolioType = this.value;
  blankState.classList.add('hidden');
  portfolioContent.classList.remove('hidden');
  fundAllocSection.classList.remove('hidden');

  funds = [];
  aggregated = [];
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('portfolioName').value = '';
  document.getElementById('accenturePortfolioName').value = '';

  if (currentPortfolioType === 'accenture401k') {
    fundAddRow.classList.add('hidden');
    accentureNameRow.classList.remove('hidden');
    buildAccentureFundRows();
  } else {
    fundAddRow.classList.remove('hidden');
    accentureNameRow.classList.add('hidden');
    renderFundsTable();
  }

  const email = getEmail();
  if (email) lookupPortfolios(email);
  else {
    document.getElementById('savedPortfoliosWrap').classList.add('hidden');
    document.getElementById('saveWrap').classList.remove('hidden');
  }
});

// -- Accenture 401K fund rows ---------------------------------------------
function buildAccentureFundRows() {
  const tbody = document.getElementById('fundsBody');
  tbody.innerHTML = ACCENTURE_FUNDS.map(ticker => `
    <tr data-ticker="${ticker}">
      <td><strong>${ticker}</strong></td>
      <td>Mutual Fund</td>
      <td>
        <input type="number" class="alloc-edit accenture-alloc" data-ticker="${ticker}"
          placeholder="%" min="0" max="100" step="0.01" style="width:70px">
        <span class="alloc-pct-symbol">%</span>
      </td>
      <td><em style="color:#aaa;font-size:0.8rem">locked</em></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.accenture-alloc').forEach(input => {
    input.addEventListener('input', syncAccentureToFunds);
  });
}

function syncAccentureToFunds() {
  funds = [];
  doc