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