// js/api.js
const DEPLOYED_SERVER_URL = 'https://portfolio-analysis-lcw7.onrender.com';

function serverBase() {
  if (window.location.port === '3001') return '';
  return localStorage.getItem('serverUrl') || DEPLOYED_SERVER_URL;
}

const LOCAL_PROXY = () => `${serverBase()}/holdings`;
const YF_BASE     = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const YF_BASE2    = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

const EXT_PROXIES = [
  url => `https://corsproxy.io/?${url}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

async function fetchWithExtProxy(yfUrl) {
  const errors = [];
  for (const buildProxy of EXT_PROXIES) {
    try {
      const res = await fetch(buildProxy(yfUrl), { headers: { Accept: 'application/json' } });
      if (!res.ok) { errors.push(`HTTP ${res.status}`); continue; }
      const json = await res.json();
      return typeof json.contents === 'string' ? JSON.parse(json.contents) : json;
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error('External proxies failed: ' + errors.join('; '));
}

async function fetchPrice(ticker) {
  const res = await fetch(`${serverBase()}/price?ticker=${encodeURIComponent(ticker)}`, {
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.price) throw new Error('No price returned');
  return data.price;
}

async function fetchHoldings(ticker, type = 'etf') {
  ticker = ticker.toUpperCase();

  try {
    const res = await fetch(`${LOCAL_PROXY()}?ticker=${encodeURIComponent(ticker)}&type=${encodeURIComponent(type || 'etf')}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      const data = await res.json();
      return {
        holdings: data.holdings,
        source:   data.source,
        count:    data.count,
        warning:  data.warning || null
      };
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Proxy HTTP ${res.status}`);
  } catch (e) {
    throw e;
  }
}

function parseYahooApiResponse(json, ticker) {
  const result = json?.quoteSummary?.result?.[0]?.topHoldings;
  if (!result) {
    const errMsg = json?.quoteSummary?.error?.description || 'No holdings data found';
    throw new Error(errMsg);
  }
  const holdings = result.holdings || [];
  if (holdings.length === 0) throw new Error('No holdings returned — ticker may not be a fund');
  return holdings.map(h => ({
    asset:            (h.symbol      || '').toUpperCase(),
    name:             h.holdingName  || '',
    weightPercentage: (h.holdingPercent?.raw ?? 0) * 100
  }));
}