const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 4000;

// SSE clients by session id
const sseClients = {};

function sendSSE(sessionId, event) {
  const clients = sseClients[sessionId] || [];
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((res) => {
    try { res.write(payload); } catch (e) { /* ignore */ }
  });
}

app.get('/v1/stream/:session_id', (req, res) => {
  const sessionId = req.params.session_id;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  res.write(`: connected\n\n`);

  sseClients[sessionId] = sseClients[sessionId] || [];
  sseClients[sessionId].push(res);

  req.on('close', () => {
    sseClients[sessionId] = (sseClients[sessionId] || []).filter(r => r !== res);
  });
});

app.post('/v1/events', (req, res) => {
  console.log('Received events batch:', Array.isArray(req.body) ? req.body.length + ' events' : 'single payload');
  console.log(JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.post('/v1/intent', (req, res) => {
  console.log('Intent payload received:');
  console.log(JSON.stringify(req.body, null, 2));
  // mock a simple intent response
  res.json({ ok: true, intents: [{ intent: 'product_inquiry', confidence: 0.87 }] });
});

app.post('/v1/trigger_session', (req, res) => {
  console.log('Trigger session:', JSON.stringify(req.body || {}, null, 2));
  const sessionId = req.body?.session_id;
  // simulate pipeline work and send a SSE action to the client
  setTimeout(() => {
    const action = { type: 'SHOW_POPUP', payload: { title: 'Welcome back', text: 'Special offer just for you' } };
    if (sessionId) sendSSE(sessionId, action);
  }, 1000);

  // respond with a mocked final-agent result
  res.json({ ok: true, recommendation: { id: 'rec_123', title: 'Recommended product', score: 0.92 } });
});

app.listen(PORT, () => console.log(`Mock server listening on http://localhost:${PORT}`));
