/**
 * Local proxy server for Portfolio Allocation Analyzer.
 * Primary source: stockanalysis.com (25 holdings via Next.js page scrape)
 * Fallback:       Yahoo Finance quoteSummary API (10 holdings)
 * Requires Node.js 18+. Run with: node server.js
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = process.env.PORT || 3001;
console.log('PORT env var:', process.env.PORT);
console.log('Listening on port:', PORT);

const STATIC_DIR = __dirname;
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}

// ── Portfolio storage ─────────────────────────────────────────────────────────
const MONGODB_URI      = process.env.MONGODB_URI;
const PORTFOLIOS_FILE  = path.join(__dirname, 'portfolios.json');
let   dbCollection     = null;

async function initDb() {
  if (!MONGODB_URI) { console.log('  Storage: local file (portfolios.json)'); return; }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  dbCollection = client.db('portfolio_app').collection('portfolios');
  console.log('  Storage: MongoDB Atlas');
}

// ── File-based helpers ────────────────────────────────────────────────────────
function loadStore() {
  try { return JSON.parse(fs.readFileSync(PORTFOLIOS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveStore(store) {
  fs.writeFileSync(PORTFOLIOS_FILE, JSON.stringify(store, null, 2));
}

// ── Unified portfolio CRUD ────────────────────────────────────────────────────
async function dbList(email, portfolioType) {
  if (dbCollection) {
    const doc = await dbCollection.findOne({ email });
    const portfolios = doc?.portfolios || {};
    return Object.entries(portfolios)
      .filter(([, p]) => !portfolioType || (p.portfolioType || 'custom') === portfolioType)
      .map(([name, p]) => ({ name, savedAt: p.savedAt, fundCount: p.funds.length }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  const store      = loadStore();
  const portfolios = store[email] || {};
  return Object.entries(portfolios)
    .filter(([, p]) => !portfolioType || (p.portfolioType || 'custom') === portfolioType)
    .map(([name, p]) => ({ name, savedAt: p.savedAt, fundCount: p.funds.length }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function dbLoad(email, name) {
  if (dbCollection) {
    const doc = await dbCollection.findOne({ email });
    return doc?.portfolios?.[name] || null;
  }
  const store = loadStore();
  return store[email]?.[name] || null;
}

async function dbSave(email, name, funds, portfolioType) {
  const savedAt = new Date().toISOString();
  if (dbCollection) {
    await dbCollection.updateOne(
      { email },
      { $set: { [`portfolios.${name}`]: { funds, savedAt, portfolioType: portfolioType || 'custom' } } },
      { upsert: true }
    );
    return;
  }
  const store = loadStore();
  if (!store[email]) store[email] = {};
  store[email][name] = { funds, savedAt, portfolioType: portfolioType || 'custom' };
  saveStore(store);
}

async function dbDelete(email, name) {
  if (dbCollection) {
    await dbCollection.updateOne({ email }, { $unset: { [`portfolios.${name}`]: '' } });
    return;
  }
  const store = loadStore();
  if (store[email]?.[name]) { delete store[email][name]; saveStore(store); }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Low-level HTTP fetch ──────────────────────────────────────────────────────
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const reqOpts = {
      hostname:      parsed.hostname,
      path:          parsed.pathname + parsed.search,
      method:        'GET',
      headers:       options.headers || {},
      maxHeaderSize: 65536
    };
    const req = https.request(reqOpts, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers,
        body:    Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Method 1: stockanalysis.com page scrape (25 holdings) ────────────────────
async function scrapeStockAnalysis(ticker, type) {
  const segment = type === 'mutual' ? 'mutual-fund' : 'etf';
  const url = `https://stockanalysis.com/${segment}/${ticker.toLowerCase()}/holdings/`;

  const res = await fetchUrl(url, {
    headers: {
      'User-Agent':      UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  console.log(`  stockanalysis.com response: ${res.status}, ${res.body.length} bytes`);
  if (res.status >= 400) throw new Error(`stockanalysis.com returned HTTP ${res.status}`);

  const holdingsStart = res.body.indexOf('data:{holdings:[');
  if (holdingsStart === -1) throw new Error('holdings array not found in stockanalysis.com page');

  const arrOpen = res.body.indexOf('[', holdingsStart);
  let depth = 0, i = arrOpen;
  for (; i < res.body.length; i++) {
    const ch = res.body[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const rawArr = res.body.slice(arrOpen, i);
  const jsonArr = rawArr.replace(/([{,])(\w+):/g, '$1"$2":');
  const arr = JSON.parse(jsonArr);
  if (!arr.length) throw new Error('Parsed holdings array is empty');

  return arr;
}

function findHoldingsArray(node, depth = 0) {
  if (depth > 20 || node === null || node === undefined) return null;

  if (Array.isArray(node)) {
    if (node.length >= 3) {
      const first = node[0];
      if (first && typeof first === 'object' &&
          (first.symbol || first.ticker) &&
          (first.holdingPercent !== undefined || first.weight !== undefined ||
           first.weightPercentage !== undefined || first.pct !== undefined)) {
        return node;
      }
    }
    for (const item of node) {
      const found = findHoldingsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node === 'object') {
    if (node.topHoldings?.holdings?.length > 0) return node.topHoldings.holdings;
    if (node.holdings?.length > 0 && node.holdings[0]?.symbol) return node.holdings;
    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') {
        const found = findHoldingsArray(val, depth + 1);
        if (found) return found;
      }
    }
  }

  return null;
}

function normaliseHolding(h) {
  const rawSymbol = h.s || h.symbol || h.ticker || '';
  const symbol    = rawSymbol.replace(/^\$/, '').toUpperCase();
  const name      = h.n || h.holdingName || h.name || h.companyName || '';

  let pct;
  if (h.as && typeof h.as === 'string') {
    pct = parseFloat(h.as.replace('%', '')) || 0;
  } else {
    pct = h.holdingPercent ?? h.weight ?? h.weightPercentage ?? h.pct ?? 0;
    if (pct && typeof pct === 'object') pct = pct.raw ?? 0;
    pct = parseFloat(pct) || 0;
    if (pct <= 1.5) pct *= 100;
  }

  return { asset: symbol, name, weightPercentage: pct };
}

// ── Method 2: Yahoo Finance quoteSummary API (10 holdings fallback) ───────────
let yfCookie = null;
let yfCrumb  = null;

async function refreshCrumb() {
  const cookieRes = await fetchUrl('https://fc.yahoo.com', { headers: { 'User-Agent': UA } });
  yfCookie = cookieRes.headers['set-cookie']
    ? cookieRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
    : '';
  const crumbRes = await fetchUrl('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': yfCookie }
  });
  yfCrumb = crumbRes.body.trim();
  if (!yfCrumb || yfCrumb.startsWith('<')) throw new Error('Could not obtain Yahoo Finance crumb');
  console.log('  Crumb refreshed.');
}

async function fetchViaApi(ticker) {
  if (!yfCrumb) await refreshCrumb();

  for (const base of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    const url = `${base}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
                `?modules=topHoldings&crumb=${encodeURIComponent(yfCrumb)}`;
    try {
      let res = await fetchUrl(url, {
        headers: { 'User-Agent': UA, 'Cookie': yfCookie, 'Accept': 'application/json' }
      });
      if (res.status === 401 || res.status === 403) {
        await refreshCrumb();
        res = await fetchUrl(
          `${base}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
          `?modules=topHoldings&crumb=${encodeURIComponent(yfCrumb)}`,
          { headers: { 'User-Agent': UA, 'Cookie': yfCookie, 'Accept': 'application/json' } }
        );
      }
      if (res.status >= 400) continue;

      const json   = JSON.parse(res.body);
      const result = json?.quoteSummary?.result?.[0]?.topHoldings;
      if (!result) continue;

      return (result.holdings || []).map(h => ({
        asset:            (h.symbol      || '').toUpperCase(),
        name:             h.holdingName  || '',
        weightPercentage: (h.holdingPercent?.raw ?? 0) * 100
      }));
    } catch (e) {
      console.warn(`  API attempt failed: ${e.message}`);
    }
  }
  throw new Error('All Yahoo Finance API endpoints failed');
}

// ── Main entry point ──────────────────────────────────────────────────────────
async function getHoldings(ticker, type) {
  let scrapeWarning = null;

  try {
    const raw      = await scrapeStockAnalysis(ticker, type);
    const holdings = raw.map(normaliseHolding).filter(h => h.asset && h.weightPercentage > 0);
    if (holdings.length > 0) {
      return { holdings, source: 'stockanalysis.com (page scrape)', count: holdings.length };
    }
    scrapeWarning = 'Scrape returned empty holdings after normalisation';
  } catch (err) {
    scrapeWarning = err.message;
    console.warn(`  Scrape failed: ${scrapeWarning}`);
  }

  const holdings = await fetchViaApi(ticker);
  return {
    holdings,
    source:  'Yahoo Finance API (10-row limit)',
    count:   holdings.length,
    warning: `stockanalysis.com scrape failed — ${scrapeWarning}`
  };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Portfolio list ──────────────────────────────────────────────────────────
  if (url.pathname === '/portfolio/list') {
    const email         = (url.searchParams.get('email')         || '').trim().toLowerCase();
    const portfolioType = (url.searchParams.get('portfolioType') || '').trim();
    if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing email' })); return; }
    try {
      const list = await dbList(email, portfolioType);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Portfolio load ──────────────────────────────────────────────────────────
  if (url.pathname === '/portfolio/load') {
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    const name  = (url.searchParams.get('name')  || '').trim();
    if (!email || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing email or name' })); return; }
    try {
      const p = await dbLoad(email, name);
      if (!p) { res.writeHead(404); res.end(JSON.stringify({ error: 'Portfolio not found' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(p));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Portfolio save ──────────────────────────────────────────────────────────
  if (url.pathname === '/portfolio/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, name, funds, portfolioType } = JSON.parse(body);
        if (!email || !name || !funds) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields' })); return; }
        await dbSave(email.toLowerCase(), name, funds, portfolioType);
        console.log(`  Saved portfolio "${name}" for ${email}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // ── Portfolio delete ────────────────────────────────────────────────────────
  if (url.pathname === '/portfolio/delete' && req.method === 'DELETE') {
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    const name  = (url.searchParams.get('name')  || '').trim();
    if (!email || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing email or name' })); return; }
    try {
      await dbDelete(email, name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (url.pathname !== '/holdings') {
    serveStatic(req, res);
    return;
  }

  const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
  const type   = (url.searchParams.get('type')   || 'etf').trim().toLowerCase();

  if (!ticker) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ticker parameter' }));
    return;
  }

  try {
    console.log(`Fetching holdings for ${ticker} (type: ${type})...`);
    const result = await getHoldings(ticker, type);
    console.log(`  → ${result.count} holdings via ${result.source}${result.warning ? ' [warn: ' + result.warning + ']' : ''}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error(`  Error for ${ticker}:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

initDb().then(() => server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips  = ['localhost'];
  for (const iface of Object.values(nets)) {
    for (const n of iface) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  console.log('');
  console.log('  Kurt Shoe Investment Analysis');
  console.log('');
  console.log('  Open in browser:');
  ips.forEach(ip => console.log(`    http://${ip}:${PORT}`));
  console.log('');
  console.log('  Share any of the network addresses above with other users on the same network.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
})).catch(err => { console.error('Failed to start:', err.message); process.exit(1); });