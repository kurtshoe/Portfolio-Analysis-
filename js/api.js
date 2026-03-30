const LOCAL_PROXY = '/holdings';
const YF_BASE     = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const YF_BASE2    = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

// External CORS proxies (last-resort fallback — unreliable, 10 holdings max)
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

async function fetchHoldings(ticker, type = 'etf') {
  ticker = ticker.toUpperCase();

  // ── 1. Local Node proxy (scrapes page for 25 holdings) ───────────────────
  try {
    const res = await fetch(`${LOCAL_PROXY}?ticker=${encodeURIComponent(ticker)}&type=${encodeURIComponent(type || 'etf')}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      // Server returns { holdings, source, count, warning? }
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

  // ── 2. Last resort: external CORS proxies (10 holdings) ──────────────────
  let json;
  try {
    json = await fetchWithExtProxy(
      `${YF_BASE}/${encodeURIComponent(ticker)}?modules=topHoldings`
    );
  } catch {
    json = await fetchWithExtProxy(
      `${YF_BASE2}/${encodeURIComponent(ticker)}?modules=topHoldings`
    );
  }
  const holdings = parseYahooApiResponse(json, ticker);
  return {
    holdings,
    source:  'external CORS proxy (10-row limit)',
    count:   holdings.length,
    warning: 'Local proxy not running — start server.js for 25 holdings'
  };
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
