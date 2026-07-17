/*
  Installation de l'app (PWA) — Sutura Maps.
  - Enregistre le service worker.
  - Android/Chrome : capte l'événement d'installation et affiche un bouton.
  - iOS/Safari : pas d'installation automatique possible, on affiche la marche
    à suivre (Partager puis « Sur l'écran d'accueil »).
  Le CTA n'apparaît QUE si l'app est installable et pas déjà installée.
*/

(function () {
  // ── Service worker ──
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* pas de SW = pas d'installation, mais le site marche normalement */
      });
    });
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  // Déjà installée : on ne propose rien.
  if (isStandalone) return;

  let deferredPrompt = null;

  function bar() {
    return document.getElementById("install-bar");
  }

  function showBar() {
    const el = bar();
    if (el) el.classList.add("show");
  }

  function hideBar() {
    const el = bar();
    if (el) el.classList.remove("show");
  }

  // ── Android / Chrome / Edge ──
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBar();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideBar();
    try {
      localStorage.setItem("sutura_installed", "1");
    } catch (err) {}
  });

  // ── Action du bouton ──
  window.suturaInstall = async function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (e) {}
      deferredPrompt = null;
      hideBar();
      return;
    }
    if (isIOS) showIOSSteps();
  };

  window.suturaDismissInstall = function () {
    hideBar();
    try {
      localStorage.setItem("sutura_install_dismissed", Date.now());
    } catch (e) {}
  };

  // ── Instructions iOS ──
  function showIOSSteps() {
    if (document.getElementById("ios-steps")) return;
    const ov = document.createElement("div");
    ov.id = "ios-steps";
    ov.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(14,12,10,.82);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;";
    ov.innerHTML = `
      <div style="background:#f7f3ec;max-width:340px;width:100%;padding:26px 22px;
                  border-radius:2px;text-align:center;font-family:'DM Sans',sans-serif;">
        <div style="font-family:'Cormorant Garamond',serif;font-size:1.6rem;
                    font-weight:700;color:#0e0c0a;margin-bottom:6px;">
          Installer Sutura Maps
        </div>
        <p style="font-size:0.86rem;color:#7a7068;line-height:1.5;margin-bottom:18px;">
          Sur iPhone, deux gestes suffisent. Rien à télécharger.
        </p>
        <div style="text-align:left;font-size:0.9rem;color:#0e0c0a;line-height:1.7;">
          <div>1. Touche le bouton <b>Partager</b> en bas de Safari.</div>
          <div>2. Choisis <b>« Sur l'écran d'accueil »</b>.</div>
        </div>
        <button onclick="document.getElementById('ios-steps').remove()"
                style="margin-top:20px;width:100%;padding:12px;border:none;
                       background:#0e0c0a;color:#f7f3ec;font-size:0.8rem;
                       letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;">
          J'ai compris
        </button>
      </div>`;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) ov.remove();
    });
    document.body.appendChild(ov);
  }

  // Sur iOS, aucun événement d'installation n'existe : on montre le CTA
  // directement (sauf si l'utilisateur l'a déjà écarté récemment).
  if (isIOS) {
    let dismissed = 0;
    try {
      dismissed = Number(localStorage.getItem("sutura_install_dismissed") || 0);
    } catch (e) {}
    const septJours = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissed > septJours) {
      window.addEventListener("load", () => setTimeout(showBar, 2500));
    }
  }
})();
