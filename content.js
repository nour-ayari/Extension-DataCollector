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
  chrome.storage.local.get(["sessionId", "sessionStart"], (data) => {
    const now = Date.now();
    const timeoutMs = 30 * 60 * 1000; // 30 min inactivity

    if (!data.sessionId || !data.sessionStart || now - data.sessionStart > timeoutMs) {
      const newSessionId = "sess_" + crypto.randomUUID();
      chrome.storage.local.set(
        {
          sessionId: newSessionId,
          sessionStart: now,
          sessionLastActivity: now
        },
        () => callback(newSessionId, true)
      );
    } else {
      chrome.storage.local.set({ sessionLastActivity: now }, () =>
        callback(data.sessionId, false)
      );
    }
  });
}

function updateSessionActivity() {
  chrome.storage.local.set({ sessionLastActivity: Date.now() });
}

// -------------------------
// Page / device helpers
// -------------------------
function detectPageType() {
  const url = location.href.toLowerCase();

  if (url.includes("/product") || document.querySelector('[class*="product"]')) {
    return "product";
  }
  if (url.includes("/cart") || url.includes("panier")) {
    return "cart";
  }
  if (url.includes("/checkout") || url.includes("commande") || url.includes("payment")) {
    return "checkout";
  }
  if (url.includes("/category") || url.includes("/shop") || url.includes("/collection")) {
    return "category";
  }
  if (url.includes("promo") || url.includes("offer") || url.includes("discount")) {
    return "promo";
  }
  return "other";
}

function getDeviceCategory() {
  const width = window.innerWidth;
  if (width <= 768) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
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
    timestamp: new Date().toISOString()
  };
}

function getProductInfoFromPage() {
  const productName =
    document.querySelector("h1")?.innerText?.trim() || null;

  const priceText =
    document.querySelector('[class*="price"], .price, [data-price]')?.innerText?.trim() || null;

  const productId =
    document.querySelector("[data-product-id]")?.getAttribute("data-product-id") || null;

  return {
    product_id: productId,
    product_name: productName,
    price_text: priceText
  };
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
          chrome.runtime.sendMessage(
            {
              type: "TRACK_EVENT",
              payload: {
                anonymousId: anonId,
                event: eventName,
                context: {
                  sessionId: sessionId,
                  device: {
                    category: getDeviceCategory()
                  }
                },
                properties: {
                  ...getBaseProperties(),
                  ...properties
                }
              }
            },
            () => {
              if (chrome.runtime.lastError) {
                console.warn("sendMessage error:", chrome.runtime.lastError.message);
              }
            }
          );
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

// -------------------------
// 1. first_visit + page_view + product_view + promo_viewed
// -------------------------
window.addEventListener("load", () => {
  getAnonymousId((anonId, isFirstVisit) => {
    if (isFirstVisit) {
      sendEvent("first_visit", {
        landing_page: location.href,
        landing_referrer: document.referrer || null
      });
    }

    sendEvent("page_view", {});

    const pageType = detectPageType();

    if (pageType === "product") {
      sendEvent("product_view", {
        ...getProductInfoFromPage()
      });
    }

    if (pageType === "promo") {
      sendEvent("promo_viewed", {
        promo_url: location.href
      });
    }
  });
});

// -------------------------
// 2. Click tracking
// -------------------------
document.addEventListener("click", (e) => {
  if (!isExtensionValid()) return;

  updateSessionActivity();

  const el = e.target.closest("a, button, input, input[type='submit'], [class*='product'], [data-product]");
  if (!el) return;

  clickCount++;

  const text = el.innerText?.trim().slice(0, 100).toLowerCase() || "";
  const href = el.href || null;
  const cls = (el.className || "").toString().toLowerCase();
  const productInfo = getProductInfoFromPage();

  // add_to_cart
  if (
    text.includes("add to cart") ||
    text.includes("ajouter au panier") ||
    cls.includes("add-to-cart")
  ) {
    sendEvent("add_to_cart", {
      ...productInfo,
      quantity: 1,
      element_text: text,
      href
    });
    return;
  }

  // remove_from_cart
  if (
    text.includes("remove") ||
    text.includes("supprimer") ||
    cls.includes("remove-from-cart")
  ) {
    sendEvent("remove_from_cart", {
      ...productInfo,
      quantity: 1,
      element_text: text,
      href
    });
    return;
  }

  // add_quantity / decrease quantity
  if (
    text.includes("+") ||
    text.includes("increase") ||
    text.includes("augmenter") ||
    cls.includes("qty-plus")
  ) {
    sendEvent("add_quantity", {
      ...productInfo,
      change_type: "increase"
    });
    return;
  }

  if (
    text.includes("-") ||
    text.includes("decrease") ||
    text.includes("diminuer") ||
    cls.includes("qty-minus")
  ) {
    sendEvent("add_quantity", {
      ...productInfo,
      change_type: "decrease"
    });
    return;
  }

  // checkout_started
  if (
    text.includes("checkout") ||
    text.includes("commander") ||
    text.includes("payer") ||
    text.includes("order")
  ) {
    sendEvent("checkout_started", {
      element_text: text,
      href
    });
    return;
  }

  // login
  if (
    text.includes("login") ||
    text.includes("log in") ||
    text.includes("connexion") ||
    cls.includes("login")
  ) {
    sendEvent("login", {
      method: "unknown"
    });
    return;
  }

  // payment_completed
  if (
    text.includes("pay now") ||
    text.includes("payment completed") ||
    text.includes("confirm payment") ||
    text.includes("paiement confirmé")
  ) {
    sendEvent("payment_completed", {
      status: "success"
    });
    return;
  }

  // purchase_completed
  if (
    text.includes("purchase") ||
    text.includes("buy now") ||
    text.includes("order confirmed") ||
    text.includes("achat confirmé")
  ) {
    sendEvent("purchase_completed", {
      status: "success"
    });
    return;
  }
});

// -------------------------
// 3. Search + form submit
// -------------------------
document.addEventListener("submit", (e) => {
  updateSessionActivity();

  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const searchInput =
    form.querySelector(
      'input[type="search"], input[name*="search"], input[placeholder*="Search"], input[placeholder*="Recherche"]'
    );

  if (searchInput && searchInput.value.trim()) {
    sendEvent("search_performed", {
      query: searchInput.value.trim().slice(0, 100)
    });
    return;
  }

  sendEvent("form_submitted", {
    form_name: form.getAttribute("name") || form.getAttribute("id") || "unknown",
    form_action: form.getAttribute("action") || null
  });
});

// -------------------------
// 4. Scroll depth
// -------------------------
window.addEventListener("scroll", () => {
  if (!isExtensionValid()) return;

  updateSessionActivity();

  const total = document.documentElement.scrollHeight - window.innerHeight;
  if (total <= 0) return;

  const depth = Math.round((window.scrollY / total) * 100);

  if (depth >= maxScroll + 25) {
    maxScroll = depth;

    sendEvent("scroll_depth", {
      depth_pct: depth
    });
  }
});

// -------------------------
// 5. Time on page / engagement
// -------------------------
window.addEventListener("beforeunload", () => {
  if (!isExtensionValid()) return;

  const timeOnPageSec = Math.round((Date.now() - pageStart) / 1000);

  sendEvent("page_engagement", {
    time_on_page_sec: timeOnPageSec,
    max_scroll_pct: maxScroll,
    click_count: clickCount,
    is_bounce: clickCount === 0
  });
});