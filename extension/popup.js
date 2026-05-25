document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const dateEl   = document.getElementById("date");
  const toggleBtn = document.getElementById("toggle");

  // Afficher l'état actuel
  chrome.storage.local.get(["consent", "consent_date"], (data) => {
    if (data.consent === undefined) {
      statusEl.textContent = "⚠ Consentement non renseigné";
      statusEl.className = "status unknown";
    } else if (data.consent) {
      statusEl.textContent = "✓ Collecte activée";
      statusEl.className = "status on";
    } else {
      statusEl.textContent = "✗ Collecte désactivée";
      statusEl.className = "status off";
    }

    if (data.consent_date) {
      const d = new Date(data.consent_date);
      dateEl.textContent = "Depuis le " + d.toLocaleDateString("fr-FR");
    }
  });

  // Bouton → rouvrir consent.html pour changer
  toggleBtn.addEventListener("click", () => {
    // Effacer l'ancien choix pour que consent.html ne ferme pas tout de suite
    chrome.storage.local.remove(["consent", "consent_date"], () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("consent.html")
      });
      window.close();
    });
  });
});
