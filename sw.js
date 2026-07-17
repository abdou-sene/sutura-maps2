/*
  Service worker Sutura Maps.
  Stratégie volontairement prudente : RÉSEAU D'ABORD, cache en secours.
  On ne sert jamais de version périmée quand la connexion est là, et on ne
  touche JAMAIS aux fonctions Netlify (paiement, tokens) ni aux domaines
  externes (tuiles, CDN). Objectif : rendre l'app installable et utilisable
  hors ligne, sans rien casser du flux existant.
*/

const CACHE = "sutura-v2";

// Coquille de l'app mise en cache dès l'installation.
const SHELL = [
  "./",
  "./index.html",
  "./map.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./assets/brand/favicon-32.png",
  "./assets/brand/favicon-180.png",
  "./assets/brand/favicon-512.png",
  "./assets/brand/icon-192.png",
  "./assets/brand/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {
        /* un fichier manquant ne doit pas bloquer l'installation */
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Domaines externes (Leaflet, Turf, tuiles d'élévation, polices) : on laisse
  // le navigateur faire, sans interférer.
  if (url.origin !== self.location.origin) return;

  // Fonctions Netlify : jamais de cache. Paiement, tokens, occupation.
  if (url.pathname.includes("/.netlify/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // On ne met en cache que les réponses valides.
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
