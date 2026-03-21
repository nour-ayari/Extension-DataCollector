document.addEventListener("DOMContentLoaded", () => {

  // Test que chrome.storage est bien accessible
  if (typeof chrome === "undefined" || !chrome.storage) {
    document.body.innerHTML = "<p style='color:red;padding:20px'>Erreur : chrome.storage inaccessible</p>";
    return;
  }

  const acceptBtn  = document.getElementById("accept");
  const declineBtn = document.getElementById("decline");
  const buttonsDiv = document.querySelector(".buttons");
  const doneDiv    = document.getElementById("done");

  function handleChoice(value) {
    // Désactiver les boutons pour éviter double clic
    acceptBtn.disabled  = true;
    declineBtn.disabled = true;

    chrome.storage.local.set(
      { consent: value, consent_date: Date.now() },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Erreur storage :", chrome.runtime.lastError.message);
          return;
        }

        // Cacher les boutons
        buttonsDiv.style.display = "none";

        // Afficher confirmation
        doneDiv.style.display = "block";
        doneDiv.style.background = value ? "#e8f5e9" : "#ffebee";
        doneDiv.style.color      = value ? "#2e7d32" : "#c62828";
        doneDiv.textContent      = value
          ? "✓ Merci ! La collecte est activée."
          : "✗ Collecte désactivée. Merci.";

        // Fermer après 2s
        setTimeout(() => window.close(), 2000);
      }
    );
  }

  acceptBtn.addEventListener("click",  () => handleChoice(true));
  declineBtn.addEventListener("click", () => handleChoice(false));

});