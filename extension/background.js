const WRITE_KEY = btoa("3BtgnG9O19EIKEJptG1h4k9Nps6:");
const RUDDERSTACK_URL = "https://insatrefkarbfv.dataplane.rudderstack.com";
const MATCHED_DOMAINS = [
  "amazon.fr",
  "drest.tn",
  "aliexpress.com",
  "mytek.tn",
  "ebay.com",
  "alibaba.com",
  "walmart.com",
  "jumia.com", "jumia.tn", "jumia.ma", "jumia.dz",
  "zalando.com", "zalando.fr", "zalando.de", "zalando.co.uk",
  "myshopify.com"
];

// -------------------------
// On install → open consent page
// -------------------------
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("consent.html")
    });
  }
});

// -------------------------
// Inject content script on matching tabs
// -------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;

  const isMatched = MATCHED_DOMAINS.some(domain => tab.url.includes(domain));
  if (!isMatched) return;

  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  }).catch(err => console.warn("Inject error:", err.message));
});

// -------------------------
// Receive events from content script
// -------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "TRACK_EVENT") return;

  console.log("📩 Event reçu:", message);

  const {
    event,
    properties,
    anonymousId,
    context: incomingContext
  } = message.payload;

  // -------------------------
  // Build final payload (RudderStack format)
  // -------------------------
  const body = {
    anonymousId: anonymousId || "anon_" + crypto.randomUUID(),
    client_id: anonymousId || "anon_" + crypto.randomUUID(),
    session_id: incomingContext?.sessionId || message.payload.session_id || null,
    event: event,
    properties: properties || {},
    context: {
      sessionId: incomingContext?.sessionId || null,
      device: {
        category: incomingContext?.device?.category || "unknown"
      },
      app: {
        name: "DataCollectorExtension",
        version: "1.0"
      },
      page: {
        url: properties?.page_url || "",
        title: properties?.page_title || ""
      },
      userAgent: navigator.userAgent
    },
    sentAt: new Date().toISOString()
  };

  console.log("📤 Payload envoyé:", body);

  // -------------------------
  // Send to RudderStack
  // -------------------------
  fetch(`${RUDDERSTACK_URL}/v1/track`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${WRITE_KEY}`
    },
    body: JSON.stringify(body)
  })
    .then(async (res) => {
      const text = await res.text();

      console.log("✅ RudderStack status:", res.status);
      console.log("📄 Response:", text);

      sendResponse({ ok: res.ok, status: res.status, response: text });
    })
    .catch((err) => {
      console.error("❌ Erreur RudderStack:", err.message);
      sendResponse({ ok: false });
    });

  return true;
});