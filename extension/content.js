// -------------------------
// Chrome Extension Tracking Script
// Fully DB-ready with session, engagement, and product tracking
// -------------------------

// -------------------------
// Utility: check extension
// -------------------------
function isExtensionValid() {
  try {
    return !!chrome.runtime?.id;
  } catch (e) {
    return false;
  }
}

// -------------------------
// Identity / session helpers
// -------------------------
function getAnonymousId(callback) {
  chrome.storage.local.get("anonId", (data) => {
    if (data.anonId) {
      callback(data.anonId, false);
    } else {
      const id = "anon_" + crypto.randomUUID();
      chrome.storage.local.set({ anonId: id }, () => callback(id, true));
    }
  });
}

function getSessionId(callback) {
  chrome.storage.local.get(
    ["sessionId", "sessionStart", "sessionLastActivity", "pagesPerSession", "nbVisits"],
    (data) => {
      const now = Date.now();
      const timeoutMs = 30 * 60 * 1000; // 30 min inactivity
      const isExpired =
        !data.sessionId ||
        !data.sessionLastActivity ||
        now - data.sessionLastActivity > timeoutMs;

      let sessionId = data.sessionId;
      let pagesPerSession = data.pagesPerSession || 0;
      let nbVisits = data.nbVisits || 0;

      if (isExpired) {
        sessionId = "sess_" + crypto.randomUUID();
        pagesPerSession = 1;
        nbVisits = (nbVisits || 0) + 1;

        chrome.storage.local.set({
          sessionId,
          sessionStart: now,
          sessionLastActivity: now,
          pagesPerSession,
          nbVisits,
          eventSequence: [],
          addedToCart: false,
          checkoutStarted: false,
          purchaseCompleted: false,
          landingPage: location.href
        }, () => callback(sessionId, true));
      } else {
        pagesPerSession += 1;
        chrome.storage.local.set({ sessionLastActivity: now, pagesPerSession }, () =>
          callback(sessionId, false)
        );
      }
    }
  );
}

function updateSessionActivity() {
  chrome.storage.local.set({ sessionLastActivity: Date.now() });
}

function appendToSessionSequence(eventName, callback) {
  chrome.storage.local.get(["eventSequence"], (data) => {
    const seq = Array.isArray(data.eventSequence) ? data.eventSequence : [];
    seq.push({ event: eventName, ts: new Date().toISOString() });
    const trimmed = seq.slice(-50); // keep last 50 events
    chrome.storage.local.set({ eventSequence: trimmed }, () => {
      if (callback) callback(trimmed);
    });
  });
}

// -------------------------
// Page / device helpers
// -------------------------
function detectPageType() {
  const url = location.href.toLowerCase();
  if (url.includes("/product") || document.querySelector('[class*="product"]')) return "product";
  if (url.includes("/cart") || url.includes("panier")) return "cart";
  if (url.includes("/checkout") || url.includes("commande") || url.includes("payment")) return "checkout";
  if (url.includes("/category") || url.includes("/shop") || url.includes("/collection")) return "category";
  if (url.includes("promo") || url.includes("offer") || url.includes("discount")) return "promo";
  return "other";
}

function getDeviceCategory() {
  const width = window.innerWidth;
  if (width <= 768) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function inferTrafficSource() {
  const ref = (document.referrer || "").toLowerCase();
  if (!ref) return "direct";
  if (ref.includes("google.") || ref.includes("bing.") || ref.includes("yahoo.") || ref.includes("duckduckgo.")) return "organic";
  if (ref.includes("facebook.") || ref.includes("instagram.") || ref.includes("tiktok.") || ref.includes("linkedin.") || ref.includes("twitter.") || ref.includes("x.com")) return "social";
  if (ref.includes("mail.") || ref.includes("gmail.") || ref.includes("outlook.") || ref.includes("newsletter")) return "email";
  return "referral";
}

function getLandingPage() {
  const existing = sessionStorage.getItem("landingPage");
  if (existing) return existing;
  sessionStorage.setItem("landingPage", location.href);
  return location.href;
}

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
    landing_page: getLandingPage(),
    timestamp: new Date().toISOString()
  };
}

// -------------------------
// Product / promo info
// -------------------------
function getProductInfoFromPage() {
  const productName = document.querySelector("h1")?.innerText?.trim() || null;
  const priceText = document.querySelector('[class*="price"], .price, [data-price]')?.innerText?.trim() || null;
  const productId = document.querySelector("[data-product-id]")?.getAttribute("data-product-id") || null;
  const category = document.querySelector("[data-category]")?.getAttribute("data-category") || null;
  const brand = document.querySelector("[data-brand]")?.getAttribute("data-brand") || null;
  const sku = document.querySelector("[data-sku]")?.getAttribute("data-sku") || null;

  return { product_id: productId, product_name: productName, price_text: priceText, category, brand, sku };
}

// -------------------------
// Event enrichment (DB-ready)
// -------------------------
async function enrichEventProperties(props, identity = {}) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["nbVisits", "pagesPerSession", "addedToCart"], (data) => {
      resolve({
        ...props,
        client_id: identity.clientId || null,
        session_id: identity.sessionId || null,
        event_name: identity.eventName || null,
        event_type: identity.eventName || null,
        nb_visits: data.nbVisits || 1,
        pages_per_session: data.pagesPerSession || 1,
        cart_abandonned: !!data.addedToCart && !props.purchase_completed,
        is_bounce: props.is_bounce || false,
        age: null, // optional, to fill later
        gender: null // optional, to fill later
      });
    });
  });
}

// -------------------------
// Main sender
// -------------------------
function sendEvent(eventName, properties = {}) {
  if (!isExtensionValid()) return;

  try {
    chrome.storage.local.get("consent", (data) => {
      if (chrome.runtime.lastError || !data.consent) return;

      getAnonymousId((anonId) => {
        getSessionId((sessionId) => {
          appendToSessionSequence(eventName, (sequence) => {
            enrichEventProperties({
              ...getBaseProperties(),
              ...properties,
              sequence: sequence.map((x) => x.event)
              }, {
                clientId: anonId,
                sessionId,
                eventName
              }).then((enrichedProps) => {
              chrome.runtime.sendMessage({
                type: "TRACK_EVENT",
                payload: {
                  anonymousId: anonId,
                  event: eventName,
                  session_id: sessionId,
                  client_id: anonId,
                  context: {
                    sessionId,
                    userAgent: navigator.userAgent,
                    device: { category: getDeviceCategory() }
                  },
                  properties: enrichedProps
                }
              });
            });
          });
        });
      });
    });
  } catch (err) {
    if (!err.message.includes("Extension context invalidated")) {
      console.warn("sendEvent error:", err.message);
    }
  }
}

// -------------------------
// Session / engagement metrics
// -------------------------
const pageStart = Date.now();
let maxScroll = 0;
let clickCount = 0;
let lastScrollTrackedAt = 0;

// -------------------------
// 1. First visit + page view + product/promo views
// -------------------------
window.addEventListener("load", () => {
  getAnonymousId((anonId, isFirstVisit) => {
    if (isFirstVisit) {
      sendEvent("first_visit", { landing_page: location.href, landing_referrer: document.referrer || null });
    }

    sendEvent("page_view", {});
    const pageType = detectPageType();

    if (pageType === "product") sendEvent("product_view", getProductInfoFromPage());
    if (pageType === "promo") sendEvent("promo_viewed", { promo_url: location.href });
  });
});

// -------------------------
// 2. Click tracking
// -------------------------
document.addEventListener("click", (e) => {
  if (!isExtensionValid()) return;
  updateSessionActivity();

  const el = e.target.closest("a, button, input[type='submit'], [data-product], [class*='product']");
  if (!el) return;

  clickCount++;

  const text = el.innerText?.trim().slice(0, 100).toLowerCase() || "";
  const href = el.href || null;
  const cls = (el.className || "").toString().toLowerCase();
  const productInfo = getProductInfoFromPage();

  const trackEvent = (eventName, extraProps = {}) => sendEvent(eventName, { ...productInfo, ...extraProps });

  if (text.includes("add to cart") || text.includes("ajouter au panier") || cls.includes("add-to-cart")) {
    chrome.storage.local.set({ addedToCart: true });
    return trackEvent("add_to_cart", { quantity: 1, element_text: text, href });
  }
  if (text.includes("remove") || text.includes("supprimer") || cls.includes("remove-from-cart")) {
    return trackEvent("remove_from_cart", { quantity: 1, element_text: text, href });
  }
  if (text.includes("+") || text.includes("increase") || text.includes("augmenter") || cls.includes("qty-plus")) {
    return trackEvent("add_quantity", { change_type: "increase", element_text: text, href });
  }
  if (text.includes("-") || text.includes("decrease") || text.includes("diminuer") || cls.includes("qty-minus")) {
    return trackEvent("add_quantity", { change_type: "decrease", element_text: text, href });
  }
  if (text.includes("checkout") || text.includes("commander") || text.includes("payer") || text.includes("order")) {
    chrome.storage.local.set({ checkoutStarted: true });
    return trackEvent("checkout_started", { element_text: text, href });
  }
  if (text.includes("pay now") || text.includes("payment completed") || text.includes("confirm payment") || text.includes("paiement confirmé")) {
    return trackEvent("payment_completed", { status: "success" });
  }
  if (text.includes("purchase") || text.includes("buy now") || text.includes("order confirmed") || text.includes("achat confirmé")) {
    chrome.storage.local.set({ purchaseCompleted: true });
    return trackEvent("purchase_completed", { status: "success", quantity: 1 });
  }
  if (text.includes("login") || text.includes("log in") || text.includes("connexion") || cls.includes("login")) {
    return trackEvent("login", { method: "unknown", logged_in: true });
  }
});

// -------------------------
// 3. Search + form submit
// -------------------------
document.addEventListener("submit", (e) => {
  updateSessionActivity();
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const searchInput = form.querySelector('input[type="search"], input[name*="search"], input[placeholder*="Search"], input[placeholder*="Recherche"]');
  if (searchInput && searchInput.value.trim()) {
    return sendEvent("search_performed", { query: searchInput.value.trim().slice(0, 100) });
  }

  sendEvent("form_submitted", { form_name: form.getAttribute("name") || form.getAttribute("id") || "unknown", form_action: form.getAttribute("action") || null });
});

// -------------------------
// 4. Scroll depth
// -------------------------
window.addEventListener("scroll", () => {
  if (!isExtensionValid()) return;
  const now = Date.now();
  if (now - lastScrollTrackedAt < 500) return;
  lastScrollTrackedAt = now;

  updateSessionActivity();
  const total = document.documentElement.scrollHeight - window.innerHeight;
  if (total <= 0) return;

  const depth = Math.round((window.scrollY / total) * 100);
  if (depth >= maxScroll + 25) {
    maxScroll = depth;
    sendEvent("scroll_depth", { depth_pct: depth });
  }
});

// -------------------------
// 5. Time on page / engagement + abandonment
// -------------------------
window.addEventListener("beforeunload", () => {
  if (!isExtensionValid()) return;

  const timeOnPageSec = Math.round((Date.now() - pageStart) / 1000);
  const pageType = detectPageType();

  chrome.storage.local.get(["addedToCart", "checkoutStarted", "purchaseCompleted"], (data) => {
    const addedToCart = !!data.addedToCart;
    const checkoutStarted = !!data.checkoutStarted;
    const purchaseCompleted = !!data.purchaseCompleted;

    if (!purchaseCompleted && checkoutStarted && pageType === "checkout") {
      sendEvent("checkout_abandon", { abandon_reason: "exit_before_purchase" });
    } else if (!purchaseCompleted && addedToCart && pageType === "cart") {
      sendEvent("cart_abandon", { abandon_reason: "exit_with_cart" });
    }

    sendEvent("page_engagement", { duration: timeOnPageSec, max_scroll_pct: maxScroll, click_count: clickCount, is_bounce: clickCount === 0 && maxScroll < 25 && timeOnPageSec < 15 });
  });
});