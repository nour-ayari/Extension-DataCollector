function isExtensionValid() {
  try {
    return !!chrome.runtime?.id;
  } catch (e) {
    return false;
  }
}

function getAnonymousId(callback) {
  chrome.storage.local.get("anonId", (data) => {
    if (data.anonId) {
      callback(data.anonId);
    } else {
      const id = "anon_" + crypto.randomUUID();
      chrome.storage.local.set({ anonId: id }, () => callback(id));
    }
  });
}

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
  return "other";
}

function getBaseProperties() {
  return {
    url: location.href,
    title: document.title,
    referrer: document.referrer || null,
    domain: location.hostname,
    page_type: detectPageType(),
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    timestamp: new Date().toISOString()
  };
}

function sendEvent(eventName, properties = {}) {
  if (!isExtensionValid()) return;

  try {
    chrome.storage.local.get("consent", (data) => {
      if (chrome.runtime.lastError || !data.consent) return;

      getAnonymousId((anonId) => {
        chrome.runtime.sendMessage(
          {
            type: "TRACK_EVENT",
            payload: {
              event: eventName,
              anonymousId: anonId,
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
  } catch (err) {
    if (!err.message.includes("Extension context invalidated")) {
      console.warn("sendEvent error:", err.message);
    }
  }
}

// -------------------------
// Session/page metrics
// -------------------------
const pageStart = Date.now();
let maxScroll = 0;
let clickCount = 0;

// 1. Page viewed
window.addEventListener("load", () => {
  sendEvent("page_viewed", {});
});

// 2. Product page viewed
window.addEventListener("load", () => {
  if (detectPageType() === "product") {
    const productName =
      document.querySelector("h1")?.innerText?.trim() || null;

    const priceText =
      document.querySelector('[class*="price"], .price, [data-price]')?.innerText?.trim() || null;

    sendEvent("product_page_viewed", {
      product_name: productName,
      product_price_text: priceText
    });
  }
});

// 3. Click tracking
document.addEventListener("click", (e) => {
  if (!isExtensionValid()) return;

  const el = e.target.closest("a, button, input[type='submit'], [class*='product'], [data-product]");
  if (!el) return;

  clickCount++;

  const text = el.innerText?.trim().slice(0, 100).toLowerCase() || "";
  const href = el.href || null;
  const cls = el.className || "";

  // Add to cart
  if (
    text.includes("add to cart") ||
    text.includes("ajouter au panier") ||
    cls.toString().toLowerCase().includes("add-to-cart")
  ) {
    sendEvent("add_to_cart_clicked", {
      element_tag: el.tagName,
      element_text: text,
      href
    });
    return;
  }

  // Checkout
  if (
    text.includes("checkout") ||
    text.includes("commander") ||
    text.includes("payer") ||
    text.includes("order")
  ) {
    sendEvent("checkout_started", {
      element_tag: el.tagName,
      element_text: text,
      href
    });
    return;
  }

  // Product click
  if (
    cls.toString().toLowerCase().includes("product") ||
    el.closest('[class*="product"], .product-card, .product-item')
  ) {
    sendEvent("product_clicked", {
      element_tag: el.tagName,
      element_text: text,
      href
    });
    return;
  }

  // Generic click
  sendEvent("element_clicked", {
    element_tag: el.tagName,
    element_text: text,
    href
  });
});

// 4. Search tracking
document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const searchInput =
    form.querySelector('input[type="search"], input[name*="search"], input[placeholder*="Search"], input[placeholder*="Recherche"]');

  if (searchInput && searchInput.value.trim()) {
    sendEvent("search_performed", {
      query: searchInput.value.trim().slice(0, 100)
    });
  }
});

// 5. Scroll depth
window.addEventListener("scroll", () => {
  if (!isExtensionValid()) return;

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

// 6. Exit / engagement
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