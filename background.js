const WRITE_KEY = btoa("3B8HVYOZnFuuFGfLrmFkIZX9E58:");
const RUDDERSTACK_URL = "https://isticnourfrvzz.dataplane.rudderstack.com";

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

      sendResponse({ ok: true });
    })
    .catch((err) => {
      console.error("❌ Erreur RudderStack:", err.message);
      sendResponse({ ok: false });
    });

  return true;
});