const WRITE_KEY = btoa("3B8HVYOZnFuuFGfLrmFkIZX9E58:");
const RUDDERSTACK_URL = "https://isticnourfrvzz.dataplane.rudderstack.com";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("consent.html")
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "TRACK_EVENT") return;

  console.log("📩 Event reçu:", message);

  const { event, properties, anonymousId } = message.payload;

  const body = {
    anonymousId: anonymousId || "anon_" + crypto.randomUUID(),
    event: event,
    properties: properties,
    sentAt: new Date().toISOString(),
    context: {
      app: {
        name: "DataCollectorExtension",
        version: "1.0"
      },
      page: {
        url: properties?.url || "",
        title: properties?.title || ""
      },
      userAgent: navigator.userAgent
    }
  };

  console.log("📤 Payload envoyé:", body);

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
      console.error("❌ Erreur envoi RudderStack:", err.message);
      sendResponse({ ok: false });
    });

  return true;
});