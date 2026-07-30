async function track(event, commune = null, token = null) {
  try {
    await fetch("/.netlify/functions/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, commune, token }),
    });
  } catch (e) {}
}

let map;
let geoData = { communes: null };
let metaData = [];
let mapControls = { scale: null, north: null };
let locatorMap = null;
let regionMap = null;

/* ── PAYS (multi-pays Afrique de l'Ouest) ───────────────────────────
   Registre extensible. Chaque pays déclare ses fichiers et les types de
   carte qu'il supporte. Le relief (MNT) marche partout (tuiles mondiales) ;
   localisation et occupation ne sont pour l'instant activées que pour le
   Sénégal. Pour activer un type sur un autre pays, il suffira d'ajouter son
   nom dans `cartes` une fois les données prêtes.
   Convention de fichiers pour les nouveaux pays (GADM, noms renommés
   NAME_1/2/3 → REG/DEPT/CCRCA) :
     data/countries/<ISO>/meta.json   (noms seuls, pour les menus)
     data/countries/<ISO>/adm1.geojson (REG)         → niveau région
     data/countries/<ISO>/adm2.geojson (REG,DEPT)     → niveau département
     data/countries/<ISO>/adm3.geojson (REG,DEPT,CCRCA) → niveau commune */
const COUNTRIES = {
  SN: {
    nom: "Sénégal",
    meta: "data/meta.json",
    geo: {
      commune: "data/communes.geojson",
      dept: "data/departements.geojson",
      region: "data/regions.geojson",
    },
    cartes: ["localisation", "occupation", "relief"],
  },
  BEN: {
    nom: "Bénin",
    meta: "data/countries/BEN/meta.json",
    geo: {
      commune: "data/countries/BEN/adm3.geojson",
      dept: "data/countries/BEN/adm2.geojson",
      region: "data/countries/BEN/adm1.geojson",
    },
    cartes: ["relief"],
  },
  CIV: {
    nom: "Côte d'Ivoire",
    meta: "data/countries/CIV/meta.json",
    geo: {
      commune: "data/countries/CIV/adm3.geojson",
      dept: "data/countries/CIV/adm2.geojson",
      region: "data/countries/CIV/adm1.geojson",
    },
    cartes: ["relief"],
  },
};
let currentCountry = "SN";
function countryCfg() {
  return COUNTRIES[currentCountry] || COUNTRIES.SN;
}
function countrySupports(mapType) {
  return countryCfg().cartes.includes(mapType);
}

/* ── Cache réseau des GeoJSON ───────────────────────────────────────
   Une seule requête par fichier pour toute la session. Le préchargement
   démarre dès l'étape 2 (pendant que l'utilisateur personnalise), donc à
   la génération les données sont déjà là : plus d'écran vide. */
const geoFetchCache = {};
function fetchGeo(url) {
  if (!geoFetchCache[url]) {
    geoFetchCache[url] = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch((e) => {
        delete geoFetchCache[url]; // permet de réessayer plus tard
        throw e;
      });
  }
  return geoFetchCache[url];
}

function prefetchGeoData() {
  [
    "data/communes.geojson",
    "data/localites.geojson",
    "data/routes.geojson",
    "data/cours_eau.geojson",
    "data/ocean.geojson",
    "data/departements.geojson",
    "data/regions.geojson",
  ].forEach((u) => fetchGeo(u).catch(() => {}));
}

let selectedMapType = "localisation";
let selectedLevel = "commune"; // "commune" | "dept" | "region"
let occupationClipped = null;
let occupationPalette = {};

const PALETTE_DEFAULT = {
  "Carrière Mine Infrastructure": "#8B7355",
  "Cours d'eau": "#4A90B8",
  "Culture irriguée": "#7FBA00",
  "Culture maraîchère": "#A8D08D",
  "Culture pluviale": "#C6E0B4",
  Dune: "#F5DEB3",
  Forêt: "#1E6B1E",
  "Forêt galerie": "#2D8A2D",
  Lac: "#1B6CA8",
  Localité: "#E8735A",
  Mangrove: "#4D7A5E",
  Mare: "#6BAED6",
  "Plaine inondable": "#9ECAE1",
  "Plantation forestière": "#3A9A3A",
  "Prairie aquatique": "#74C476",
  Savane: "#D4B86A",
  "Savane arbustive": "#C49A3C",
  "Sol nu": "#D9B99B",
  Steppe: "#C8A96E",
  Tanne: "#B0A090",
  Vasière: "#8FA8A8",
};

// Ordre thématique de la légende d'occupation (anthropique, végétation par
// densité décroissante, cultures, eau et zones humides, sols nus).
const OCCUPATION_ORDER = [
  "Localité",
  "Carrière Mine Infrastructure",
  "Forêt",
  "Forêt galerie",
  "Plantation forestière",
  "Mangrove",
  "Savane",
  "Savane arbustive",
  "Steppe",
  "Culture irriguée",
  "Culture maraîchère",
  "Culture pluviale",
  "Cours d'eau",
  "Lac",
  "Mare",
  "Plaine inondable",
  "Prairie aquatique",
  "Vasière",
  "Tanne",
  "Sol nu",
  "Dune",
];

// Libellé affiché : "Localité" devient "Bâti".
function occLabel(nom) {
  return nom === "Localité" ? "Bâti" : nom;
}

// Trie les classes selon l'ordre thématique (inconnues à la fin).
function sortOccClasses(classes) {
  return [...classes].sort((a, b) => {
    const ia = OCCUPATION_ORDER.indexOf(a);
    const ib = OCCUPATION_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

/* ════════════════════════════════
   TYPE DE CARTE
════════════════════════════════ */

function selectMapType(btn) {
  document
    .querySelectorAll(".map-type-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedMapType = btn.dataset.type;
  occupationClipped = null;
  occupationPalette = {};
  // Localisation et relief partagent l'étape 2 simple (couleur ignorée pour
  // le relief). Seule l'occupation a son écran de palette.
  if (selectedMapType !== "occupation") {
    restoreStep2Localisation();
  }

  updateCountryNotice();
  checkNextBtn();
}

/* ════════════════════════════════
   NIVEAU GÉOGRAPHIQUE — bouton Suivant
════════════════════════════════ */

function checkNextBtn() {
  const reg = document.getElementById("select-reg")?.value;
  const dept = document.getElementById("select-dept")?.value;
  const commune = document.getElementById("select-commune")?.value;
  const btn = document.getElementById("btn-to-step2");
  if (!btn) return;

  // Ce type de carte n'est pas encore disponible pour le pays choisi.
  if (!countrySupports(selectedMapType)) {
    btn.disabled = true;
    return;
  }

  if (commune) selectedLevel = "commune";
  else if (dept) selectedLevel = "dept";
  else if (reg) selectedLevel = "region";
  else {
    selectedLevel = "commune";
    btn.disabled = true;
    return;
  }

  // Au moins la région doit être choisie.
  btn.disabled = !reg;
}

/* ════════════════════════════════
   BOUTON "SUIVANT" — point d'entrée unique
   (remplace onclick="goToStep(2)" dans le HTML)
════════════════════════════════ */

async function handleNextBtn() {
  // Préchargement des données en arrière-plan pendant la personnalisation :
  // à la génération, tout est déjà téléchargé.
  prefetchGeoData();

  if (selectedMapType !== "occupation") {
    // Localisation et relief : étape 2 simple, aucune donnée serveur.
    goToStep(2);
    restoreStep2Localisation();
  } else {
    // Occupation : afficher step 2 avec écran de chargement, puis preload
    goToStep(2);
    showStep2LoadingScreen();
    await preloadOccupation();
  }
}

/* ════════════════════════════════
   INITIALISATION
════════════════════════════════ */

window.onload = async () => {
  // Remplacer onclick du bouton Suivant par handleNextBtn
  const btnNext = document.getElementById("btn-to-step2");
  if (btnNext) {
    btnNext.removeAttribute("onclick");
    btnNext.addEventListener("click", handleNextBtn);
  }

  map = L.map("map-canvas", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
  });

  map.dragging.disable();
  map.touchZoom.disable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
  map.tap?.disable();

  try {
    const res = await fetch("data/meta.json");
    metaData = await res.json();
    initFilters();
    track("visit");

    // Sélecteur de pays : Sénégal par défaut, changement à la volée.
    const selCountry = document.getElementById("select-country");
    if (selCountry) {
      selCountry.value = currentCountry;
      selCountry.onchange = () => loadCountry(selCountry.value);
    }

    document.querySelectorAll(".color-swatch").forEach((swatch) => {
      swatch.onclick = () => {
        document
          .querySelectorAll(".color-swatch")
          .forEach((s) => s.classList.remove("selected"));
        swatch.classList.add("selected");
        document.getElementById("color-picker").value = swatch.dataset.color;
      };
    });

    // Détection token de téléchargement dans l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const dlToken = urlParams.get("token");
    const fromTab = urlParams.get("tab") === "1";

    if (dlToken && fromTab) {
      // Onglet de paiement (ordinateur) : l'onglet d'origine télécharge.
      showPaymentDoneInTab(dlToken);
    } else if (dlToken) {
      handleDownloadToken(dlToken);
    } else {
      // Pas de token dans l'URL : reprise éventuelle d'un achat déjà payé.
      resumePendingDownload();
    }
  } catch (e) {
    console.error(
      "Erreur : Fichiers GeoJSON introuvables dans le dossier /data",
      e,
    );
  }
};

/* ════════════════════════════════
   FILTRAGE DES DONNÉES
════════════════════════════════ */

function mapTypeLabel(t) {
  return t === "occupation"
    ? "Occupation du sol"
    : t === "relief"
      ? "Relief (MNT)"
      : "Localisation";
}

// Remet la cascade à zéro (utilisé au changement de pays).
function resetCascadeSelects() {
  const selReg = document.getElementById("select-reg");
  const selDept = document.getElementById("select-dept");
  const selCom = document.getElementById("select-commune");
  if (selReg) selReg.innerHTML = '<option value="">-- Région --</option>';
  if (selDept) {
    selDept.innerHTML = '<option value="">-- Département --</option>';
    selDept.disabled = true;
  }
  if (selCom) {
    selCom.innerHTML = '<option value="">-- Commune --</option>';
    selCom.disabled = true;
  }
}

// Affiche/masque la notice selon le pays et le type de carte choisi.
function updateCountryNotice() {
  const el = document.getElementById("country-notice");
  if (!el) return;
  if (!countrySupports(selectedMapType)) {
    el.style.display = "block";
    el.innerHTML =
      `La carte « ${mapTypeLabel(selectedMapType)} » n'est pas encore ` +
      `disponible pour <b>${countryCfg().nom}</b>. Pour ce pays, le ` +
      `<b>relief (MNT)</b> est disponible. Les autres arrivent bientôt.`;
  } else {
    el.style.display = "none";
  }
}

// Changement de pays : recharge le menu (meta.json du pays) et réévalue
// l'état des types de carte. Le Sénégal retrouve son comportement d'origine.
async function loadCountry(iso) {
  currentCountry = COUNTRIES[iso] ? iso : "SN";
  const cfg = countryCfg();
  resetCascadeSelects();
  selectedLevel = "commune";
  occupationClipped = null;
  occupationPalette = {};
  geoData = { communes: null };
  for (const k of Object.keys(geoFetchCache)) delete geoFetchCache[k];
  try {
    const res = await fetch(cfg.meta);
    if (!res.ok) throw new Error("HTTP " + res.status);
    metaData = await res.json();
  } catch (e) {
    metaData = [];
    console.warn("[pays] données indisponibles pour", iso, "—", e.message);
  }
  initFilters();
  updateCountryNotice();
  checkNextBtn();
}

function initFilters() {
  const selReg = document.getElementById("select-reg");
  const selDept = document.getElementById("select-dept"); // ← ajouter
  const selCom = document.getElementById("select-commune"); // ← ajouter
  const regions = [...new Set(metaData.map((f) => f.REG))].sort();
  regions.forEach((r) => selReg.add(new Option(r, r)));

  selReg.onchange = () => {
    const reg = selReg.value;

    selDept.innerHTML = '<option value="">-- Département --</option>';
    selDept.disabled = !reg;
    selCom.innerHTML = '<option value="">-- Commune --</option>';
    selCom.disabled = true;

    // Réinitialiser les données préchargées
    occupationClipped = null;
    occupationPalette = {};

    if (reg) {
      const depts = [
        ...new Set(metaData.filter((f) => f.REG === reg).map((f) => f.DEPT)),
      ].sort();
      depts.forEach((d) => selDept.add(new Option(d, d)));
      selDept.onchange = updateCommunes;
    }
    checkNextBtn();
  };
}

function updateCommunes() {
  const dept = document.getElementById("select-dept").value;
  const selCom = document.getElementById("select-commune");

  selCom.innerHTML = '<option value="">-- Commune --</option>';
  selCom.disabled = !dept;

  occupationClipped = null;
  occupationPalette = {};

  if (dept) {
    const coms = metaData
      .filter((f) => f.DEPT === dept)
      .sort((a, b) => a.CCRCA.localeCompare(b.CCRCA));
    coms.forEach((c) => selCom.add(new Option(c.CCRCA, c.CCRCA)));
    selCom.onchange = () => {
      occupationClipped = null;
      occupationPalette = {};
      checkNextBtn();
    };
  }
  checkNextBtn();
}

/* ════════════════════════════════
   ÉTAPE 2 — ÉCRAN DE CHARGEMENT
════════════════════════════════ */

function showStep2LoadingScreen() {
  const reg = document.getElementById("select-reg").value;
  const dept = document.getElementById("select-dept").value;
  const commune = document.getElementById("select-commune").value;

  const zoneName = commune || dept || reg;
  const zoneLevel = commune ? "commune" : dept ? "département" : "région";

  const card = document.querySelector("#step-2 .card");
  card.innerHTML = `
    <h2>2. Couleurs des classes</h2>
    <div style="
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      min-height:220px;gap:1.2rem;width:100%;text-align:center;
    ">
      <div style="
        width:52px;height:52px;border-radius:50%;
        border:2px solid var(--line);
        border-top:2px solid var(--terra);
        animation:spinRing 0.9s linear infinite;
        flex-shrink:0;
      "></div>
      <div>
        <p style="font-size:0.82rem;color:var(--ink);font-weight:500;margin:0 0 4px;">
          Analyse ${zoneLevel}
        </p>
        <p style="font-size:0.72rem;color:var(--terra);font-weight:500;letter-spacing:2px;text-transform:uppercase;margin:0;">
          ${zoneName}
        </p>
        <p style="font-size:0.7rem;color:var(--muted);font-weight:300;margin:6px 0 0;">
          Chargement des données d'occupation…
        </p>
      </div>
    </div>
    <div class="btn-group" style="margin-top:1rem;justify-content:center;">
      <button class="btn-back" onclick="goToStep(1)">Retour</button>
      <button class="btn-next" disabled style="opacity:0.4;cursor:not-allowed;">Patienter...</button>
    </div>
  `;
}

/* ════════════════════════════════
   ÉTAPE 2 — COULEURS DES CLASSES
════════════════════════════════ */

function buildStep2Occupation(classes) {
  // Initialiser la palette avec les valeurs par défaut
  classes.forEach((nom) => {
    if (!occupationPalette[nom]) {
      occupationPalette[nom] = PALETTE_DEFAULT[nom] || "#cccccc";
    }
  });

  const reg = document.getElementById("select-reg").value;
  const dept = document.getElementById("select-dept").value;
  const commune = document.getElementById("select-commune").value;
  const zoneName = commune || dept || reg;
  const zoneLevel = commune ? "Commune" : dept ? "Département" : "Région";

  const card = document.querySelector("#step-2 .card");
  card.style.transition = "opacity 0.25s ease";
  card.style.opacity = "0";

  setTimeout(() => {
    card.innerHTML = `
      <h2>2. Couleurs & signature</h2>
      <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.3rem;font-weight:300;">
        Zone : <strong style="color:var(--ink)">${zoneLevel} de ${zoneName}</strong>
        &nbsp;·&nbsp;
        <span style="color:var(--terra)">${classes.length} classe${classes.length > 1 ? "s" : ""}</span>
      </p>
      <p style="font-size:0.72rem;color:var(--muted);margin-bottom:1rem;font-weight:300;">
        Cliquez sur un carré pour changer la couleur d'une classe.
      </p>
      <div id="occupation-colors" style="
        display:flex;flex-direction:column;gap:2px;
        max-height:300px;overflow-y:auto;padding-right:4px;
      ">
        ${classes
          .map(
            (nom, i) => `
          <div style="
            display:flex;align-items:center;gap:12px;
            padding:7px 6px;border-bottom:1px solid var(--line);
            opacity:0;animation:fadeUp 0.3s ease ${i * 35}ms forwards;
            border-radius:1px;transition:background 0.15s;
          "
          onmouseover="this.style.background='var(--cream)'"
          onmouseout="this.style.background='transparent'">
            <input type="color" value="${occupationPalette[nom]}"
              data-class="${nom}"
              onchange="occupationPalette[this.dataset.class]=this.value"
              style="width:36px;height:30px;padding:2px;cursor:pointer;flex-shrink:0;border-radius:1px;border:1px solid var(--line);">
            <span style="font-size:0.8rem;color:var(--ink);font-weight:300;flex:1;">${occLabel(nom)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="form-group" style="margin-top:1.2rem;">
        <label>Nom de l'auteur</label>
        <input type="text" id="author-name" placeholder="Votre nom et prénom (sinon Sutura Maps)" />
      </div>
      <div class="btn-group" style="margin-top:1rem;">
        <button class="btn-back" onclick="goToStep(1)">Retour</button>
        <button class="btn-next" onclick="generateFinalMap()">Générer la carte</button>
      </div>
    `;
    card.style.opacity = "1";
  }, 250);
}

function restoreStep2Localisation() {
  const card = document.querySelector("#step-2 .card");
  if (!card) return;
  card.style.transition = "opacity 0.25s ease";
  card.style.opacity = "0";

  setTimeout(() => {
    card.innerHTML = `
      <h2>2. Style & Signature</h2>
      <div class="form-group">
        <label>Couleur de la commune</label>
        <input type="color" id="color-picker" value="#7BA05B" />
        <div class="color-palette" id="color-palette">
          <div class="color-swatch selected" data-color="#7BA05B" style="background:#7BA05B" title="Vert olive"></div>
          <div class="color-swatch" data-color="#C4956A" style="background:#C4956A" title="Terre cuite douce"></div>
          <div class="color-swatch" data-color="#C9A84C" style="background:#C9A84C" title="Or"></div>
          <div class="color-swatch" data-color="#7B6B8D" style="background:#7B6B8D" title="Violet doux"></div>
          <div class="color-swatch" data-color="#5B8C7A" style="background:#5B8C7A" title="Vert sauge"></div>
        </div>
      </div>
      <div class="form-group">
        <label>Nom de l'auteur</label>
        <input type="text" id="author-name" placeholder="Votre nom complet" />
      </div>
      <div class="btn-group">
        <button class="btn-back" onclick="goToStep(1)">Retour</button>
        <button class="btn-next" onclick="generateFinalMap()">Générer la carte</button>
      </div>
    `;
    card.style.opacity = "1";

    document.querySelectorAll(".color-swatch").forEach((swatch) => {
      swatch.onclick = () => {
        document
          .querySelectorAll(".color-swatch")
          .forEach((s) => s.classList.remove("selected"));
        swatch.classList.add("selected");
        document.getElementById("color-picker").value = swatch.dataset.color;
      };
    });
  }, 250);
}

/* ════════════════════════════════
   PRÉCHARGEMENT OCCUPATION DU SOL
════════════════════════════════ */

async function preloadOccupation() {
  const commune = document.getElementById("select-commune").value;
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;

  // Niveau selon la sélection (commune, département ou région).
  const level = selectedLevel;

  const missing =
    (level === "commune" && !commune) ||
    (level === "dept" && !dept) ||
    !reg;
  if (missing) {
    showError("Sélection incomplète pour l'occupation du sol.");
    goToStep(1);
    return;
  }

  try {
    const res = await fetch("/.netlify/functions/get-occupation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commune, dept, reg, level }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    occupationClipped = geojson.features || [];

    if (occupationClipped.length === 0) {
      showError("Aucune donnée d'occupation du sol pour cette zone.");
      restoreStep2Localisation();
      return;
    }

    const classesPresentes = [
      ...new Set(
        occupationClipped
          .map((f) => (f.properties.NOM || "").trim())
          .filter(Boolean),
      ),
    ].sort();

    buildStep2Occupation(classesPresentes);
  } catch (e) {
    console.error("preloadOccupation error:", e);
    showError("Erreur lors du chargement des données d'occupation.");
    const card = document.querySelector("#step-2 .card");
  }
}

/* ════════════════════════════════
   LÉGENDE — LOCALISATION
════════════════════════════════ */

function restoreLocalisationLegend() {
  const body = document.querySelector("#legend-card .panel-card-body");
  if (!body) return;
  body.innerHTML = `
  <div class="legend-item" id="legend-chef-lieu">
    <span class="legend-point" style="background:#e74c3c;border-color:#fff"></span>
    <span class="legend-label">Chef-lieu</span>
  </div>
  <div class="legend-item" id="legend-quartiers">
    <span class="legend-point" style="background:#8e44ad;border-color:#fff"></span>
    <span class="legend-label">Quartier</span>
  </div>
  <div class="legend-item" id="legend-autres">
    <span class="legend-point" style="background:#555555;border-color:#fff"></span>
    <span class="legend-label">Village</span>
  </div>
  <div class="legend-item" id="legend-routes">
    <span class="legend-line road-line"></span>
    <span class="legend-label">Route</span>
  </div>
  <div class="legend-item" id="legend-cours-eau">
    <span class="legend-line water-line"></span>
    <span class="legend-label">Cours d'eau</span>
  </div>
  <div class="legend-item" id="legend-internal" style="display:none">
    <span class="legend-swatch" id="legend-internal-swatch"
          style="background:transparent;border:1.5px dashed #000000"></span>
    <span class="legend-label" id="legend-internal-label">Limites internes</span>
  </div>
  <div class="legend-item">
    <span class="legend-swatch commune-swatch" id="legend-commune-swatch"></span>
    <span class="legend-label" id="legend-commune-label">Zone d'étude</span>
  </div>
  <div class="legend-item">
    <span class="legend-swatch neighbor-swatch"></span>
    <span class="legend-label" id="legend-limitrophe-label">Communes limitrophes</span>
  </div>
  <div class="legend-item" id="legend-ocean" style="display:none">
    <span class="legend-swatch" style="background:#c8dfe8;border-color:#a8c8d8;opacity:1"></span>
    <span class="legend-label">Océan Atlantique</span>
  </div>
`;
}

/* ════════════════════════════════
   LÉGENDE — OCCUPATION DU SOL
════════════════════════════════ */

function buildOccupationLegend(classes, palette) {
  const body = document.querySelector("#legend-card .panel-card-body");
  if (!body) return;
  body.innerHTML = "";

  const subtitle = document.createElement("p");
  subtitle.innerText = "Occupation du sol";
  subtitle.style.cssText = `
    font-size:0.68rem;font-weight:600;letter-spacing:1.5px;
    text-transform:uppercase;color:var(--muted);
    margin-bottom:8px;padding-bottom:6px;
    border-bottom:1px solid rgba(14,12,10,0.1);
  `;
  body.appendChild(subtitle);

  sortOccClasses(classes).forEach((nom) => {
    const color = palette[nom] || "#cccccc";
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-swatch" style="background:${color};border-color:rgba(0,0,0,0.15);opacity:1"></span>
      <span>${occLabel(nom)}</span>
    `;
    body.appendChild(item);
  });
}

/* ════════════════════════════════
   FONCTIONS DE CHARGEMENT COUCHES
════════════════════════════════ */

async function addLayer(url, style, communeFeature) {
  try {
    const data = await fetchGeo(url);
    const tb = turf.bbox(communeFeature);
    const filtered = data.features.filter((f) => {
      try {
        // Pré-filtre rapide par boîte englobante avant le test coûteux.
        const fb = turf.bbox(f);
        if (fb[2] < tb[0] || fb[0] > tb[2] || fb[3] < tb[1] || fb[1] > tb[3])
          return false;
        return turf.booleanIntersects(f, communeFeature);
      } catch (e) {
        return false;
      }
    });
    const hasFeatures = filtered.length > 0;
    if (hasFeatures) {
      L.geoJSON(
        { ...data, features: filtered },
        { style, interactive: false },
      ).addTo(map);
    }
    return hasFeatures;
  } catch (e) {
    console.error("addLayer error:", url, e);
    return false;
  }
}

async function addPoints(
  url,
  communeFeature,
  level = "commune",
  pointNames = null,
) {
  try {
    const data = await fetchGeo(url);
    const bbox = turf.bbox(communeFeature);
    await new Promise((r) => setTimeout(r, 0));

    const CHEF_LIEUX = [
      "Capital of commune",
      "Capital of CA",
      "Admin3 capital",
      "Admin2 capital",
      "Admin1 capital",
      "National capital",
    ];

    // Types de points conservés selon le niveau de la carte.
    const DEPT_CAPS = ["Admin2 capital", "Admin1 capital", "National capital"];
    const passLevel = (type, nom) => {
      if (level === "commune") return true;
      if (level === "dept") return CHEF_LIEUX.some((c) => type.includes(c));
      if (level === "region") {
        // Chef-lieu par attribut, sinon par nom de département (override inclus).
        if (pointNames && pointNames.has(normNom(nom))) return true;
        return DEPT_CAPS.some((c) => type.includes(c));
      }
      return true;
    };

    let features = data.features.filter((f) => {
      try {
        const type = (f.properties.popPlace_1 || "").trim();
        if (type === "Hameau" || type === "Chef lieu de quartier") return false;
        if (!passLevel(type, f.properties.nom)) return false;
        const [x, y] = f.geometry.coordinates;
        if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3])
          return false;
        return turf.booleanPointInPolygon(f, communeFeature);
      } catch (e) {
        return false;
      }
    });

    // Région : un seul point par nom, en privilégiant le type le plus officiel
    // (ex. deux "Keur Massar" → on garde le Capital of CA).
    if (level === "region") {
      const rank = (t) => {
        const i = CHEF_LIEUX.indexOf((t || "").trim());
        return i === -1 ? 99 : i;
      };
      const byName = new Map();
      features.forEach((f) => {
        const key = normNom(f.properties.nom);
        const cur = byName.get(key);
        if (
          !cur ||
          rank(f.properties.popPlace_1) < rank(cur.properties.popPlace_1)
        ) {
          byName.set(key, f);
        }
      });
      features = [...byName.values()];
    }

    const hasChefLieu =
      level === "region" ||
      features.some((f) =>
        CHEF_LIEUX.some((c) => (f.properties.popPlace_1 || "").includes(c)),
      );
    const hasQuartier = features.some((f) => {
      const t = (f.properties.popPlace_1 || "").trim();
      return t === "Quartier" || t === "Chef lieu de quartier";
    });
    const hasAutres = features.some((f) => {
      const t = (f.properties.popPlace_1 || "").trim();
      return (
        !CHEF_LIEUX.some((c) => t.includes(c)) &&
        t !== "Quartier" &&
        t !== "Chef lieu de quartier"
      );
    });

    const elQU = document.getElementById("legend-quartiers");
    const elCL = document.getElementById("legend-chef-lieu");
    const elAU = document.getElementById("legend-autres");
    if (elQU) elQU.style.display = hasQuartier ? "flex" : "none";
    if (elCL) elCL.style.display = hasChefLieu ? "flex" : "none";
    if (elAU) elAU.style.display = hasAutres ? "flex" : "none";

    features.sort((a, b) => a.properties.nom.length - b.properties.nom.length);

    const localiteLayer = L.geoJSON(
      { ...data, features },
      {
        pointToLayer: (feature, latlng) => {
          const type = (feature.properties.popPlace_1 || "").trim();
          // En région, tous les points retenus sont des chefs-lieux de dept.
          const isChefLieu =
            level === "region" || CHEF_LIEUX.some((c) => type.includes(c));
          const isQuartier = type === "Quartier";
          return L.circleMarker(latlng, {
            radius: isChefLieu ? 6 : 4,
            fillColor: isChefLieu
              ? "#e74c3c"
              : isQuartier
                ? "#ae22eb"
                : "#555555",
            color: "#fff",
            weight: 1.5,
            fillOpacity: 1,
          });
        },
        onEachFeature: (feature, layer) => {
          const nm = feature.properties?.nom;
          if (!nm || /H[1-9]/.test(nm)) return;
          const type = (feature.properties.popPlace_1 || "").trim();
          layer.__label = {
            name: nm,
            chef:
              level === "region" || CHEF_LIEUX.some((c) => type.includes(c)),
          };
        },
      },
    );
    localiteLayer.addTo(map);

    // Placement intelligent : le chef-lieu d'abord et toujours visible, puis
    // on teste les 8 directions autour de chaque point et on masque ce qui ne
    // rentre nulle part (priorité aux noms courts).
    setTimeout(() => placeLocaliteLabels(localiteLayer), 80);

    const counter = document.getElementById("localite-count");
    if (counter) counter.innerText = features.length;
  } catch (e) {
    console.error("addPoints error:", e);
  }
}

/* ════════════════════════════════
   PLACEMENT DES LABELS DE LOCALITÉS
════════════════════════════════ */

// Coupe les noms longs sur deux lignes, au plus près du milieu.
function wrapName(name) {
  if (name.length <= 16) return { html: name, two: false };
  const mid = name.length / 2;
  let best = -1,
    bestDist = Infinity;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " ") {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  if (best < 0) return { html: name, two: false };
  return {
    html: name.slice(0, best) + "<br>" + name.slice(best + 1),
    two: true,
  };
}

function placeLocaliteLabels(group) {
  const items = [];
  group.eachLayer((l) => {
    if (l.__label && l.getLatLng) items.push(l);
  });
  if (!items.length) return;

  // Mesure hors écran de la taille réelle de chaque label.
  const meas = document.createElement("div");
  meas.style.cssText =
    "position:absolute;visibility:hidden;left:-9999px;top:-9999px;";
  document.body.appendChild(meas);

  const sized = items.map((l) => {
    const w = wrapName(l.__label.name);
    meas.className =
      "leaflet-tooltip-localite" +
      (l.__label.chef ? " chef-lieu" : "") +
      (w.two ? " twoline" : "");
    meas.style.whiteSpace = w.two ? "normal" : "nowrap";
    meas.style.maxWidth = w.two ? "120px" : "none";
    meas.innerHTML = w.html;
    const r = meas.getBoundingClientRect();
    return {
      layer: l,
      name: l.__label.name,
      chef: l.__label.chef,
      html: w.html,
      two: w.two,
      w: r.width,
      h: r.height,
    };
  });
  document.body.removeChild(meas);

  // Chef-lieu d'abord, puis noms les plus courts.
  sized.sort((a, b) => b.chef - a.chef || a.name.length - b.name.length);

  const mapSize = map.getSize();
  const g = 2; // marge entre le point et le label (resserrée)
  // Côtés d'abord (labels collés au point), diagonales en dernier recours.
  const PRESETS = ["R", "L", "T", "B", "TR", "BR", "TL", "BL"];
  const placed = [];

  // Géométrie d'une boîte selon la direction, alignée sur la logique Leaflet.
  // En diagonale, le coin du label touche le point (pas de décalage vertical
  // supplémentaire) pour qu'il reste visuellement rattaché à son point.
  function boxFor(p, ax, ay, w, h) {
    switch (p) {
      case "R":
        return [ax + g, ay - h / 2, "right", [g, 0]];
      case "L":
        return [ax - g - w, ay - h / 2, "left", [-g, 0]];
      case "T":
        return [ax - w / 2, ay - g - h, "top", [0, -g]];
      case "B":
        return [ax - w / 2, ay + g, "bottom", [0, g]];
      case "TR":
        return [ax + g, ay - h, "right", [g, -h / 2]];
      case "BR":
        return [ax + g, ay, "right", [g, h / 2]];
      case "TL":
        return [ax - g - w, ay - h, "left", [-g, -h / 2]];
      case "BL":
        return [ax - g - w, ay, "left", [-g, h / 2]];
    }
  }
  const hit = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
  const inBounds = (l, t, w, h) =>
    l >= 0 && t >= 0 && l + w <= mapSize.x && t + h <= mapSize.y;
  // Marge de sécurité anti-chevauchement (absorbe le contour blanc des textes).
  const PAD = 4;
  const inflate = (b) => ({
    l: b.l - PAD,
    t: b.t - PAD,
    r: b.r + PAD,
    b: b.b + PAD,
  });

  sized.forEach((s) => {
    const pt = map.latLngToContainerPoint(s.layer.getLatLng());
    let chosen = null,
      chosenBox = null,
      fallback = null,
      fallbackScore = Infinity;

    for (const p of PRESETS) {
      const [bx, by, dir, off] = boxFor(p, pt.x, pt.y, s.w, s.h);
      const box = { l: bx, t: by, r: bx + s.w, b: by + s.h };
      const within = inBounds(bx, by, s.w, s.h);
      const collides = placed.some((pb) => hit(box, pb));

      if (within && !collides) {
        chosen = { dir, off };
        chosenBox = box;
        break;
      }
      // Pour le chef-lieu : on retient la position la moins chevauchante.
      if (s.chef) {
        let area = 0;
        placed.forEach((pb) => {
          const ox = Math.max(0, Math.min(box.r, pb.r) - Math.max(box.l, pb.l));
          const oy = Math.max(0, Math.min(box.b, pb.b) - Math.max(box.t, pb.t));
          area += ox * oy;
        });
        const score = area + (within ? 0 : 1e6);
        if (score < fallbackScore) {
          fallbackScore = score;
          fallback = { dir, off, box };
        }
      }
    }

    if (!chosen && s.chef && fallback) {
      chosen = { dir: fallback.dir, off: fallback.off };
      chosenBox = fallback.box;
    }
    if (!chosen) return; // village/quartier sans place : masqué

    s.layer
      .bindTooltip(s.html, {
        permanent: true,
        direction: chosen.dir,
        offset: chosen.off,
        className:
          "leaflet-tooltip-localite" +
          (s.chef ? " chef-lieu" : "") +
          (s.two ? " twoline" : ""),
      })
      .openTooltip();
    placed.push(inflate(chosenBox));
  });
}

/* ════════════════════════════════
   GRATICULE
════════════════════════════════ */

function toDMS(deg, isLat) {
  const d = Math.floor(Math.abs(deg));
  const m = Math.floor((Math.abs(deg) - d) * 60);
  const dir = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  return `${d}°${String(m).padStart(2, "0")}′${dir}`;
}

function addGraticule(map) {
  const bounds = map.getBounds();
  const minX = bounds.getWest(),
    maxX = bounds.getEast();
  const minY = bounds.getSouth(),
    maxY = bounds.getNorth();
  const spanX = maxX - minX;
  // Intervalle adaptatif selon la taille de la zone
  const interval =
    spanX < 0.1 ? 0.02 : spanX < 0.3 ? 0.05 : spanX < 1 ? 0.1 : 0.5;
  const style = { color: "#555", weight: 0.5, opacity: 0.5, dashArray: "3 10" };

  // Conteneur des étiquettes, dans les marges de 7 mm (recréé à chaque carte).
  const area = document.getElementById("map-area");
  const old = document.getElementById("grat-labels");
  if (old) old.remove();
  const labels = document.createElement("div");
  labels.id = "grat-labels";
  if (area) area.appendChild(labels);

  // Décalage des marges en pixels (7 mm rendus par le navigateur).
  const canvasEl = map.getContainer();
  const offX = canvasEl.offsetLeft;
  const offY = canvasEl.offsetTop;
  const size = map.getSize();

  for (
    let x = Math.ceil(minX / interval) * interval;
    x <= maxX;
    x += interval
  ) {
    L.polyline(
      [
        [minY, x],
        [maxY, x],
      ],
      style,
    ).addTo(map);

    // Longitude : au-dessus du cadre, dans la marge haute.
    const pt = map.latLngToContainerPoint([maxY, x]);
    if (pt.x >= 0 && pt.x <= size.x) {
      const d = document.createElement("div");
      d.className = "grat-top";
      d.style.left = offX + pt.x + "px";
      d.innerHTML = `<span>${toDMS(x, false)}</span>`;
      labels.appendChild(d);
    }
  }

  for (
    let y = Math.ceil(minY / interval) * interval;
    y <= maxY;
    y += interval
  ) {
    L.polyline(
      [
        [y, minX],
        [y, maxX],
      ],
      style,
    ).addTo(map);

    // Latitude : à gauche du cadre, verticale ascendante, dans la marge gauche.
    const pt = map.latLngToContainerPoint([y, minX]);
    if (pt.y >= 0 && pt.y <= size.y) {
      const d = document.createElement("div");
      d.className = "grat-left";
      d.style.top = offY + pt.y + "px";
      d.innerHTML = `<span>${toDMS(y, true)}</span>`;
      labels.appendChild(d);
    }
  }

  L.rectangle(bounds, {
    color: "#2c3e50",
    weight: 0.5,
    fill: false,
    interactive: false,
  }).addTo(map);
}

/* ════════════════════════════════
   SUTURA MAPS LIVE
════════════════════════════════ */

function addLiveWatermark() {
  const mapArea = document.getElementById("map-area");
  const old = document.getElementById("live-watermark");
  if (old) old.remove();

  const wm = document.createElement("div");
  wm.id = "live-watermark";
  wm.style.cssText = `position:absolute;inset:0;z-index:999;pointer-events:none;overflow:hidden;`;
  wm.innerHTML = `
    <!-- Sutura rek -->
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0">
      <defs>
        <pattern id="wm" x="0" y="0" width="180" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
          <text x="0" y="30" font-family="DM Sans" font-size="13" font-weight="600"
                fill="rgba(14,12,10,0.28)" letter-spacing="1">© Sutura Maps</text>
          <text x="0" y="55" font-family="DM Sans" font-size="9" font-weight="300"
                fill="rgba(14,12,10,0.18)" letter-spacing="1">Non payé</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>
    </svg>


  `;
  mapArea.appendChild(wm);
}

/* ════════════════════════════════
   HELPER — MARKER VOISIN
════════════════════════════════ */

function createNeighborMarker(latlng, name, anchorX) {
  const icon = L.divIcon({
    className: "leaflet-tooltip-commune",
    html: name,
    iconSize: null,
    iconAnchor: [anchorX, 7],
  });
  const marker = L.marker(latlng, {
    icon,
    draggable: true,
    autoPan: false,
    zIndexOffset: 500,
  }).addTo(map);
  marker.on("mousedown", (e) => L.DomEvent.stopPropagation(e));
  marker.on("dragstart", () => map.dragging.disable());
  marker.on("dragend", () => map.dragging.disable());
  return marker;
}

/* ════════════════════════════════
   HELPER — LABELS VOISINS
════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
   Placement d'étiquette : pôle d'inaccessibilité (polylabel)
   Trouve le point le plus « au large » dans un polygone — celui qui
   maximise la distance au bord. C'est là qu'une étiquette tient sans
   chevaucher la zone d'étude ni sortir du cadre, sans viser le centroïde
   (qui, sur les formes concaves ou en plusieurs morceaux, tombe dehors).
   Portage compact de mapbox/polylabel (coordonnées en degrés, suffisant
   à ces étendues).
──────────────────────────────────────────────────────────── */
function _plSegDistSq(px, py, a, b) {
  let x = a[0],
    y = a[1],
    dx = b[0] - x,
    dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}
// Distance signée d'un point au polygone (positive à l'intérieur).
function _plPointToPolyDist(x, y, polygon) {
  let inside = false;
  let minDistSq = Infinity;
  for (let k = 0; k < polygon.length; k++) {
    const ring = polygon[k];
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a[1] > y !== b[1] > y &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
      minDistSq = Math.min(minDistSq, _plSegDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}
function _plCell(x, y, h, polygon) {
  const d = _plPointToPolyDist(x, y, polygon);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}
function _plCentroidCell(polygon) {
  let area = 0,
    x = 0,
    y = 0;
  const ring = polygon[0];
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const a = ring[i],
      b = ring[j];
    const f = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * f;
    y += (a[1] + b[1]) * f;
    area += f * 3;
  }
  if (area === 0) return _plCell(ring[0][0], ring[0][1], 0, polygon);
  return _plCell(x / area, y / area, 0, polygon);
}
function polylabel(polygon) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const outer = polygon[0];
  for (const p of outer) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const width = maxX - minX,
    height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize === 0) return [minX, minY];
  const precision = cellSize / 100;
  let h = cellSize / 2;

  const queue = [];
  for (let x = minX; x < maxX; x += cellSize)
    for (let y = minY; y < maxY; y += cellSize)
      queue.push(_plCell(x + h, y + h, h, polygon));

  let best = _plCentroidCell(polygon);
  const bboxCell = _plCell(minX + width / 2, minY + height / 2, 0, polygon);
  if (bboxCell.d > best.d) best = bboxCell;

  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++)
      if (queue[i].max > queue[bi].max) bi = i;
    const cell = queue.splice(bi, 1)[0];
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    h = cell.h / 2;
    queue.push(_plCell(cell.x - h, cell.y - h, h, polygon));
    queue.push(_plCell(cell.x + h, cell.y - h, h, polygon));
    queue.push(_plCell(cell.x - h, cell.y + h, h, polygon));
    queue.push(_plCell(cell.x + h, cell.y + h, h, polygon));
  }
  return [best.x, best.y];
}
// Aire (valeur absolue, shoelace) de l'anneau extérieur.
function _ringAreaAbs(ring) {
  let a = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
// Coordonnées du plus grand polygone d'une entité (Polygon ou MultiPolygon).
function largestPolygonCoords(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Polygon") return g.coordinates;
  if (g.type === "MultiPolygon") {
    let best = null,
      bestA = -1;
    for (const poly of g.coordinates) {
      const a = _ringAreaAbs(poly[0]);
      if (a > bestA) {
        bestA = a;
        best = poly;
      }
    }
    return best;
  }
  return null;
}

// Fond gris des voisins (ordre z : à dessiner AVANT la donnée/le raster).
function drawNeighborFill(neighbors, neighborStyle) {
  const style = neighborStyle || {
    color: "#777879",
    fillColor: "#ffffff",
    fillOpacity: 0.7,
    weight: 2,
  };
  L.geoJSON(neighbors, { style, interactive: false }).addTo(map);
}

// Placement des étiquettes des voisins. À appeler IMPÉRATIVEMENT après le
// fitBounds : la projection en pixels n'est correcte qu'une fois la vue posée
// (sinon, à la 1re génération, les étiquettes tombent à côté ou hors cadre).
function placeNeighborLabels(neighbors, targetFeature) {
  const labeledNeighbors = new Set();

  neighbors.forEach((feature) => {
    if (!feature.properties?.CCRCA) return;
    if (labeledNeighbors.has(feature.properties.CCRCA)) return;
    labeledNeighbors.add(feature.properties.CCRCA);

    {
      try {
        const mapBounds = map.getBounds();
        const w = mapBounds.getWest(),
          s = mapBounds.getSouth(),
          e = mapBounds.getEast(),
          n = mapBounds.getNorth();
        // Léger retrait (2 %) pour éviter de coller pile au bord ; le
        // recadrage en pixels plus bas garantit le maintien dans le cadre.
        const mx = (e - w) * 0.02,
          my = (n - s) * 0.02;
        const frame = turf.bboxPolygon([w + mx, s + my, e - mx, n - my]);

        // 1) Partie du voisin visible dans le cadre.
        let visiblePart;
        try {
          visiblePart = turf.intersect(feature, frame);
        } catch (err) {
          visiblePart = null;
        }
        if (!visiblePart) visiblePart = feature;

        // 2) On retranche la zone d'étude : l'étiquette ne tombe jamais dessus.
        let labelZone;
        try {
          labelZone = turf.difference(visiblePart, targetFeature);
        } catch (err) {
          labelZone = visiblePart;
        }
        if (!labelZone) labelZone = visiblePart;

        // 3) Plus grand morceau libre + pôle d'inaccessibilité : le point le
        //    plus au large, là où il y a vraiment de la place.
        let finalLatLng;
        const coords = largestPolygonCoords(labelZone);
        if (coords) {
          const [lng, lat] = polylabel(coords);
          finalLatLng = [lat, lng];
        } else {
          const c = turf.centroid(labelZone).geometry.coordinates;
          finalLatLng = [c[1], c[0]];
        }

        const cvs = document.createElement("canvas");
        const ctx = cvs.getContext("2d");
        ctx.font = "500 10px DM Sans";
        const textWidth = ctx.measureText(
          feature.properties.CCRCA.toUpperCase(),
        ).width;

        // Recadrage EN PIXELS : on s'assure que toute la boîte de texte tient
        // dans le cadre, et on étire le texte vers l'intérieur (pas vers le
        // bord). C'est ce qui empêche les étiquettes de sortir de la marge.
        const size = map.getSize();
        const mPx = 6; // marge intérieure en pixels
        const hPx = 7; // demi-hauteur du texte (~14 px)
        const px = map.latLngToContainerPoint(finalLatLng);

        // Le texte part vers la gauche s'il est dans la moitié droite du cadre.
        const extendLeft = px.x > size.x / 2;
        const anchorX = extendLeft ? Math.round(textWidth) : 0;

        // Bornes horizontales de la boîte, puis décalage si elle déborde.
        const boxLeft = px.x - (extendLeft ? textWidth : 0);
        const boxRight = px.x + (extendLeft ? 0 : textWidth);
        if (boxLeft < mPx) px.x += mPx - boxLeft;
        else if (boxRight > size.x - mPx) px.x -= boxRight - (size.x - mPx);
        // Bornes verticales.
        px.y = Math.max(mPx + hPx, Math.min(size.y - mPx - hPx, px.y));

        finalLatLng = map.containerPointToLatLng(px);
        createNeighborMarker(finalLatLng, feature.properties.CCRCA, anchorX);
      } catch (e) {
        const c = turf.centroid(feature).geometry.coordinates;
        createNeighborMarker([c[1], c[0]], feature.properties.CCRCA, 0);
      }
    }
  });

  // Astuce « glisser pour ajuster » : une seule fois, si des voisins existent.
  if (neighbors.length) {
    setTimeout(() => {
      const hint = document.getElementById("drag-hint");
      if (hint) {
        hint.style.display = "block";
        hint.offsetHeight;
        hint.style.animation =
          "popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, fadeOut 0.5s ease 4s forwards";
      }
    }, 4000);
  }
}

async function addOceanLayer(url, targetFeature) {
  try {
    const data = await fetchGeo(url);
    if (!data.features?.length) return false;
    const tb = turf.bbox(targetFeature);
    const filtered = data.features.filter((f) => {
      try {
        const fb = turf.bbox(f);
        if (fb[2] < tb[0] || fb[0] > tb[2] || fb[3] < tb[1] || fb[1] > tb[3])
          return false;
        return turf.booleanIntersects(f, targetFeature);
      } catch (e) {
        return false;
      }
    });
    if (!filtered.length) return false;
    L.geoJSON(
      { type: "FeatureCollection", features: filtered },
      {
        style: {
          color: "#a8c8d8",
          fillColor: "#c8dfe8",
          fillOpacity: 0.6,
          weight: 0.5,
        },
        interactive: false,
      },
    ).addTo(map);
    return true;
  } catch (e) {
    console.error("addOceanLayer error:", e);
    return false;
  }
}

/* ════════════════════════════════
   CARTES DE LOCALISATION (PANNEAU)
════════════════════════════════ */

function buildLocatorMap(targetFeature, userColor, level = "commune") {
  if (locatorMap) {
    locatorMap.remove();
    locatorMap = null;
  }
  locatorMap = L.map("locator-map", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    // Zoom par quarts (11.25, 11.5, 11.75…), arrondi vers le bas : la zone
    // remplit le carton sans déborder ni masquer le bas de la carte.
    zoomSnap: 0.25,
  });
  const dept = targetFeature.properties.DEPT;
  const reg = targetFeature.properties.REG;

  fetchGeo("data/departements.geojson")
    .then((data) => {
      if (level === "dept") {
        // Département situé dans sa région : on montre les départements de la
        // région, le département cible en couleur, cadré sur la région.
        const deptSet = new Set(deptsOfRegion(reg));
        const regionDepts = data.features.filter((f) =>
          deptSet.has(f.properties.DEPT),
        );
        const others = regionDepts.filter((f) => f.properties.DEPT !== dept);
        L.geoJSON(
          { type: "FeatureCollection", features: others },
          {
            style: {
              color: "#bdc3c7",
              fillColor: "#bdc3c7",
              fillOpacity: 0.5,
              weight: 0.4,
            },
            interactive: false,
          },
        ).addTo(locatorMap);
        L.geoJSON(targetFeature, {
          style: {
            color: "transparent",
            fillColor: userColor,
            fillOpacity: 0.95,
            weight: 0,
          },
          interactive: false,
        }).addTo(locatorMap);
        const ctx = regionDepts.length ? regionDepts : data.features;
        locatorMap.fitBounds(
          L.geoJSON({ type: "FeatureCollection", features: ctx }).getBounds(),
          { padding: [0, 0], animate: false },
        );
        return;
      }

      // Niveau commune : commune située dans son département.
      const targetDept = data.features.find((f) => f.properties.DEPT === dept);
      const otherDepts = data.features.filter(
        (f) => f.properties.DEPT !== dept,
      );
      L.geoJSON(
        { type: "FeatureCollection", features: otherDepts },
        {
          style: {
            color: "#bdc3c7",
            fillColor: "#bdc3c7",
            fillOpacity: 0.5,
            weight: 0.3,
          },
          interactive: false,
        },
      ).addTo(locatorMap);
      if (targetDept) {
        L.geoJSON(targetDept, {
          style: {
            color: "#e74c3c",
            fillColor: "#e74c3c",
            fillOpacity: 0.7,
            weight: 0.5,
          },
          interactive: false,
        }).addTo(locatorMap);
      }
      L.geoJSON(targetFeature, {
        style: {
          color: "transparent",
          fillColor: userColor,
          fillOpacity: 0.95,
          weight: 0,
        },
        interactive: false,
      }).addTo(locatorMap);
      const bounds = targetDept
        ? L.geoJSON(targetDept).getBounds()
        : L.geoJSON({
            type: "FeatureCollection",
            features: data.features,
          }).getBounds();
      locatorMap.fitBounds(bounds, { padding: [0, 0], animate: false });
    })
    .catch((e) => console.error("buildLocatorMap error:", e));
}

function buildRegionMap(targetFeature, userColor) {
  if (regionMap) {
    regionMap.remove();
    regionMap = null;
  }
  regionMap = L.map("region-map", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    // Zoom par quarts (11.25, 11.5…), arrondi vers le bas : pas de débordement.
    zoomSnap: 0.25,
  });
  const reg = targetFeature.properties.REG;
  fetchGeo("data/regions.geojson")
    .then((data) => {
      const targetReg = data.features.find((f) => f.properties.REG === reg);
      const otherRegs = data.features.filter((f) => f.properties.REG !== reg);
      L.geoJSON(
        { type: "FeatureCollection", features: otherRegs },
        {
          style: {
            color: "#bdc3c7",
            fillColor: "#bdc3c7",
            fillOpacity: 0.5,
            weight: 0.3,
          },
          interactive: false,
        },
      ).addTo(regionMap);
      if (targetReg) {
        L.geoJSON(targetReg, {
          style: {
            color: "#e74c3c",
            fillColor: "#e74c3c",
            fillOpacity: 0.7,
            weight: 0.5,
          },
          interactive: false,
        }).addTo(regionMap);
      }
      L.geoJSON(targetFeature, {
        style: {
          color: "transparent",
          fillColor: userColor,
          fillOpacity: 0.95,
          weight: 0,
        },
        interactive: false,
      }).addTo(regionMap);
      const bounds = L.geoJSON({
        type: "FeatureCollection",
        features: data.features,
      }).getBounds();
      regionMap.fitBounds(bounds, { padding: [0, 0], animate: false });
    })
    .catch((e) => console.error("buildRegionMap error:", e));
}

/* ════════════════════════════════
   CONTRÔLES COMMUNS
════════════════════════════════ */

function addMapControls() {
  mapControls.scale = L.control
    .scale({ imperial: false, position: "bottomleft" })
    .addTo(map);
  mapControls.north = L.control({ position: "topright" });
  mapControls.north.onAdd = () => {
    const div = L.DomUtil.create("div", "north-arrow-img");
    div.innerHTML = `<img src="assets/north.svg" width="40px">`;
    return div;
  };
  mapControls.north.addTo(map);
}

/* ════════════════════════════════
   NAVIGATION
════════════════════════════════ */

function goToStep(n) {
  document
    .querySelectorAll(".step")
    .forEach((s) => s.classList.remove("active"));
  const id = n === "loading" ? "step-loading" : `step-${n}`;
  document.getElementById(id)?.classList.add("active");
}

function showError(msg) {
  const el = document.getElementById("error-toast");
  if (!el) return;
  el.innerText = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 4000);
}

/* ════════════════════════════════
   GÉNÉRATION — POINT D'ENTRÉE
════════════════════════════════ */
async function ensureCommunesLoaded() {
  if (geoData.communes) return;
  geoData.communes = await fetchGeo("data/communes.geojson");
}

/* ── Animation de l'écran « Génération en cours » ──
   Étapes qui avancent avec coche, messages rotatifs, barre réarmée à
   chaque génération. Tout est arrêté dès que la carte s'affiche. */
let loadingTickers = [];
const LOADING_TIPS = [
  "Les contours des 557 communes du Sénégal sont issus des données officielles de la DTGC.",
  "Votre carte est générée gratuitement : vous ne payez que pour télécharger la version HD sans filigrane.",
  "Astuce : sur la carte, vous pourrez déplacer les noms des zones voisines pour ajuster la mise en page.",
  "Les routes, cours d'eau et localités sont découpés précisément à l'emprise de votre zone.",
  "L'export final est en haute résolution, prêt pour un mémoire, un rapport ou une impression.",
  "Le paiement se fait par mobile money : Wave, Orange Money ou MaxIt.",
];
function startLoadingTicker() {
  stopLoadingTicker();

  // Réarme la barre de progression (sinon elle reste pleine au 2e passage).
  const bar = document.getElementById("loading-bar");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetHeight; // force le reflow
    bar.style.animation = "";
  }

  // Étapes : avancent l'une après l'autre, les précédentes sont cochées.
  const stepEls = ["ls1", "ls2", "ls3"].map((id) =>
    document.getElementById(id),
  );
  stepEls.forEach((el) => el && el.classList.remove("active", "done"));
  stepEls.forEach((el, i) => {
    loadingTickers.push(
      setTimeout(() => {
        stepEls.forEach((e, j) => {
          if (!e) return;
          e.classList.toggle("done", j < i);
          e.classList.toggle("active", j === i);
        });
      }, i * 1200),
    );
  });

  // Messages rotatifs (fondu toutes les 4 s).
  const tip = document.getElementById("loading-tip");
  if (tip) {
    let ti = Math.floor(Math.random() * LOADING_TIPS.length);
    const show = () => {
      tip.classList.remove("show");
      loadingTickers.push(
        setTimeout(() => {
          tip.innerText = LOADING_TIPS[ti % LOADING_TIPS.length];
          ti++;
          tip.classList.add("show");
        }, 350),
      );
    };
    show();
    loadingTickers.push(setInterval(show, 4000));
  }
}
function stopLoadingTicker() {
  loadingTickers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  loadingTickers = [];
}

async function generateFinalMap() {
  const comName = document.getElementById("select-commune").value;
  const userColor = document.getElementById("color-picker")?.value || "#7BA05B";
  const author = document.getElementById("author-name")?.value || "Sutura Maps";
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;

  // Niveau choisi (commune, département, région ou zone éco).
  const level = selectedLevel;
  const zoneName =
    level === "region" ? reg : level === "dept" ? dept : comName;

  goToStep("loading");
  document.getElementById("loading-commune").innerText = (
    zoneName || ""
  ).toUpperCase();

  startLoadingTicker();

  // Les données chargent PENDANT l'animation (déjà préchargées à l'étape 2
  // dans la plupart des cas). On attend le vrai chargement, pas un délai fixe,
  // avec un minimum de 1,2 s pour que l'animation ne flashe pas.
  prefetchGeoData();
  const minAnim = new Promise((r) => setTimeout(r, 1200));
  try {
    await Promise.all([ensureCommunesLoaded(), minAnim]);
  } catch (e) {
    stopLoadingTicker();
    showError("Impossible de charger les données géographiques.");
    goToStep(2);
    return;
  }

  stopLoadingTicker();
  goToStep(3);

  setTimeout(async () => {
    await new Promise((r) => setTimeout(r, 200));
    map.invalidateSize();
    map.eachLayer((layer) => map.removeLayer(layer));
    if (mapControls.scale) map.removeControl(mapControls.scale);
    if (mapControls.north) map.removeControl(mapControls.north);

    // Construction de la zone selon le niveau.
    let targetFeature;
    if (level === "commune") {
      targetFeature = geoData.communes.features.find(
        (f) =>
          f.properties.CCRCA === comName &&
          f.properties.DEPT === dept &&
          f.properties.REG === reg,
      );
    } else {
      targetFeature = await buildMergedFeature(level, dept, reg);
    }

    if (!targetFeature) {
      showError("Zone introuvable. Veuillez réessayer.");
      goToStep(2);
      return;
    }

    track("generation", zoneName);

    if (selectedMapType === "localisation") {
      await generateLocalisationMap(
        targetFeature,
        userColor,
        zoneName,
        author,
        "DTGC",
        level,
      );
    } else if (selectedMapType === "relief") {
      await generateReliefMap(targetFeature, zoneName, author, level);
    } else {
      await generateOccupationMap(
        targetFeature,
        zoneName,
        author,
        "ANAT, CSE, ANSD (2020)",
        level,
      );
    }

    // Le bouton affiche le prix réel du niveau/type choisi.
    const exportBtn = document.querySelector(".btn-export");
    if (exportBtn) {
      const p = fmtPrice(priceForClient(selectedMapType, level));
      exportBtn.innerText = `PAYEZ ${p} ET TÉLÉCHARGEZ`;
    }
  }, 600);
}

/* ════════════════════════════════
   HELPER — FUSION EN UN POLYGONE
════════════════════════════════ */

async function buildMergedFeature(level, dept, reg) {
  if (level === "dept") {
    try {
      const data = await fetchGeo("data/departements.geojson");
      const feat = data.features.find((f) => f.properties.DEPT === dept);
      if (feat) {
        feat.properties.REG = reg;
        feat.properties.LEVEL = "dept";
        return feat;
      }
    } catch (e) {
      /* fallback */
    }
    return mergeFeatures(
      geoData.communes.features.filter(
        (f) => f.properties.DEPT === dept && f.properties.REG === reg,
      ),
      { DEPT: dept, REG: reg, LEVEL: "dept" },
    );
  }
  if (level === "region") {
    try {
      const data = await fetchGeo("data/regions.geojson");
      const feat = data.features.find((f) => f.properties.REG === reg);
      if (feat) {
        feat.properties.LEVEL = "region";
        return feat;
      }
    } catch (e) {
      /* fallback */
    }
    return mergeFeatures(
      geoData.communes.features.filter((f) => f.properties.REG === reg),
      { REG: reg, LEVEL: "region" },
    );
  }
  return null;
}

function mergeFeatures(features, props) {
  if (!features || features.length === 0) return null;
  let merged = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const u = turf.union(merged, features[i]);
      if (u) merged = u;
    } catch (e) {
      /* ignorer */
    }
  }
  merged.properties = { ...(merged.properties || {}), ...props };
  return merged;
}

/* ════════════════════════════════
   CARTE DE LOCALISATION
════════════════════════════════ */

// ── Helpers niveau (dept / région) ───────────────────────────────
async function fetchJSON(url) {
  try {
    return await fetchGeo(url);
  } catch (e) {
    return null;
  }
}

// Polygone simplifié, utilisé seulement pour les tests de filtrage (pas pour
// l'affichage). Indispensable aux niveaux dept/région : sans ça, tester routes
// et cours d'eau contre un polygone très détaillé gèle la page.
function simplifyForFilter(feature) {
  try {
    return turf.simplify(feature, {
      tolerance: 0.003,
      highQuality: false,
      mutate: false,
    });
  } catch (e) {
    return feature;
  }
}

// Départements d'une région, déduits des communes (mapping fiable).
function deptsOfRegion(reg) {
  if (!geoData.communes) return [];
  return [
    ...new Set(
      geoData.communes.features
        .filter((f) => f.properties.REG === reg)
        .map((f) => f.properties.DEPT),
    ),
  ];
}

// Cas où le chef-lieu de département ne porte pas le nom du département.
const DEPT_CHEF_OVERRIDES = {
  // La localité chef-lieu s'appelle "Dakar Plateau" (Capital of CA).
  DAKAR: "Dakar Plateau",
  // Deux "Keur Massar" : on garde le Capital of CA (géré par le dédoublonnage).
  "KEUR MASSAR": "Keur Massar",
  // Le département s'écrit MALEM HODDAR, la localité "Maleme Hoddar".
  "MALEM HODDAR": "Maleme Hoddar",
};

// Normalisation pour comparer des noms (sans accents, sans ponctuation).
function normNom(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Noms (normalisés) des chefs-lieux de département d'une région : le nom du
// département, ou un nom dédié pour les cas particuliers.
function regionChefLieuNames(reg) {
  const set = new Set();
  deptsOfRegion(reg).forEach((d) => {
    set.add(normNom(DEPT_CHEF_OVERRIDES[d] || d));
  });
  return set;
}

// Trace les subdivisions internes (traits fins, sans remplissage).
function drawInternalBoundaries(features) {
  if (!features || !features.length) return;
  L.geoJSON(
    { type: "FeatureCollection", features },
    {
      style: {
        color: "#000000",
        weight: 1,
        opacity: 1,
        dashArray: "4 3",
        fill: false,
      },
      interactive: false,
    },
  ).addTo(map);
}

function setLimitropheLabel(text) {
  const el = document.getElementById("legend-limitrophe-label");
  if (el) el.innerText = text;
}

function showInternalLegend(text) {
  const item = document.getElementById("legend-internal");
  const label = document.getElementById("legend-internal-label");
  if (item) item.style.display = "flex";
  if (label) label.innerText = text;
}

async function generateLocalisationMap(
  targetFeature,
  userColor,
  zoneName,
  author,
  source = "DTGC",
  level = "commune",
) {
  restoreLocalisationLegend();

  // La pastille « Zone d'étude » prend la couleur choisie par l'utilisateur.
  const cs = document.getElementById("legend-commune-swatch");
  if (cs) {
    cs.style.background = userColor;
    cs.style.borderColor = userColor;
  }

  const reg = targetFeature.properties.REG;
  const dept = targetFeature.properties.DEPT;

  // Polygone allégé pour tous les tests de filtrage (routes, eau, points,
  // voisins). En commune on garde le détail ; en dept/région on simplifie pour
  // éviter le gel de la page.
  const filterFeature =
    level === "commune" ? targetFeature : simplifyForFilter(targetFeature);

  // ── Voisins (limitrophes) selon le niveau ──
  let neighbors = [];
  if (level === "commune") {
    neighbors = geoData.communes.features.filter((f) => {
      if (f.properties.CCRCA === zoneName) return false;
      try {
        return turf.booleanIntersects(targetFeature, f);
      } catch (e) {
        return false;
      }
    });
    setLimitropheLabel("Communes limitrophes");
  } else if (level === "dept") {
    const data = await fetchJSON("data/departements.geojson");
    neighbors = (data?.features || [])
      .filter((f) => f.properties.DEPT !== dept)
      .filter((f) => {
        try {
          return turf.booleanIntersects(filterFeature, f);
        } catch (e) {
          return false;
        }
      })
      .map((f) => ({
        ...f,
        properties: { ...f.properties, CCRCA: f.properties.DEPT },
      }));
    setLimitropheLabel("Départements limitrophes");
  } else if (level === "region") {
    const data = await fetchJSON("data/regions.geojson");
    neighbors = (data?.features || [])
      .filter((f) => f.properties.REG !== reg)
      .filter((f) => {
        try {
          return turf.booleanIntersects(filterFeature, f);
        } catch (e) {
          return false;
        }
      })
      .map((f) => ({
        ...f,
        properties: { ...f.properties, CCRCA: f.properties.REG },
      }));
    setLimitropheLabel("Régions limitrophes");
  }
  // Fond des voisins maintenant ; étiquettes après le fitBounds (projection).
  if (neighbors.length) drawNeighborFill(neighbors);

  const hasOcean = await addOceanLayer("data/ocean.geojson", filterFeature);
  const elOC = document.getElementById("legend-ocean");
  if (elOC) elOC.style.display = hasOcean ? "flex" : "none";

  // ── Zone d'étude ──
  const studyAreaLayer = L.geoJSON(targetFeature, {
    style: {
      color: userColor,
      fillColor: userColor,
      fillOpacity: 0.5,
      weight: 4,
    },
  }).addTo(map);

  // ── Limites internes (subdivisions) ──
  if (level === "dept") {
    drawInternalBoundaries(
      geoData.communes.features.filter(
        (f) => f.properties.DEPT === dept && f.properties.REG === reg,
      ),
    );
    showInternalLegend("Limites des communes");
  } else if (level === "region") {
    const data = await fetchJSON("data/departements.geojson");
    const deptSet = new Set(deptsOfRegion(reg));
    drawInternalBoundaries(
      (data?.features || []).filter((f) => deptSet.has(f.properties.DEPT)),
    );
    showInternalLegend("Limites des départements");
  }

  // ── Hydrographie + routes ──
  const hasCours = await addLayer(
    "data/cours_eau.geojson",
    { color: "#3498db", weight: 2, opacity: 0.6 },
    filterFeature,
  );
  const hasRoutes = await addLayer(
    "data/routes.geojson",
    { color: "#e74c3c", weight: 1.5, opacity: 0.8 },
    filterFeature,
  );
  const elCE = document.getElementById("legend-cours-eau");
  const elRO = document.getElementById("legend-routes");
  if (elCE) elCE.style.display = hasCours ? "flex" : "none";
  if (elRO) elRO.style.display = hasRoutes ? "flex" : "none";

  // ── Points selon le niveau ──
  // Polygone complet (pas le simplifié) : la simplification pouvait raboter des
  // pointes (ex. Dakar Plateau) et écarter un point pourtant à l'intérieur.
  const pointNames = level === "region" ? regionChefLieuNames(reg) : null;
  await addPoints("data/localites.geojson", targetFeature, level, pointNames);

  map.fitBounds(studyAreaLayer.getBounds(), {
    padding: [10, 35, 60, 35],
    animate: false,
  });
  addGraticule(map);
  addMapControls();
  if (neighbors.length) placeNeighborLabels(neighbors, filterFeature);

  // ── Titre, auteur, source ──
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText =
    new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const dsEl = document.getElementById("data-source");
  if (dsEl) dsEl.innerText = source;

  const locatorCard = document.getElementById("locator-card");
  const regionCard = document.getElementById("region-card");

  if (level === "commune") {
    document.getElementById("display-commune").innerText =
      `LOCALISATION DE LA COMMUNE DE ${zoneName.toUpperCase()}`;
    document.querySelector("#locator-card .panel-card-header").innerText =
      `DÉPARTEMENT ${dept || ""}`;
    document.getElementById("region-card-header").innerText =
      `RÉGION ${reg || ""} AU SÉNÉGAL`;
    locatorCard.style.display = "flex";
    regionCard.style.display = "flex";
    buildLocatorMap(targetFeature, userColor, "commune");
    buildRegionMap(targetFeature, userColor);
  } else if (level === "dept") {
    document.getElementById("display-commune").innerText =
      `LOCALISATION DU DÉPARTEMENT DE ${zoneName.toUpperCase()}`;
    document.querySelector("#locator-card .panel-card-header").innerText =
      `RÉGION ${reg || ""}`;
    document.getElementById("region-card-header").innerText =
      `RÉGION ${reg || ""} AU SÉNÉGAL`;
    locatorCard.style.display = "flex";
    regionCard.style.display = "flex";
    buildLocatorMap(targetFeature, userColor, "dept");
    buildRegionMap(targetFeature, userColor);
  } else {
    document.getElementById("display-commune").innerText =
      `LOCALISATION DE LA RÉGION DE ${zoneName.toUpperCase()}`;
    locatorCard.style.display = "none";
    regionCard.style.display = "flex";
    document.getElementById("region-card-header").innerText = "SÉNÉGAL";
    buildRegionMap(targetFeature, userColor);
  }

  addLiveWatermark();
}

/* ════════════════════════════════
   CARTE D'OCCUPATION DU SOL
════════════════════════════════ */

// Renvoie les entités limitrophes (communes, départements ou régions) qui
// touchent la zone d'étude, selon le niveau. Le nom voisin est normalisé dans
// la propriété CCRCA pour qu'addNeighborLabels l'affiche de façon uniforme.
async function computeNeighbors(targetFeature, zoneName, level) {
  if (level === "commune") {
    return geoData.communes.features.filter((f) => {
      if (f.properties.CCRCA === zoneName) return false;
      try {
        return turf.booleanIntersects(targetFeature, f);
      } catch (e) {
        return false;
      }
    });
  }
  if (level === "dept") {
    try {
      const data = await fetchGeo("data/departements.geojson");
      return data.features
        .filter((f) => {
          if (f.properties.DEPT === targetFeature.properties.DEPT) return false;
          try {
            return turf.booleanIntersects(targetFeature, f);
          } catch (e) {
            return false;
          }
        })
        .map((f) => ({
          ...f,
          properties: { ...f.properties, CCRCA: f.properties.DEPT },
        }));
    } catch (e) {
      return [];
    }
  }
  if (level === "region") {
    try {
      const data = await fetchGeo("data/regions.geojson");
      return data.features
        .filter((f) => {
          if (f.properties.REG === targetFeature.properties.REG) return false;
          try {
            return turf.booleanIntersects(targetFeature, f);
          } catch (e) {
            return false;
          }
        })
        .map((f) => ({
          ...f,
          properties: { ...f.properties, CCRCA: f.properties.REG },
        }));
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function generateOccupationMap(
  targetFeature,
  zoneName,
  author,
  source,
  level,
) {
  const clipped = occupationClipped;
  if (!clipped || clipped.length === 0) {
    showError("Aucune donnée d'occupation du sol pour cette zone.");
    return;
  }

  // Palette finale (couleurs choisies par l'utilisateur en step 2)
  const PALETTE = {};
  clipped.forEach((f) => {
    const nom = (f.properties.NOM || "").trim();
    if (nom)
      PALETTE[nom] =
        occupationPalette[nom] ||
        f.properties.couleur ||
        PALETTE_DEFAULT[nom] ||
        "#cccccc";
  });

  // Voisins (limitrophes) selon le niveau — fond dessiné maintenant (sous la
  // donnée), étiquettes placées plus bas, APRÈS le fitBounds.
  const neighborStyle = {
    color: "#aaa",
    fillColor: "#e0e0e0",
    fillOpacity: 0.4,
    weight: 1,
  };
  const neighborFeatures = await computeNeighbors(targetFeature, zoneName, level);
  if (neighborFeatures.length > 0) drawNeighborFill(neighborFeatures, neighborStyle);

  // Couche occupation
  L.geoJSON(
    { type: "FeatureCollection", features: clipped },
    {
      style: (feature) => {
        const nom = (feature.properties.NOM || "").trim();
        return {
          color: "#fff",
          weight: 0.1,
          fillColor: PALETTE[nom] || "#cccccc",
          fillOpacity: 1,
        };
      },
      interactive: false,
    },
  ).addTo(map);

  // Contour zone d'étude
  const studyAreaLayer = L.geoJSON(targetFeature, {
    style: { color: "#2c3e50", fillColor: "transparent", weight: 3 },
  }).addTo(map);

  // Légende
  const classesPresentes = [
    ...new Set(
      clipped.map((f) => (f.properties.NOM || "").trim()).filter(Boolean),
    ),
  ].sort();
  buildOccupationLegend(classesPresentes, PALETTE);

  // Cadrage + contrôles
  map.fitBounds(studyAreaLayer.getBounds(), {
    padding: [10, 35, 60, 35],
    animate: false,
  });
  addGraticule(map);
  addMapControls();
  if (neighborFeatures.length > 0)
    placeNeighborLabels(neighborFeatures, targetFeature);

  // Panneau — masquer les cartons de localisation
  document.getElementById("locator-card").style.display = "none";
  document.getElementById("region-card").style.display = "none";

  const levelLabel =
    level === "region"
      ? "RÉGION"
      : level === "dept"
        ? "DÉPARTEMENT"
        : "COMMUNE";
  document.getElementById("display-commune").innerText =
    `OCCUPATION DU SOL — ${levelLabel} DE ${zoneName.toUpperCase()}`;
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText =
    new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("data-source").innerText = source;

  addLiveWatermark();
}

/* ════════════════════════════════
   CARTE DE RELIEF (MNT — hypsométrie)
   Tuiles d'élévation Terrarium 
   teinte hypsométrique sur la plage d'altitude
════════════════════════════════ */

const MNT_TILE = 256;

// Palette hypsométrique DISCRÈTE à 5 classes (du plus bas au plus haut).
const MNT_COLORS = [
  [60, 140, 80], // vert (bas)
  [170, 195, 100], // vert-jaune
  [225, 200, 110], // jaune-ocre
  [180, 120, 70], // brun
  [240, 235, 225], // pâle (haut)
];
// Couleur dédiée aux zones sous le niveau de la mer (< 0 m).
const MNT_NEG_COLOR = [80, 140, 170]; // bleu-gris

// Arrondit un pas brut au multiple de 5 supérieur (minimum 5 m).
function mntNiceStep(rawStep) {
  return Math.max(5, Math.ceil(rawStep / 5) * 5);
}

// Construit le découpage en 5 classes selon la dénivelée.
//  - Si l'altitude descend sous -1 m, la 1re classe est « < 0 » et les
//    4 autres couvrent [0, emax].
//  - Sinon, 5 classes régulières couvrant [emin, emax].
// Retourne { classOf(e)->0..4, colors[5], labels[5] } (ordre bas → haut).
function mntBuildClasses(emin, emax) {
  const hasNeg = emin < -1;

  if (hasNeg) {
    const step = mntNiceStep(Math.max(emax, 1) / 4);
    const labels = [
      "< 0 m",
      `0 – ${step} m`,
      `${step} – ${2 * step} m`,
      `${2 * step} – ${3 * step} m`,
      `> ${3 * step} m`,
    ];
    const colors = [MNT_NEG_COLOR, ...MNT_COLORS.slice(0, 4)];
    const classOf = (e) => {
      if (e < 0) return 0;
      return 1 + Math.min(3, Math.floor(e / step));
    };
    return { classOf, colors, labels };
  }

  const step = mntNiceStep((emax - emin) / 5);
  const base = Math.floor(emin / step) * step;
  const labels = [];
  for (let i = 0; i < 5; i++) {
    const lo = base + i * step;
    labels.push(i < 4 ? `${lo} – ${lo + step} m` : `> ${base + 4 * step} m`);
  }
  const classOf = (e) => Math.max(0, Math.min(4, Math.floor((e - base) / step)));
  return { classOf, colors: MNT_COLORS.slice(), labels };
}
const _m = {
  lon2px: (lon, z) => ((lon + 180) / 360) * MNT_TILE * 2 ** z,
  lat2px: (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return (
      ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) *
      MNT_TILE *
      2 ** z
    );
  },
  px2lon: (x, z) => (x / (MNT_TILE * 2 ** z)) * 360 - 180,
  px2lat: (y, z) => {
    const n = Math.PI - (2 * Math.PI * y) / (MNT_TILE * 2 ** z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  },
};
function mntRingContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
// Masque accéléré : pour chaque polygone, on précalcule sa bbox. Le test par
// pixel rejette d'abord sur la bbox (très rapide) avant le vrai ray-casting.
function buildMntMask(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.map((rings) => {
    const outer = rings[0];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of outer) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return { rings, bbox: [x0, y0, x1, y1] };
  });
}
function mntInside(x, y, mask) {
  for (let m = 0; m < mask.length; m++) {
    const b = mask[m].bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    const rings = mask[m].rings;
    if (mntRingContains([x, y], rings[0])) {
      let hole = false;
      for (let i = 1; i < rings.length; i++)
        if (mntRingContains([x, y], rings[i])) {
          hole = true;
          break;
        }
      if (!hole) return true;
    }
  }
  return false;
}
function mntLoadTile(z, x, y) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  });
}

async function generateReliefMap(targetFeature, zoneName, author, level) {
  const geom = targetFeature.geometry;

  // bbox
  let minLon = 180,
    minLat = 90,
    maxLon = -180,
    maxLat = -90;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  polys.forEach((r) =>
    r.forEach((ring) =>
      ring.forEach(([lo, la]) => {
        if (lo < minLon) minLon = lo;
        if (lo > maxLon) maxLon = lo;
        if (la < minLat) minLat = la;
        if (la > maxLat) maxLat = la;
      }),
    ),
  );

  // Résolution BORNÉE. Un zoom élevé sur une grande zone produit des millions
  // de pixels à masquer → l'onglet plante. On prend le zoom le plus fin dont le
  // raster tient sous MAX_DIM ; si la zone reste énorme, on sous-échantillonne.
  const MAX_DIM = 820;
  let z = 8;
  for (let zz = 8; zz <= 13; zz++) {
    const w = _m.lon2px(maxLon, zz) - _m.lon2px(minLon, zz);
    const h = _m.lat2px(minLat, zz) - _m.lat2px(maxLat, zz);
    if (Math.max(w, h) > MAX_DIM) break;
    z = zz;
  }

  const txMin = Math.floor(_m.lon2px(minLon, z) / MNT_TILE),
    txMax = Math.floor(_m.lon2px(maxLon, z) / MNT_TILE);
  const tyMin = Math.floor(_m.lat2px(maxLat, z) / MNT_TILE),
    tyMax = Math.floor(_m.lat2px(minLat, z) / MNT_TILE);
  const ox = txMin * MNT_TILE,
    oy = tyMin * MNT_TILE;
  const W = (txMax - txMin + 1) * MNT_TILE,
    H = (tyMax - tyMin + 1) * MNT_TILE;

  // Tuiles téléchargées EN PARALLÈLE (bien plus rapide que séquentiel).
  const mos = document.createElement("canvas");
  mos.width = W;
  mos.height = H;
  const mctx = mos.getContext("2d");
  const tileJobs = [];
  for (let tx = txMin; tx <= txMax; tx++)
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const dx = (tx - txMin) * MNT_TILE,
        dy = (ty - tyMin) * MNT_TILE;
      tileJobs.push(
        mntLoadTile(z, tx, ty).then((img) => {
          if (img) mctx.drawImage(img, dx, dy);
        }),
      );
    }
  await Promise.all(tileJobs);

  let id;
  try {
    id = mctx.getImageData(0, 0, W, H);
  } catch (e) {
    showError("Relief indisponible (données d'élévation bloquées).");
    return;
  }
  const d = id.data;

  // Sous-échantillonnage : la grille de sortie est bornée à MAX_DIM par côté.
  const stride = Math.max(1, Math.ceil(Math.max(W, H) / MAX_DIM));
  const OW = Math.ceil(W / stride),
    OH = Math.ceil(H / stride);

  // Masque SIMPLIFIÉ : à la résolution du raster, le contour n'a pas besoin de
  // tous ses sommets. La simplification réduit énormément le coût du test
  // point-dans-polygone (le vrai goulot). Le contour net reste tracé à part
  // avec la géométrie complète (studyAreaLayer, plus bas).
  let maskSrc = targetFeature;
  try {
    const tolDeg = ((maxLon - minLon) / Math.max(W, 1)) * stride * 1.5;
    maskSrc = turf.simplify(targetFeature, {
      tolerance: tolDeg,
      highQuality: false,
      mutate: false,
    });
  } catch (e) {
    maskSrc = targetFeature;
  }
  const mask = buildMntMask(maskSrc.geometry || geom);

  const elev = new Float32Array(OW * OH);
  const inside = new Uint8Array(OW * OH);
  let emin = Infinity,
    emax = -Infinity,
    nIn = 0;
  for (let iy = 0; iy < OH; iy++) {
    const py = iy * stride;
    const lat = _m.px2lat(oy + py + 0.5, z);
    for (let ix = 0; ix < OW; ix++) {
      const px = ix * stride;
      const lon = _m.px2lon(ox + px + 0.5, z);
      if (!mntInside(lon, lat, mask)) continue;
      const p = (py * W + px) * 4;
      const e = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
      const k = iy * OW + ix;
      elev[k] = e;
      inside[k] = 1;
      nIn++;
      if (e < emin) emin = e;
      if (e > emax) emax = e;
    }
    // On rend la main au navigateur toutes les 32 lignes : plus de blocage.
    if ((iy & 31) === 0) await new Promise((r) => setTimeout(r));
  }
  if (!nIn) {
    showError("Aucune donnée de relief pour cette zone.");
    return;
  }

  // Découpage en 5 classes discrètes selon la dénivelée réelle.
  const classes = mntBuildClasses(emin, emax);
  const out = document.createElement("canvas");
  out.width = OW;
  out.height = OH;
  const octx = out.getContext("2d");
  const oid = octx.createImageData(OW, OH);
  const od = oid.data;
  for (let k = 0; k < OW * OH; k++) {
    const p = k * 4;
    if (!inside[k]) {
      od[p + 3] = 0;
      continue;
    }
    const c = classes.colors[classes.classOf(elev[k])];
    od[p] = c[0];
    od[p + 1] = c[1];
    od[p + 2] = c[2];
    od[p + 3] = 255;
  }
  octx.putImageData(oid, 0, 0);

  // Voisins (limitrophes) : fond dessiné SOUS le raster (transparent hors
  // polygone) ; étiquettes placées plus bas, APRÈS le fitBounds.
  const neighborFeatures = await computeNeighbors(targetFeature, zoneName, level);
  if (neighborFeatures.length > 0)
    drawNeighborFill(neighborFeatures, {
      color: "#aaa",
      fillColor: "#e0e0e0",
      fillOpacity: 0.4,
      weight: 1,
    });

  const south = _m.px2lat(oy + H, z),
    north = _m.px2lat(oy, z),
    west = _m.px2lon(ox, z),
    east = _m.px2lon(ox + W, z);
  L.imageOverlay(out.toDataURL(), [
    [south, west],
    [north, east],
  ]).addTo(map);

  const studyAreaLayer = L.geoJSON(targetFeature, {
    style: { color: "#2c3e50", fillColor: "transparent", weight: 3 },
  }).addTo(map);

  map.fitBounds(studyAreaLayer.getBounds(), {
    padding: [10, 35, 60, 35],
    animate: false,
  });
  addGraticule(map);
  addMapControls();
  if (neighborFeatures.length > 0)
    placeNeighborLabels(neighborFeatures, targetFeature);

  buildReliefLegend(classes);

  document.getElementById("locator-card").style.display = "none";
  document.getElementById("region-card").style.display = "none";

  const levelLabel =
    level === "region" ? "RÉGION" : level === "dept" ? "DÉPARTEMENT" : "COMMUNE";
  document.getElementById("display-commune").innerText =
    `RELIEF — ${levelLabel} DE ${zoneName.toUpperCase()}`;
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText =
    new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("data-source").innerText = "SRTM NASA (30 m)";

  addLiveWatermark();
}

function buildReliefLegend(classes) {
  const body = document.querySelector("#legend-card .panel-card-body");
  if (!body) return;
  // Légende verticale : du plus haut (en haut) au plus bas (en bas).
  const rows = classes.colors
    .map((c, i) => ({ c, label: classes.labels[i] }))
    .reverse()
    .map(
      ({ c, label }) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span style="width:18px;height:14px;flex:0 0 auto;
                     background:rgb(${c[0]},${c[1]},${c[2]});
                     border:1px solid rgba(0,0,0,0.2);border-radius:2px;"></span>
        <span style="font-size:0.72rem;color:var(--ink);">${label}</span>
      </div>`,
    )
    .join("");
  body.innerHTML = `
    <p style="font-size:0.68rem;font-weight:600;letter-spacing:1.5px;
              text-transform:uppercase;color:var(--muted);
              margin-bottom:10px;padding-bottom:6px;
              border-bottom:1px solid rgba(14,12,10,0.1);">
      Altitude (mètres)
    </p>
    ${rows}`;
}

/* ════════════════════════════════
   PANNEAU LATÉRAL (localisation)
════════════════════════════════ */

function updateSidePanel(comName, color, author, source) {
  const feat = geoData.communes.features.find(
    (f) => f.properties.CCRCA === comName,
  );
  const dept = feat?.properties.DEPT;
  const reg = feat?.properties.REG;

  document.querySelector("#locator-card .panel-card-header").innerText =
    `DÉPARTEMENT ${dept || ""}`;
  document.getElementById("region-card-header").innerText =
    `RÉGION ${reg || ""} AU SÉNÉGAL`;
  document.getElementById("display-commune").innerText =
    `COMMUNE DE ${comName.toUpperCase()}`;
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText =
    new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("data-source").innerText = source;

  const communeSwatch = document.getElementById("legend-commune-swatch");
  if (communeSwatch) communeSwatch.style.background = color;
  const communeLabel = document.getElementById("legend-commune-label");
  if (communeLabel) communeLabel.innerText = comName;
}

/* ════════════════════════════════
   PAIEMENT
════════════════════════════════ */

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

async function exportToPNG() {
  const commune = document.getElementById("select-commune").value;
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;
  const color = document.getElementById("color-picker")?.value || "#7BA05B";
  const author = document.getElementById("author-name")?.value || "Sutura Maps";
  const mobile = isMobileDevice();

  // Niveau et nom de la zone (commune, département ou région).
  const level = selectedLevel;
  const zoneName =
    level === "region" ? reg : level === "dept" ? dept : commune;

  const btn = document.querySelector(".btn-export");
  const resetBtn = () => {
    btn.disabled = false;
    btn.innerText = "PAYEZ ET TÉLÉCHARGEZ";
  };
  btn.disabled = true;
  btn.innerText = "⏳ Initialisation...";

  try {
    const res = await fetch("/.netlify/functions/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commune: zoneName,
        dept,
        reg,
        color,
        author,
        level,
        maptype: selectedMapType,
        client: mobile ? "mobile" : "desktop",
      }),
    });

    const data = await res.json();

    if (!data.payment_url) {
      showError(data.error || "Erreur initialisation paiement");
      resetBtn();
      return;
    }

    // Paiement initié : commande créée, l'utilisateur part vers Bictorys.
    track("payment_init", zoneName);

    // Contexte pour la reprise et la régénération éventuelle après paiement.
    sessionStorage.setItem("sutura_token", data.token);
    sessionStorage.setItem("sutura_maptype", selectedMapType);
    sessionStorage.setItem("sutura_level", level);
    if (selectedMapType === "occupation") {
      sessionStorage.setItem(
        "sutura_palette",
        JSON.stringify(occupationPalette || {}),
      );
    }
    localStorage.setItem(
      "sutura_pending",
      JSON.stringify({
        token: data.token,
        commune: zoneName,
        dept,
        reg,
        level,
        maptype: selectedMapType,
        palette:
          selectedMapType === "occupation"
            ? occupationPalette || {}
            : undefined,
      }),
    );

    if (mobile) {
      // Mobile : redirection plein écran. Le retour est géré par
      // handleDownloadToken via ?token= dans l'URL.
      window.location.href = data.payment_url;
      return;
    }

    // Ordinateur : on garde la page.
    window.open(data.payment_url, "_blank", "noopener");
    resetBtn();
    startDesktopPaymentWatch(data.token, zoneName);
  } catch (e) {
    console.error("exportToPNG error:", e);
    showError("Erreur réseau. Réessayez.");
    resetBtn();
  }
}

/* ════════════════════════════════
   ATTENTE DE PAIEMENT — ORDINATEUR
════════════════════════════════ */

let paymentWatchTimer = null;

// Prix affiché (le serveur reste la source de vérité). Occupation : paliers.
function priceForClient(maptype, level) {
  if ((maptype === "occupation" || maptype === "relief") && level === "dept")
    return 4000;
  if (
    (maptype === "occupation" || maptype === "relief") &&
    level === "region"
  )
    return 5000;
  return 2000;
}
function fmtPrice(n) {
  return n.toLocaleString("fr-FR") + " FCFA";
}
function zoneLabelFor(level, name) {
  const prefix =
    level === "region"
      ? "Région de "
      : level === "dept"
        ? "Département de "
        : "Commune de ";
  return prefix + (name || "").toUpperCase();
}

function buildPaymentOverlay(commune) {
  const zoneLabel = zoneLabelFor(selectedLevel, commune);
  const priceText = fmtPrice(priceForClient(selectedMapType, selectedLevel));
  const existing = document.getElementById("pay-overlay");
  if (existing) existing.remove();

  const ov = document.createElement("div");
  ov.id = "pay-overlay";
  ov.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(14,12,10,.82);" +
    "display:flex;align-items:center;justify-content:center;padding:20px;";
  ov.innerHTML = `
    <div style="width:460px;max-width:94vw;background:#f7f3ec;border-radius:3px;
                padding:42px 38px 30px;text-align:center;
                box-shadow:0 40px 100px rgba(0,0,0,.55);font-family:'DM Sans',sans-serif;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:0.82rem;font-weight:700;
                  letter-spacing:5px;text-transform:uppercase;color:#b85c2c;margin-bottom:20px;">
        Paiement en cours
      </div>
      <div style="width:60px;height:60px;margin:0 auto 22px;border-radius:50%;
                  border:3px solid #e4ddd1;border-top-color:#b85c2c;border-right-color:#b85c2c;
                  animation:spinRing 0.9s linear infinite;"></div>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:1.9rem;font-weight:700;
                 color:#0e0c0a;margin-bottom:12px;">Payez sur votre téléphone</h2>
      <p style="font-size:0.9rem;font-weight:300;line-height:1.6;color:#7a7068;margin-bottom:18px;">
        Réglez avec <strong style="color:#0e0c0a;font-weight:500;">Wave, Orange ou MaxIt</strong>
        dans l'onglet ouvert. Le téléchargement se lancera
        <strong style="color:#0e0c0a;font-weight:500;">ici, sur cet ordinateur</strong>,
        dès la confirmation.
      </p>
      <div id="pay-status" style="font-size:0.74rem;letter-spacing:1.5px;text-transform:uppercase;
                  color:#b85c2c;font-weight:500;margin-bottom:18px;">Vérification automatique…</div>
      <div style="display:inline-block;background:#0e0c0a;color:#c9a84c;
                  font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-weight:600;
                  letter-spacing:2px;padding:9px 20px;border-radius:2px;margin-bottom:24px;">
        ${zoneLabel} · ${priceText}
      </div>
      <button id="pay-check-now" style="display:block;width:100%;background:#b85c2c;color:#fff;
                  font-family:'DM Sans',sans-serif;font-size:0.82rem;font-weight:500;
                  letter-spacing:1.4px;text-transform:uppercase;padding:14px;border:none;
                  border-radius:1px;cursor:pointer;margin-bottom:14px;">
        J'ai payé — vérifier maintenant
      </button>
      <a id="pay-wa" href="#" style="font-size:0.78rem;color:#7a7068;text-decoration:none;cursor:pointer;">
        Un souci ? <u style="color:#b85c2c;">Écrivez-nous sur WhatsApp</u>
      </a>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(14,12,10,.1);
                  font-size:0.72rem;color:#9a9088;line-height:1.5;">
        Votre carte reste téléchargeable pendant 1&nbsp;heure, même si vous fermez cette page.<br>
        <strong style="color:#b85c2c;font-weight:500;">Satisfait ou remboursé sous 24&nbsp;h</strong>,
        par le même mobile money.
      </div>
      <div style="margin-top:14px;">
        <span id="pay-cancel" style="font-size:0.72rem;color:#9a9088;
                    text-decoration:underline;cursor:pointer;">Fermer</span>
      </div>
    </div>`;
  document.body.appendChild(ov);

  document.getElementById("pay-wa").onclick = (e) => {
    e.preventDefault();
    window.open(
      "https://wa.me/" + ["221", "781", "751", "168"].join(""),
      "_blank",
      "noopener",
    );
  };
  document.getElementById("pay-cancel").onclick = () => {
    clearInterval(paymentWatchTimer);
    ov.remove();
  };
  return ov;
}

async function startDesktopPaymentWatch(token, commune) {
  buildPaymentOverlay(commune);
  const statusEl = () => document.getElementById("pay-status");
  const MAX = 90; // ~6 min à 4 s
  let tries = 0;

  async function checkOnce() {
    try {
      const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
      const d = await res.json();
      if (d.paid) {
        finishDesktopDownload();
        return true;
      }
      if (d.error && statusEl()) statusEl().innerText = d.error;
    } catch (e) {
      /* on réessaiera au prochain tick */
    }
    return false;
  }

  const checkBtn = document.getElementById("pay-check-now");
  if (checkBtn)
    checkBtn.onclick = async () => {
      checkBtn.disabled = true;
      checkBtn.innerText = "Vérification…";
      const ok = await checkOnce();
      if (!ok) {
        checkBtn.disabled = false;
        checkBtn.innerText = "J'ai payé — vérifier maintenant";
      }
    };

  clearInterval(paymentWatchTimer);
  paymentWatchTimer = setInterval(async () => {
    tries++;
    if (statusEl())
      statusEl().innerText = `Vérification automatique… (${tries}/${MAX})`;
    const ok = await checkOnce();
    if (ok || tries >= MAX) {
      clearInterval(paymentWatchTimer);
      if (!ok && statusEl())
        statusEl().innerText =
          "Paiement non encore confirmé. Cliquez sur « vérifier ».";
    }
  }, 4000);
}

function finishDesktopDownload() {
  clearInterval(paymentWatchTimer);
  const ov = document.getElementById("pay-overlay");
  if (ov) ov.remove();
  localStorage.removeItem("sutura_pending");
  doExport(false);
}

/* Deretour (ordinateur) : ne pas re-teeelech ici. */
function showPaymentDoneInTab(token) {
  const dlUrl = `${window.location.origin}/map.html?token=${token}`;
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:1.1rem;
                text-align:center;padding:2rem;font-family:'DM Sans',sans-serif;
                background:#f7f3ec;color:#0e0c0a;">
      <div style="font-size:3rem">✅</div>
      <p style="font-family:'Cormorant Garamond',serif;font-size:1.9rem;font-weight:700;">
        Paiement confirmé
      </p>
      <p style="font-size:0.9rem;color:#7a7068;max-width:380px;line-height:1.6;">
        Votre téléchargement se lance dans l'onglet
        <strong style="color:#0e0c0a;">Sutura Maps</strong> resté ouvert.
      </p>
      <p style="font-size:0.82rem;color:#7a7068;max-width:380px;line-height:1.6;margin-top:0.4rem;">
        Il ne s'est pas lancé, ou vous avez fermé l'onglet ?
      </p>
      <a href="${dlUrl}"
         style="display:inline-block;background:#b85c2c;color:#fff;
                padding:14px 30px;font-size:0.82rem;font-weight:500;
                letter-spacing:1.5px;text-transform:uppercase;
                text-decoration:none;border-radius:2px;">
        Télécharger ma carte
      </a>
      <p style="font-size:0.72rem;color:#9a9088;max-width:380px;line-height:1.6;">
        Ce lien fonctionne sur ordinateur comme sur téléphone, et reste
        valable 1&nbsp;heure, même si la carte a déjà été téléchargée.
      </p>
    </div>`;
}

async function resumePendingDownload() {
  const pending = localStorage.getItem("sutura_pending");
  if (!pending) return;
  let token;
  try {
    token = JSON.parse(pending).token;
  } catch (e) {
    return;
  }
  if (!token) return;

  try {
    const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
    const d = await res.json();
    if (d.paid) {
      handleDownloadToken(token);
    } else if (d.error) {
      localStorage.removeItem("sutura_pending");
    }
  } catch (e) {
    /* silencieux */
  }
}

async function handleDownloadToken(token) {
  // Masquer les steps
  document
    .querySelectorAll(".step")
    .forEach((s) => s.classList.remove("active"));

  // Afficher écran d'attente
  const main = document.querySelector("main");
  const waitDiv = document.createElement("div");
  waitDiv.id = "dl-wait";
  waitDiv.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    justify-content:center;min-height:60vh;gap:1.5rem;text-align:center;padding:2rem;
  `;
  waitDiv.innerHTML = `
    <div style="font-size:3rem">🗺️</div>
    <p style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:600;color:var(--ink);">
      Vérification du paiement…
    </p>
    <p style="font-size:0.82rem;color:var(--muted);">Préparation de votre carte en cours.</p>
    <div id="dl-status" style="font-size:0.78rem;color:var(--terra);font-weight:500;letter-spacing:1px;"></div>
  `;
  main.appendChild(waitDiv);

  try {
    // Polling : le webhook Bictorys peut arriver quelques secondes après la redirection
    const MAX_TRIES = 12;
    const INTERVAL_MS = 2500;
    let paid = false,
      commune,
      error,
      color,
      author;
    let tokMaptype, tokLevel, tokDept, tokReg;

    for (let i = 0; i < MAX_TRIES; i++) {
      const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
      const data = await res.json();
      paid = data.paid;
      commune = data.commune;
      error = data.error;
      color = data.color;
      author = data.author;
      tokMaptype = data.maptype;
      tokLevel = data.level;
      tokDept = data.dept;
      tokReg = data.reg;

      if (paid) break;

      // Erreur définitive (expiré, déjà utilisé, introuvable) → pas la peine de réessayer
      if (error) break;

      // Paiement en attente de confirmation webhook → on attend
      const dlStatus = document.getElementById("dl-status");
      if (dlStatus)
        dlStatus.innerText = `Confirmation en cours… (${i + 1}/${MAX_TRIES})`;
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }

    if (!paid) {
      waitDiv.innerHTML = `
        <div style="font-size:3rem">❌</div>
        <p style="font-family:'Cormorant Garamond',serif;font-size:1.6rem;
                  font-weight:600;color:var(--terra);">
          ${error || "Paiement non encore confirmé — réessayez dans quelques instants"}
        </p>
        <a href="map.html?token=${token}" style="display:inline-block;margin-top:1rem;
           background:var(--terra);color:white;padding:12px 28px;
           font-size:0.78rem;letter-spacing:1.5px;text-transform:uppercase;
           text-decoration:none;border-radius:1px;">
          Réessayer
        </a>
        <a href="map.html" style="display:inline-block;margin-top:0.5rem;
           font-size:0.78rem;letter-spacing:1.5px;text-transform:uppercase;
           color:var(--muted);text-decoration:underline;">
          Retour à l'accueil
        </a>
      `;
      return;
    }

    document.getElementById("dl-status").innerText =
      "Paiement confirmé — chargement de la carte…";

    // Charger communes.geojson si besoin
    if (!geoData.communes) {
      geoData.communes = await fetchGeo("data/communes.geojson");
    }

    // Contexte sauvegardé avant le paiement (type, niveau, dept, région).
    // sessionStorage en priorité ; repli sur localStorage (pending) si la
    // session a été perdue pendant la redirection de paiement.
    let pending = {};
    try {
      pending = JSON.parse(localStorage.getItem("sutura_pending") || "{}");
    } catch (e) {
      pending = {};
    }
    // Priorité aux valeurs enregistrées dans la commande (ce qui a été payé),
    // repli sur la session/local seulement si absentes.
    const mapType =
      tokMaptype ||
      sessionStorage.getItem("sutura_maptype") ||
      pending.maptype ||
      "localisation";
    const level =
      tokLevel ||
      sessionStorage.getItem("sutura_level") ||
      pending.level ||
      "commune";
    const zDept = tokDept || pending.dept;
    const zReg = tokReg || pending.reg;

    // Construction de la zone selon le niveau.
    let targetFeature;
    if (level === "commune") {
      targetFeature = geoData.communes.features.find(
        (f) => f.properties.CCRCA === commune,
      );
    } else {
      targetFeature = await buildMergedFeature(level, zDept, zReg);
    }

    if (!targetFeature) {
      waitDiv.innerHTML = `
        <div style="font-size:3rem">⚠️</div>
        <p style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;color:var(--terra);">
          Zone introuvable : ${commune}
        </p>
        <p style="font-size:0.78rem;color:var(--muted);">
          Contactez-nous sur WhatsApp avec votre code de paiement.
        </p>
      `;
      return;
    }

    // Supprimer l'écran d'attente
    main.removeChild(waitDiv);

    // Générer la carte en step 3
    goToStep(3);
    await new Promise((r) => setTimeout(r, 300));
    map.invalidateSize();
    map.eachLayer((layer) => map.removeLayer(layer));
    if (mapControls.scale) map.removeControl(mapControls.scale);
    if (mapControls.north) map.removeControl(mapControls.north);

    if (mapType === "relief") {
      await generateReliefMap(
        targetFeature,
        commune,
        author || "Sutura Maps",
        level,
      );
    } else if (mapType === "occupation") {
      const dept = zDept || targetFeature.properties.DEPT;
      const reg = zReg || targetFeature.properties.REG;
      try {
        const ocRes = await fetch("/.netlify/functions/get-occupation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commune, dept, reg, level }),
        });
        if (!ocRes.ok) throw new Error(`HTTP ${ocRes.status}`);
        const ocJson = await ocRes.json();
        occupationClipped = ocJson.features || [];
      } catch (e) {
        occupationClipped = [];
      }

      try {
        occupationPalette =
          JSON.parse(sessionStorage.getItem("sutura_palette") || "null") ||
          pending.palette ||
          {};
      } catch (e) {
        occupationPalette = pending.palette || {};
      }

      await generateOccupationMap(
        targetFeature,
        commune,
        author || "Sutura Maps",
        "ANAT, CSE, ANSD (2020)",
        level,
      );
    } else {
      await generateLocalisationMap(
        targetFeature,
        color || "#7BA05B",
        commune,
        author || "Sutura Maps",
        "DTGC",
        level,
      );
    }

    // Export automatique après rendu
    await new Promise((r) => setTimeout(r, 1500));
    localStorage.removeItem("sutura_pending");
    doExport(false);
  } catch (e) {
    console.error("handleDownloadToken error:", e);
    const wait = document.getElementById("dl-wait");
    if (wait)
      wait.innerHTML = `
      <div style="font-size:3rem">❌</div>
      <p style="font-size:0.9rem;color:var(--terra);">Erreur réseau. Réessayez.</p>
      <a href="map.html" style="display:inline-block;margin-top:1rem;
         background:var(--terra);color:white;padding:12px 28px;
         font-size:0.78rem;letter-spacing:1.5px;text-transform:uppercase;
         text-decoration:none;border-radius:1px;">
        Retour
      </a>
    `;
  }
}

function doExport(withWatermark = true) {
  const btn = document.querySelector(".btn-export");
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "⏳ Génération...";
  btn.style.opacity = "0.7";

  const liveWm = document.getElementById("live-watermark");
  if (liveWm) liveWm.style.display = "none";

  const container = document.getElementById("export-container");
  const scale = 2;
  const width = container.scrollWidth;
  const height = container.scrollHeight;

  domtoimage
    .toPng(container, {
      width: width * scale,
      height: height * scale,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        width: width + "px",
        height: height + "px",
        overflow: "visible",
      },
    })
    .then((dataUrl) => {
      if (liveWm) liveWm.style.display = "block";
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        if (withWatermark) {
          ctx.save();
          ctx.font = "300 22px DM Sans";
          ctx.fillStyle = "rgba(14,12,10,0.07)";
          ctx.rotate(-Math.PI / 6);
          for (let y = -canvas.height; y < canvas.height * 2; y += 420) {
            for (let x = -canvas.width; x < canvas.width * 2; x += 520) {
              ctx.fillText("© Sutura Maps", x, y);
            }
          }
          ctx.restore();
        }

        btn.innerText = "✅ Téléchargement...";
        const commune = document.getElementById("select-commune").value;
        const dept = document.getElementById("select-dept").value;
        const reg = document.getElementById("select-reg").value;
        const link = document.createElement("a");
        link.download = `Carte_${commune || dept || reg}_${new Date().getTime()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        setTimeout(() => {
          btn.disabled = false;
          btn.innerText = originalText;
          btn.style.opacity = "1";
        }, 2000);
      };
      img.src = dataUrl;
    })
    .catch((e) => {
      if (liveWm) liveWm.style.display = "block";
      console.error("Export error:", e);
      btn.disabled = false;
      btn.innerText = "❌ Erreur — Réessayer";
      btn.style.opacity = "1";
      setTimeout(() => {
        btn.innerText = originalText;
      }, 3000);
    });
}
