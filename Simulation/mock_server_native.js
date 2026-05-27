const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 4000;

const sseClients = {};

function sendSSE(sessionId, event) {
  const clients = sseClients[sessionId] || [];
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((res) => {
    try { res.write(payload); } catch (e) { }
  });
}

function handleOptions(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (chunk) => s += chunk);
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '';

  if (req.method === 'OPTIONS') return handleOptions(req, res);

  if (req.method === 'GET' && pathname.startsWith('/v1/stream/')) {
    const sessionId = pathname.split('/').pop();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    sseClients[sessionId] = sseClients[sessionId] || [];
    sseClients[sessionId].push(res);
    req.on('close', () => {
      sseClients[sessionId] = (sseClients[sessionId] || []).filter(r => r !== res);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/events') {
    const raw = await collectBody(req);
    let body = raw;
    try { body = JSON.parse(raw); } catch (e) {}
    console.log('Received events:', Array.isArray(body) ? body.length + ' events' : 'payload');
    console.log(JSON.stringify(body, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/intent') {
    const raw = await collectBody(req);
    let body = raw;
    try { body = JSON.parse(raw); } catch (e) {}
    console.log('Intent payload received:', JSON.stringify(body, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, intents: [{ intent: 'product_inquiry', confidence: 0.87 }] }));
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/trigger_session') {
    const raw = await collectBody(req);
    let body = raw;
    try { body = JSON.parse(raw); } catch (e) {}
    console.log('Trigger session:', JSON.stringify(body, null, 2));
    const sessionId = body?.session_id;
    setTimeout(() => {
      const action = { type: 'SHOW_POPUP', payload: { title: 'Welcome back', text: 'Mock offer' } };
      if (sessionId) sendSSE(sessionId, action);
    }, 1000);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, recommendation: { id: 'rec_123', title: 'Mock recommendation', score: 0.92 } }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => console.log(`Mock native server listening http://localhost:${PORT}`));
