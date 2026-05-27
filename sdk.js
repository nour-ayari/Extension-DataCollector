/* Minimal SDK (ES2020) - mirrors extension event shape and behavior
   - zero dependencies
   - conservative parity with extension/ content.js + background.js
   - exposes window.YourSDK: track, identify, setConsent, reset
*/
(function (window, document) {
  if (window.YourSDK) return;

  const VERSION = '1.0.0';
  const STORAGE_KEYS = {
    anon: 'your_sdk_anon_id',
    session: 'your_sdk_session_id',
    sessionMeta: 'your_sdk_session_meta',
    queue: 'your_sdk_queue'
  };

  // --- Utility ---
  const nowISO = () => new Date().toISOString();
  const uid = () => 'anon_' + (crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  function readJson(key, fallback) {
    try {
      const v = sessionStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val, useSession = true) {
    try {
      const s = useSession ? sessionStorage : localStorage;
      s.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  // --- Config loader (from script data- attributes) ---
  const scriptTag = document.currentScript || document.querySelector('script[data-tenant-id][src*="sdk.min.js"]') || document.querySelector('script[data-tenant-id]');
  const DEFAULT_ENDPOINT = 'https://api.yourplatform.com';
  const cfg = {
    tenantId: scriptTag?.getAttribute('data-tenant-id') || null,
    endpoint: scriptTag?.getAttribute('data-endpoint') || DEFAULT_ENDPOINT,
    consentMode: scriptTag?.getAttribute('data-consent-mode') || 'auto',
    debug: (scriptTag?.getAttribute('data-debug') || 'false') === 'true',
    triggerEndpoint: scriptTag?.getAttribute('data-trigger-endpoint') || null,
    intentEndpoint: scriptTag?.getAttribute('data-intent-endpoint') || null
  };

  function debugLog(...args) {
    if (cfg.debug) console.log('[YourSDK]', ...args);
  }

  // --- Identity + Session (localStorage preferred) ---
  function getAnonymousId() {
    try {
      let id = localStorage.getItem(STORAGE_KEYS.anon);
      if (!id) {
        id = uid();
        localStorage.setItem(STORAGE_KEYS.anon, id);
      }
      return id;
    } catch (e) {
      return uid();
    }
  }

  function getSessionMeta() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.sessionMeta);
      if (raw) return JSON.parse(raw);
      const s = { sessionId: null, sessionStart: Date.now(), pages: 0, nbVisits: 1, sequence: [] };
      sessionStorage.setItem(STORAGE_KEYS.sessionMeta, JSON.stringify(s));
      return s;
    } catch (e) {
      return { sessionId: null, sessionStart: Date.now(), pages: 0, nbVisits: 1, sequence: [] };
    }
  }

  function saveSessionMeta(meta) {
    try { sessionStorage.setItem(STORAGE_KEYS.sessionMeta, JSON.stringify(meta)); } catch (e) {}
  }

  function getSessionId() {
    const meta = getSessionMeta();
    const timeoutMs = 30 * 60 * 1000;
    const now = Date.now();
    if (!meta.sessionId || (meta.sessionLastActivity && now - meta.sessionLastActivity > timeoutMs)) {
      meta.sessionId = 'sess_' + uid().slice(5);
      meta.sessionStart = now;
      meta.pages = 1;
      meta.nbVisits = (meta.nbVisits || 0) + 1;
      meta.sequence = [];
      meta.sessionLastActivity = now;
    } else {
      meta.pages = (meta.pages || 0) + 1;
      meta.sessionLastActivity = now;
    }
    saveSessionMeta(meta);
    return meta.sessionId;
  }

  function appendToSessionSequence(eventName) {
    const meta = getSessionMeta();
    meta.sequence = meta.sequence || [];
    meta.sequence.push({ event: eventName, ts: nowISO() });
    meta.sequence = meta.sequence.slice(-50);
    saveSessionMeta(meta);
    return meta.sequence.map((s) => s.event);
  }

  // --- Consent detection ---
  function detectCMP() {
    try {
      if (typeof window.__cmp === 'function') return true;
      if (window.Cookiebot || window.CookieConsent) return true;
    } catch (e) {}
    return false;
  }

  let consentState = null; // null = unknown, true/false explicit
  function loadConsent() {
    try {
      const s = localStorage.getItem('your_sdk_consent');
      if (s === null) return null;
      return s === 'true';
    } catch (e) { return null; }
  }

  function setConsent(v) {
    consentState = !!v;
    try { localStorage.setItem('your_sdk_consent', consentState ? 'true' : 'false'); } catch (e) {}
    if (!consentState) {
      // stop + clear
      queue = [];
      saveQueue();
      debugLog('consent=false → clearing queue');
    } else {
      flushQueueAsync();
    }
  }

  // initialize consent
  consentState = loadConsent();
  if (consentState === null && cfg.consentMode === 'auto') {
    consentState = !detectCMP();
  }

  // --- Event schema helper (mirror extension base props) ---
  function getBaseProperties() {
    return {
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer || null,
      domain: location.hostname,
      page_type: detectPageType(),
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      device_category: getDeviceCategory(),
      language: navigator.language || null,
      traffic_source: inferTrafficSource(),
      landing_page: sessionStorage.getItem('landingPage') || (function(){ sessionStorage.setItem('landingPage', location.href); return location.href; })(),
      timestamp: nowISO()
    };
  }

  function detectPageType() {
    const url = location.href.toLowerCase();
    if (url.includes('/product') || document.querySelector('[class*="product"]')) return 'product';
    if (url.includes('/cart')) return 'cart';
    if (url.includes('/checkout')) return 'checkout';
    if (url.includes('/category') || url.includes('/collection') || url.includes('/shop')) return 'category';
    if (url.includes('promo') || url.includes('offer') || url.includes('discount')) return 'promo';
    return 'other';
  }

  function getDeviceCategory() {
    const width = window.innerWidth;
    if (width <= 768) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
  }

  function inferTrafficSource() {
    const ref = (document.referrer || '').toLowerCase();
    if (!ref) return 'direct';
    if (ref.includes('google.') || ref.includes('bing.') || ref.includes('yahoo.') || ref.includes('duckduckgo.')) return 'organic';
    if (ref.includes('facebook.') || ref.includes('instagram.') || ref.includes('tiktok.') || ref.includes('linkedin.') || ref.includes('twitter.') || ref.includes('x.com')) return 'social';
    if (ref.includes('mail.') || ref.includes('gmail.') || ref.includes('outlook.') || ref.includes('newsletter')) return 'email';
    return 'referral';
  }

  function getProductInfoFromPage() {
    const productName = document.querySelector('h1')?.innerText?.trim() || null;
    const priceText = document.querySelector('[class*="price"], .price, [data-price]')?.innerText?.trim() || null;
    const productId = document.querySelector('[data-product-id]')?.getAttribute('data-product-id') || null;
    const category = document.querySelector('[data-category]')?.getAttribute('data-category') || null;
    const brand = document.querySelector('[data-brand]')?.getAttribute('data-brand') || null;
    const sku = document.querySelector('[data-sku]')?.getAttribute('data-sku') || null;
    return { product_id: productId, product_name: productName, price_text: priceText, category, brand, sku };
  }

  // --- Queue + transport ---
  let queue = readJson(STORAGE_KEYS.queue, []);
  const MAX_EVENTS = 50;
  const FLUSH_MS = 2000;
  let flushTimer = null;

  function saveQueue() {
    try { sessionStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(queue)); } catch (e) {}
  }

  function enqueue(ev) {
    queue.push(ev);
    if (queue.length > MAX_EVENTS) queue = queue.slice(-MAX_EVENTS);
    saveQueue();
    if (queue.length >= MAX_EVENTS) flushQueueAsync();
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushQueueAsync(); }, FLUSH_MS);
  }

  function dispatchBatch(batch, attempt = 0) {
    const url = cfg.endpoint.replace(/\/$/, '') + '/v1/events';
    const body = JSON.stringify(batch);
    // Try fetch keepalive
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).then((res) => {
      if (res.ok) return true;
      throw new Error('bad status ' + res.status);
    }).catch(() => {
      // try sendBeacon
      try {
        if (navigator.sendBeacon) {
          const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
          if (ok) return Promise.resolve(true);
        }
      } catch (e) {}
      // xhr fallback
      return new Promise((resolve, reject) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url, true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve(true) : reject(new Error('xhr ' + xhr.status));
          xhr.onerror = () => reject(new Error('xhr error'));
          xhr.send(body);
        } catch (e) { reject(e); }
      }).catch(async (err) => {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 250));
          return dispatchBatch(batch, attempt + 1);
        }
        return false;
      });
    });
  }

  async function flushQueueAsync() {
    if (consentState === false) return;
    if (!queue.length) return;
    const toSend = queue.slice();
    queue = [];
    saveQueue();
    const ok = await dispatchBatch(toSend);
    if (!ok) { queue = toSend.concat(queue).slice(-MAX_EVENTS); saveQueue(); }
  }

  // --- Pipeline trigger / intent endpoints ---
  function getTriggerEndpoint() {
    return cfg.triggerEndpoint || (cfg.endpoint.replace(/\/$/, '') + '/v1/trigger_session');
  }

  function getIntentEndpoint() {
    return cfg.intentEndpoint || (cfg.endpoint.replace(/\/$/, '') + '/v1/intent');
  }

  async function triggerSessionOnBackend(sessionId) {
    if (!sessionId) return;
    if (consentState === false) return;
    const url = getTriggerEndpoint();
    const body = JSON.stringify({ session_id: sessionId, anonymous_id: getAnonymousId(), tenant_id: cfg.tenantId });
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      debugLog('triggered session on backend', sessionId);
    } catch (e) { debugLog('triggerSession failed', e.message); }
  }

  async function sendConversationToIntent(messages) {
    if (!messages || !messages.length) return;
    if (consentState === false) return;
    const url = getIntentEndpoint();
    const payload = { session_id: getSessionMeta().sessionId || getSessionId(), anonymous_id: getAnonymousId(), tenant_id: cfg.tenantId, messages };
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true });
      debugLog('sent conversation to intent agent', messages.length);
    } catch (e) { debugLog('intent POST failed', e.message); }
  }

  // --- Send event (mirrors extension payload) ---
  async function sendEvent(eventName, properties = {}) {
    if (consentState === false) return;
    if (consentState === null && cfg.consentMode === 'strict') return;

    const anonId = getAnonymousId();
    const sessionId = getSessionId();
    const seq = appendToSessionSequence(eventName);
    const base = await enrichEventProperties({ ...getBaseProperties(), ...properties, sequence: seq }, { clientId: anonId, sessionId, eventName });

    const payload = {
      anonymousId: anonId,
      client_id: anonId,
      session_id: sessionId,
      event: eventName,
      properties: base,
      context: {
        sessionId,
        device: { category: getDeviceCategory() },
        app: { name: 'YourSDK', version: VERSION },
        page: { url: base.page_url, title: base.page_title },
        userAgent: navigator.userAgent
      },
      sentAt: nowISO()
    };

    enqueue(payload);
  }

  async function enrichEventProperties(props, identity = {}) {
    const meta = getSessionMeta();
    const sessionStart = meta.sessionStart || Date.now();
    const sessionDurationSec = Math.max(1, Math.round((Date.now() - sessionStart) / 1000));
    const pageDurationSec = typeof props.time_on_page_sec === 'number' ? props.time_on_page_sec : null;
    const data = {
      ...props,
      client_id: identity.clientId || null,
      session_id: identity.sessionId || null,
      event_name: identity.eventName || null,
      event_type: identity.eventName || null,
      nb_visits: meta.nbVisits || 1,
      pages_per_session: meta.pages || 1,
      duration: props.duration ?? pageDurationSec ?? sessionDurationSec,
      page_duration_sec: pageDurationSec,
      session_duration_sec: sessionDurationSec,
      cart_abandonned: !!meta.addedToCart && !props.purchase_completed,
      is_bounce: props.is_bounce || false,
      age: null,
      gender: null
    };
    return data;
  }

  // --- Public API ---
  function identify({ userId } = {}) { if (!userId) return; try { localStorage.setItem('your_sdk_user_id', userId); } catch (e) {} }
  function reset() { try { localStorage.removeItem(STORAGE_KEYS.anon); sessionStorage.removeItem(STORAGE_KEYS.sessionMeta); sessionStorage.removeItem(STORAGE_KEYS.queue); } catch (e) {} queue = []; }

  // --- Event wiring (mirror extension) ---
  let pageStart = Date.now();
  let maxScroll = 0;
  let clickCount = 0;
  let lastScrollTrackedAt = 0;

  window.addEventListener('load', () => {
    const isFirst = !localStorage.getItem(STORAGE_KEYS.anon + '_seen');
    if (isFirst) localStorage.setItem(STORAGE_KEYS.anon + '_seen', '1');
    if (isFirst) sendEvent('first_visit', { landing_page: location.href, landing_referrer: document.referrer || null });
    sendEvent('page_view', {});
    const pageType = detectPageType();
    if (pageType === 'product') sendEvent('product_view', getProductInfoFromPage());
    if (pageType === 'promo') sendEvent('promo_viewed', { promo_url: location.href });
  }, { passive: true });

  document.addEventListener('click', (e) => {
    updateSessionActivity();
    const el = e.target.closest("a, button, input[type='submit'], [data-product], [class*='product']");
    if (!el) return;
    clickCount++;
    const text = (el.innerText || '').trim().slice(0,100).toLowerCase();
    const href = el.href || null;
    const cls = (el.className || '').toString().toLowerCase();
    const productInfo = getProductInfoFromPage();
    const trackEvent = (eventName, extraProps) => sendEvent(eventName, { ...productInfo, ...extraProps });
    if (text.includes('add to cart') || cls.includes('add-to-cart')) { setSessionFlag('addedToCart', true); return trackEvent('add_to_cart', { quantity: 1, element_text: text, href }); }
    if (text.includes('remove') || cls.includes('remove-from-cart')) { return trackEvent('remove_from_cart', { quantity: 1, element_text: text, href }); }
    if (text.includes('checkout') || text.includes('commander')) { setSessionFlag('checkoutStarted', true); return trackEvent('checkout_started', { element_text: text, href }); }
    if (text.includes('purchase') || text.includes('buy now')) { setSessionFlag('purchaseCompleted', true); return trackEvent('purchase_completed', { status: 'success', quantity: 1 }); }
    if (text.includes('login') || cls.includes('login')) { return trackEvent('login', { method: 'unknown', logged_in: true }); }
  }, { passive: true });

  document.addEventListener('submit', (e) => {
    updateSessionActivity();
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const searchInput = form.querySelector('input[type="search"], input[name*="search"], input[placeholder*="Search"]');
    if (searchInput && searchInput.value.trim()) return sendEvent('search_performed', { query: searchInput.value.trim().slice(0,100) });
    sendEvent('form_submitted', { form_name: form.getAttribute('name') || form.getAttribute('id') || 'unknown', form_action: form.getAttribute('action') || null });
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (Date.now() - lastScrollTrackedAt < 500) return;
    lastScrollTrackedAt = Date.now();
    updateSessionActivity();
    const total = document.documentElement.scrollHeight - window.innerHeight;
    if (total <= 0) return;
    const depth = Math.round((window.scrollY / total) * 100);
    if (depth >= maxScroll + 25) { maxScroll = depth; sendEvent('scroll_depth', { depth_pct: depth }); }
  }, { passive: true });

  window.addEventListener('beforeunload', () => {
    const timeOnPageSec = Math.round((Date.now() - pageStart) / 1000);
    const pageType = detectPageType();
    const meta = getSessionMeta();
    const addedToCart = !!meta.addedToCart;
    const checkoutStarted = !!meta.checkoutStarted;
    const purchaseCompleted = !!meta.purchaseCompleted;
    const sessionStart = typeof meta.sessionStart === 'number' ? meta.sessionStart : pageStart;
    const sessionDurationSec = Math.max(1, Math.round((Date.now() - sessionStart) / 1000));
    if (!purchaseCompleted && checkoutStarted && pageType === 'checkout') sendEvent('checkout_abandon', { abandon_reason: 'exit_before_purchase' });
    else if (!purchaseCompleted && addedToCart && pageType === 'cart') sendEvent('cart_abandon', { abandon_reason: 'exit_with_cart' });
    sendEvent('page_engagement', { duration: timeOnPageSec, time_on_page_sec: timeOnPageSec, session_duration_sec: sessionDurationSec, max_scroll_pct: maxScroll, click_count: clickCount, is_bounce: clickCount === 0 && maxScroll < 25 && timeOnPageSec < 15 });

    // Trigger pipeline run on backend for this session and send conversation to intent agent
    try {
      const sid = getSessionMeta().sessionId || getSessionId();
      const conv = getConversation();
      if (conv && conv.length) sendConversationToIntent(conv);
      triggerSessionOnBackend(sid);
    } catch (e) { debugLog('session trigger failed', e.message); }
  }, { passive: true });

  // --- small helpers ---
  function updateSessionActivity() { const meta = getSessionMeta(); meta.sessionLastActivity = Date.now(); saveSessionMeta(meta); }
  function setSessionFlag(k, v) { const meta = getSessionMeta(); meta[k] = v; saveSessionMeta(meta); }

  // --- Chatbot detection + conversation buffer ---
  const CHAT_STORAGE_KEY = 'your_sdk_chat_conv';

  function getConversation() {
    try { const raw = sessionStorage.getItem(CHAT_STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }

  function saveConversation(buf) {
    try { sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(buf)); } catch (e) {}
  }

  function appendConversation(role, text) {
    if (!text) return;
    const buf = getConversation();
    buf.push({ role, text, ts: nowISO() });
    if (buf.length > 200) buf.shift();
    saveConversation(buf);
  }

  function detectChatWidgets() {
    const selectors = ['[data-chat-widget]', '.chat-widget', '.chatbot', '.c-widget', '[id*=chat] iframe', '[class*=intercom]'];
    for (let sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const iframes = document.querySelectorAll('iframe');
    for (let f of iframes) {
      const src = f.getAttribute('src') || '';
      if (src.includes('tawk') || src.includes('intercom') || src.includes('drift') || src.includes('chat')) return f;
    }
    return null;
  }

  function observeChatConversation() {
    try {
      const widget = detectChatWidgets();
      if (!widget) return;
      debugLog('chat widget detected', widget);
      const target = widget.tagName === 'IFRAME' ? widget.contentDocument?.body : widget;
      if (!target) return;
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const text = node.innerText || node.textContent || '';
            if (!text) continue;
            const cls = (node.className || '').toString().toLowerCase();
            const role = (cls.includes('user') || cls.includes('you') || cls.includes('from-user')) ? 'user' : 'bot';
            appendConversation(role, text.trim().slice(0,2000));
          }
        }
      });
      mo.observe(target, { childList: true, subtree: true });
    } catch (e) { debugLog('observeChatConversation failed', e.message); }
  }

  // start chat observer after load
  window.addEventListener('load', () => { try { observeChatConversation(); } catch (e) {} }, { passive: true });

  // --- SSE inbound actions ---
  let sse = null;
  function startSSE() {
    if (!cfg.tenantId) return;
    const sessionId = getSessionMeta().sessionId || getSessionId();
    try {
      sse = new EventSource(cfg.endpoint.replace(/\/$/, '') + '/v1/stream/' + encodeURIComponent(sessionId));
      sse.onmessage = (e) => {
        try { const data = JSON.parse(e.data); handleInboundAction(data); } catch (err) { debugLog('sse parse error', err.message); }
      };
      sse.onerror = () => { debugLog('sse error'); sse.close(); setTimeout(startSSE, 3000); };
    } catch (e) { debugLog('sse init failed', e.message); }
  }

  function handleInboundAction(action) {
    if (!action || !action.type) return;
    switch (action.type) {
      case 'SHOW_POPUP': showPopup(action.payload); break;
      case 'SHOW_BANNER': showBanner(action.payload); break;
      case 'TRIGGER_CHATBOT': triggerChatbot(action.payload); break;
      case 'INJECT_COUPON': injectCoupon(action.payload); break;
      default: debugLog('unknown action', action.type); break;
    }
  }

  // Minimal Shadow DOM UI helpers
  function createRoot() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'false');
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '999999';
    host.style.right = '16px';
    host.style.bottom = '16px';
    document.documentElement.appendChild(host);
    const root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    return { host, root };
  }

  function showPopup(payload) {
    requestAnimationFrame(() => {
      const { host, root } = createRoot();
      const container = document.createElement('div');
      container.setAttribute('role','dialog');
      container.style.cssText = 'font-family:var(--sdk-font-family, Arial); background:var(--sdk-primary-color,#fff); padding:12px; border-radius:var(--sdk-border-radius,8px); box-shadow:0 6px 24px rgba(0,0,0,.15);';
      container.innerHTML = `<div>${escapeHtml(payload?.title || 'Offer')}</div><div style="margin-top:8px">${escapeHtml(payload?.text || '')}</div>`;
      root.appendChild(container);
      container.tabIndex = -1; container.focus();
      const onKey = (e) => { if (e.key === 'Escape') { host.remove(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
    });
  }

  function showBanner(payload) { debugLog('banner', payload); }
  function triggerChatbot(payload) { debugLog('chatbot', payload); }
  function injectCoupon(payload) { debugLog('coupon', payload); }

  function escapeHtml(s){ return String(s||'').replace(/[&<>\"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' })[c]); }

  // --- SPA hooks ---
  (function hookHistory(){
    const push = history.pushState; history.pushState = function(){ push.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
    const replace = history.replaceState; history.replaceState = function(){ replace.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
    window.addEventListener('locationchange', () => { sendEvent('page_view', {}); maxScroll = 0; clickCount = 0; pageStart = Date.now(); });
  })();

  // --- Init background flush + SSE ---
  setInterval(() => { try { flushQueueAsync(); } catch (e) {} }, 5000);
  if (consentState) startSSE();

  // --- Expose API ---
  const api = {
    track: (name, props) => sendEvent(name, props),
    identify, setConsent, reset,
    _debug: { cfg }
  };
  window.YourSDK = api;

})(window, document);
