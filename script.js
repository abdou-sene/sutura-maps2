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
  if (selectedMapType === "localisation") {
    restoreStep2Localisation();
  }
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

  if (commune) selectedLevel = "commune";
  else if (dept) selectedLevel = "dept";
  else if (reg) selectedLevel = "region";
  else {
    selectedLevel = "commune";
    btn.disabled = true;
    return;
  }

  // Occupation du sol : commune obligatoire (les niveaux dept/région la cassaient).
  // Localisation : on autorise commune, département ou région.
  if (selectedMapType === "occupation") {
    btn.disabled = !commune;
  } else {
    btn.disabled = !reg;
  }
}

/* ════════════════════════════════
   BOUTON "SUIVANT" — point d'entrée unique
   (remplace onclick="goToStep(2)" dans le HTML)
════════════════════════════════ */

async function handleNextBtn() {
  if (selectedMapType === "localisation") {
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
      showPaymentDoneInTab();
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
            <span style="font-size:0.8rem;color:var(--ink);font-weight:300;flex:1;">${nom}</span>
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

  // Occupation uniquement au niveau commune.
  const level = "commune";
  selectedLevel = level;

  if (!commune) {
    showError("Veuillez sélectionner une commune pour l'occupation du sol.");
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
    <span class="legend-label">Océan</span>
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

  classes.forEach((nom) => {
    const color = palette[nom] || "#cccccc";
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-swatch" style="background:${color};border-color:rgba(0,0,0,0.15);opacity:1"></span>
      <span>${nom}</span>
    `;
    body.appendChild(item);
  });
}

/* ════════════════════════════════
   FONCTIONS DE CHARGEMENT COUCHES
════════════════════════════════ */

async function addLayer(url, style, communeFeature) {
  try {
    const res = await fetch(url);
    const data = await res.json();
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

async function addPoints(url, communeFeature, level = "commune", pointNames = null) {
  try {
    const res = await fetch(url);
    const data = await res.json();
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
          rank(f.properties.popPlace_1) <
            rank(cur.properties.popPlace_1)
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
            chef: level === "region" || CHEF_LIEUX.some((c) => type.includes(c)),
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
  const hit = (a, b) =>
    !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
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
    L.marker([maxY, x], {
      icon: L.divIcon({
        className: "",
        html: `<span style="font:300 10px DM Sans;color:#333333;white-space:nowrap">${toDMS(x, false)}</span>`,
        iconAnchor: [10, -2],
      }),
      interactive: false,
    }).addTo(map);
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
    L.marker([y, minX], {
      icon: L.divIcon({
        className: "",
        html: `<span style="font:300 10px DM Sans;color:#333333;white-space:nowrap">${toDMS(y, true)}</span>`,
        iconAnchor: [-2, 4],
      }),
      interactive: false,
    }).addTo(map);
  }

  L.rectangle(bounds, {
    color: "#2c3e50",
    weight: 0.5,
    fill: false,
    interactive: false,
  }).addTo(map);
}

/* ════════════════════════════════
   FILIGRANE LIVE
════════════════════════════════ */

function addLiveWatermark() {
  const mapArea = document.getElementById("map-area");
  const old = document.getElementById("live-watermark");
  if (old) old.remove();

  const wm = document.createElement("div");
  wm.id = "live-watermark";
  wm.style.cssText = `position:absolute;inset:0;z-index:999;pointer-events:none;overflow:hidden;`;
  wm.innerHTML = `
    <!-- Filigrane dense -->
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

function addNeighborLabels(neighbors, targetFeature, neighborStyle) {
  const style = neighborStyle || {
    color: "#777879",
    fillColor: "#ffffff",
    fillOpacity: 0.7,
    weight: 2,
  };
  const labeledNeighbors = new Set();

  L.geoJSON(neighbors, {
    style,
    onEachFeature: (feature, layer) => {
      if (!feature.properties?.CCRCA) return;
      if (labeledNeighbors.has(feature.properties.CCRCA)) return;
      labeledNeighbors.add(feature.properties.CCRCA);

      try {
        const mapBounds = map.getBounds();
        const bboxPoly = turf.bboxPolygon([
          mapBounds.getWest(),
          mapBounds.getSouth(),
          mapBounds.getEast(),
          mapBounds.getNorth(),
        ]);

        let visiblePart;
        try {
          visiblePart = turf.intersect(feature, bboxPoly);
        } catch (e) {
          visiblePart = null;
        }
        if (!visiblePart) visiblePart = feature;

        let labelZone;
        try {
          labelZone = turf.difference(visiblePart, targetFeature);
        } catch (e) {
          labelZone = visiblePart;
        }
        if (!labelZone) labelZone = visiblePart;

        const centroid = turf.centroid(labelZone);
        const [lng, lat] = centroid.geometry.coordinates;
        let finalLatLng = [lat, lng];

        if (!mapBounds.contains(finalLatLng)) {
          const c = turf.centroid(visiblePart).geometry.coordinates;
          finalLatLng = [c[1], c[0]];
        }

        const cvs = document.createElement("canvas");
        const ctx = cvs.getContext("2d");
        ctx.font = "500 10px DM Sans";
        const textWidth = ctx.measureText(
          feature.properties.CCRCA.toUpperCase(),
        ).width;

        const studyCentroidPx = map.latLngToContainerPoint(
          turf.centroid(targetFeature).geometry.coordinates.slice().reverse(),
        );
        const labelPx = map.latLngToContainerPoint(finalLatLng);
        const anchorX =
          labelPx.x < studyCentroidPx.x ? Math.round(textWidth) : 0;

        createNeighborMarker(finalLatLng, feature.properties.CCRCA, anchorX);
      } catch (e) {
        const c = turf.centroid(feature).geometry.coordinates;
        createNeighborMarker([c[1], c[0]], feature.properties.CCRCA, 0);
      }

      let hintShown = false;
      setTimeout(() => {
        if (hintShown) return;
        hintShown = true;
        const hint = document.getElementById("drag-hint");
        if (hint) {
          hint.style.display = "block";
          hint.offsetHeight;
          hint.style.animation =
            "popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, fadeOut 0.5s ease 4s forwards";
        }
      }, 4000);
    },
  }).addTo(map);
}

async function addOceanLayer(url, targetFeature) {
  try {
    const res = await fetch(url);
    const data = await res.json();
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
  });
  const dept = targetFeature.properties.DEPT;
  const reg = targetFeature.properties.REG;

  fetch("data/departements.geojson")
    .then((r) => r.json())
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
  });
  const reg = targetFeature.properties.REG;
  fetch("data/regions.geojson")
    .then((r) => r.json())
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
  const res = await fetch("data/communes.geojson");
  geoData.communes = await res.json();
}

async function generateFinalMap() {
  const comName = document.getElementById("select-commune").value;
  const userColor = document.getElementById("color-picker")?.value || "#7BA05B";
  const author = document.getElementById("author-name")?.value || "Sutura Maps";
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;

  // Occupation : toujours commune. Localisation : niveau choisi (commune/dept/région).
  const level = selectedMapType === "occupation" ? "commune" : selectedLevel;
  const zoneName =
    level === "region" ? reg : level === "dept" ? dept : comName;

  goToStep("loading");
  document.getElementById("loading-commune").innerText = (
    zoneName || ""
  ).toUpperCase();

  const steps = ["ls1", "ls2", "ls3"];
  steps.forEach((id, i) => {
    setTimeout(() => {
      document
        .querySelectorAll(".lstep")
        .forEach((s) => s.classList.remove("active"));
      document.getElementById(id)?.classList.add("active");
    }, i * 1000);
  });

  await new Promise((r) => setTimeout(r, 3000));

  // ← CHARGER communes.geojson ici si pas encore chargé
  if (!geoData.communes) {
    try {
      const res = await fetch("data/communes.geojson");
      geoData.communes = await res.json();
    } catch (e) {
      showError("Impossible de charger les données géographiques.");
      goToStep(2);
      return;
    }
  }

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
    } else {
      await generateOccupationMap(
        targetFeature,
        comName,
        author,
        "ANAT, CSE, ANSD (2020)",
        "commune",
      );
    }
  }, 600);
}

/* ════════════════════════════════
   HELPER — FUSION EN UN POLYGONE
════════════════════════════════ */

async function buildMergedFeature(level, dept, reg) {
  if (level === "dept") {
    try {
      const res = await fetch("data/departements.geojson");
      const data = await res.json();
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
      const res = await fetch("data/regions.geojson");
      const data = await res.json();
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
    const r = await fetch(url);
    return await r.json();
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
  if (neighbors.length) addNeighborLabels(neighbors, filterFeature);

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

  // ── Titre, auteur, source ──
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText = new Date().toLocaleDateString(
    "fr-FR",
  );
  const dsEl = document.getElementById("data-source");
  if (dsEl) dsEl.innerText = source;

  const locatorCard = document.getElementById("locator-card");
  const regionCard = document.getElementById("region-card");

  if (level === "commune") {
    document.getElementById("display-commune").innerText = `COMMUNE DE ${zoneName.toUpperCase()}`;
    document.querySelector("#locator-card .panel-card-header").innerText = `DÉPARTEMENT ${dept || ""}`;
    document.getElementById("region-card-header").innerText = `RÉGION ${reg || ""} — SÉNÉGAL`;
    locatorCard.style.display = "flex";
    regionCard.style.display = "flex";
    buildLocatorMap(targetFeature, userColor, "commune");
    buildRegionMap(targetFeature, userColor);
  } else if (level === "dept") {
    document.getElementById("display-commune").innerText = `DÉPARTEMENT DE ${zoneName.toUpperCase()}`;
    document.querySelector("#locator-card .panel-card-header").innerText = `RÉGION ${reg || ""}`;
    document.getElementById("region-card-header").innerText = `RÉGION ${reg || ""} — SÉNÉGAL`;
    locatorCard.style.display = "flex";
    regionCard.style.display = "flex";
    buildLocatorMap(targetFeature, userColor, "dept");
    buildRegionMap(targetFeature, userColor);
  } else {
    document.getElementById("display-commune").innerText = `RÉGION DE ${zoneName.toUpperCase()}`;
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

  // Voisins selon le niveau
  let neighborFeatures = [];
  if (level === "commune") {
    neighborFeatures = geoData.communes.features.filter((f) => {
      if (f.properties.CCRCA === zoneName) return false;
      try {
        return turf.booleanIntersects(targetFeature, f);
      } catch (e) {
        return false;
      }
    });
  } else if (level === "dept") {
    try {
      const res = await fetch("data/departements.geojson");
      const data = await res.json();
      neighborFeatures = data.features
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
      /* pas de voisins */
    }
  } else if (level === "region") {
    try {
      const res = await fetch("data/regions.geojson");
      const data = await res.json();
      neighborFeatures = data.features
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
      /* pas de voisins */
    }
  }

  if (neighborFeatures.length > 0) {
    addNeighborLabels(neighborFeatures, targetFeature, {
      color: "#aaa",
      fillColor: "#e0e0e0",
      fillOpacity: 0.4,
      weight: 1,
    });
  }

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
    new Date().toLocaleDateString("fr-FR");
  document.getElementById("data-source").innerText = source;

  addLiveWatermark();
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
    `RÉGION ${reg || ""} — SÉNÉGAL`;
  document.getElementById("display-commune").innerText =
    `COMMUNE DE ${comName.toUpperCase()}`;
  document.getElementById("display-author").innerText = author;
  document.getElementById("display-date").innerText =
    new Date().toLocaleDateString("fr-FR");
  document.getElementById("data-source").innerText = source;

  const communeSwatch = document.getElementById("legend-commune-swatch");
  if (communeSwatch) communeSwatch.style.background = color;
  const communeLabel = document.getElementById("legend-commune-label");
  if (communeLabel) communeLabel.innerText = comName;
}

/* ════════════════════════════════
   PAIEMENT
════════════════════════════════ */

function startPaymentTimer() {
  setTimeout(() => {
    const bar = document.getElementById("progress-bar");
    if (bar) bar.style.width = "100%";
  }, 100);
  setTimeout(() => {
    const btn = document.getElementById("confirm-pay-btn");
    if (!btn) return;
    btn.disabled = false;
    btn.style.background = "#0e0c0a";
    btn.style.cursor = "pointer";
    btn.style.transform = "scale(1.02)";
    setTimeout(() => (btn.style.transform = "scale(1)"), 300);
  }, 35000);
}

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

  // Niveau et nom de la zone (commune par défaut, dept ou région en localisation).
  const level = selectedMapType === "occupation" ? "commune" : selectedLevel;
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
        client: mobile ? "mobile" : "desktop",
      }),
    });

    const data = await res.json();

    if (!data.payment_url) {
      showError(data.error || "Erreur initialisation paiement");
      resetBtn();
      return;
    }

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
          selectedMapType === "occupation" ? occupationPalette || {} : undefined,
      }),
    );

    if (mobile) {
      // Mobile : redirection plein écran. Le retour est géré par
      // handleDownloadToken via ?token= dans l'URL.
      window.location.href = data.payment_url;
      return;
    }

    // Ordinateur : on garde la page, on ouvre Bictorys dans un nouvel onglet,
    // et on surveille le paiement pour lancer le téléchargement ici.
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

function buildPaymentOverlay(commune) {
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
        Commune de ${(commune || "").toUpperCase()}
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
        Votre carte reste téléchargeable pendant 1&nbsp;heure, même si vous fermez cette page.
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
  // La carte (aperçu) est déjà rendue : on exporte sans filigrane.
  doExport(false);
}

/* Onglet Bictorys de retour (ordinateur) : ne pas re-télécharger ici. */
function showPaymentDoneInTab() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:1.2rem;
                text-align:center;padding:2rem;font-family:'DM Sans',sans-serif;
                background:#f7f3ec;color:#0e0c0a;">
      <div style="font-size:3rem">✅</div>
      <p style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:700;">
        Paiement confirmé
      </p>
      <p style="font-size:0.9rem;color:#7a7068;max-width:360px;line-height:1.6;">
        Retournez à l'onglet Sutura Maps : votre téléchargement s'y lance
        automatiquement. Vous pouvez fermer cette page.
      </p>
    </div>`;
}

/* Reprise d'un téléchargement payé (page rechargée, 1 h de validité). */
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

function showCodeModal(code, commune) {
  const modal = document.getElementById("payment-modal");
  modal.style.display = "flex";
  modal.innerHTML = `
    <div style="background:#f7f3ec;padding:2.5rem;max-width:440px;
                width:90%;border-radius:2px;text-align:center;border:1px solid rgba(14,12,10,0.1);">
      
      <p style="font-family:'Cormorant Garamond',serif;font-size:1.5rem;
                font-weight:600;margin-bottom:0.5rem;">
        Votre code de paiement
      </p>
      <p style="font-size:0.78rem;color:#7a7068;margin-bottom:1.5rem;line-height:1.6;">
        Envoyez ce code avec votre paiement Wave.<br>
        Votre carte sera débloquée dans les minutes qui suivent.
      </p>

      <!-- Le code -->
      <div id="display-code" onclick="copyCode('${code}')" style="cursor:pointer;
     background:#0e0c0a;color:#c9a84c;
     font-family:'Cormorant Garamond',serif;
     font-size:2.2rem;font-weight:700;
     padding:1.2rem;border-radius:2px;
     margin-bottom:0.5rem;letter-spacing:4px;">
  ${code}
</div>
      <p style="font-size:0.68rem;color:#7a7068;margin-bottom:1.5rem;">
        (cliquez pour copier)
      </p>

      <!-- Prix -->
      <div style="background:#f0ebe3;padding:0.8rem;border-radius:2px;
                  margin-bottom:1.5rem;font-size:0.82rem;color:#0e0c0a;">
        <strong>2 000 FCFA</strong> · Commune de ${commune}
      </div>

      <!-- Bouton Wave -->
      <a href="https://pay.wave.com/m/M_sn_d2M6Pe0j1DGg?amount=2000"
         target="_blank"
         style="display:block;background:#1dc7b0;color:white;padding:13px;
                font-size:0.82rem;letter-spacing:1.5px;text-transform:uppercase;
                text-decoration:none;border-radius:2px;margin-bottom:0.8rem;
                font-family:'DM Sans',sans-serif;">
        Payer 2 000 FCFA avec Wave →
      </a>

      <!-- Instruction WhatsApp -->
      <a href="https://wa.me/221781751168?text=Bonjour%2C+j%27ai+pay%C3%A9+pour+la+commune+de+${encodeURIComponent(commune)}+%E2%80%94+mon+code+est+%3A+${code}"
         target="_blank"
         style="display:block;background:#25D366;color:white;padding:13px;
                font-size:0.82rem;letter-spacing:1.5px;text-transform:uppercase;
                text-decoration:none;border-radius:2px;margin-bottom:1rem;
                font-family:'DM Sans',sans-serif;">
        Envoyer le code par WhatsApp →
      </a>

      <!-- Vérification si déjà payé -->
      <button onclick="checkAndDownload()"
        style="width:100%;background:transparent;color:#7a7068;padding:10px;
               font-family:'DM Sans',sans-serif;font-size:0.75rem;
               border:1px solid rgba(14,12,10,0.15);border-radius:2px;
               cursor:pointer;margin-bottom:0.8rem;">
        J'ai déjà payé — Vérifier mon accès
      </button>

      <button onclick="closePaymentModal()"
        style="background:transparent;border:none;color:#7a7068;
               font-size:0.72rem;cursor:pointer;text-decoration:underline;">
        Annuler
      </button>
    </div>
  `;
}

function copyCode(code) {
  navigator.clipboard.writeText(code);
  // Feedback visuel sans recharger la page
  const codeDiv = document.getElementById("display-code");
  if (codeDiv) {
    const original = codeDiv.innerText;
    codeDiv.innerText = "✓ Copié !";
    codeDiv.style.color = "#28c840";
    setTimeout(() => {
      codeDiv.innerText = original;
      codeDiv.style.color = "";
    }, 2000);
  }
}
async function checkAndDownload() {
  const token = sessionStorage.getItem("sutura_token");
  if (!token) return;

  const btn = event.target;
  btn.disabled = true;
  btn.innerText = "⏳ Vérification...";

  const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
  const { paid, error } = await res.json();

  if (paid) {
    closePaymentModal();
    doExport(false);
  } else {
    btn.disabled = false;
    btn.innerText = error || "Paiement non encore confirmé";
  }
}

function showWaitingModal(token) {
  const modal = document.getElementById("payment-modal");
  modal.style.display = "flex";
  modal.innerHTML = `
    <div style="background:#f7f3ec;padding:2.5rem;max-width:420px;width:90%;border-radius:2px;text-align:center;">
      <p style="font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600;margin-bottom:1rem;">
        Paiement en cours…
      </p>
      <p style="font-size:0.78rem;color:#7a7068;margin-bottom:1.5rem;line-height:1.6;">
        Complétez le paiement dans l'onglet PayDunya.<br>
        Revenez ici après confirmation.
      </p>
      <div style="background:#0e0c0a;color:#c9a84c;font-family:'Cormorant Garamond',serif;
                  font-size:1.8rem;font-weight:700;padding:1rem;border-radius:2px;margin-bottom:1.5rem;">
        2 000 FCFA
      </div>
      <button id="check-payment-btn" onclick="checkAndDownload('${token}')"
        style="width:100%;background:#0e0c0a;color:white;padding:14px;
               font-family:'DM Sans',sans-serif;font-size:0.82rem;letter-spacing:1.5px;
               text-transform:uppercase;border:none;border-radius:2px;cursor:pointer;margin-bottom:1rem;">
        ✅ J'ai payé — Télécharger ma carte
      </button>
      <button onclick="closePaymentModal()"
        style="background:transparent;border:none;color:#7a7068;font-size:0.75rem;
               cursor:pointer;text-decoration:underline;">
        Annuler
      </button>
    </div>
  `;
}

async function checkAndDownload(token) {
  const btn = document.getElementById("check-payment-btn");
  btn.disabled = true;
  btn.innerText = "⏳ Vérification en cours…";

  // Polling 3 fois max (10s entre chaque)
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
      const { paid, error } = await res.json();

      if (paid) {
        closePaymentModal();
        doExport(false); // false = sans filigrane
        return;
      }

      if (error) {
        btn.disabled = false;
        btn.innerText = `❌ ${error}`;
        return;
      }

      // Pas encore confirmé — attendre 10s
      btn.innerText = `⏳ En attente… (${i + 1}/3)`;
      await new Promise((r) => setTimeout(r, 10000));
    } catch (e) {
      btn.disabled = false;
      btn.innerText = "❌ Erreur réseau — Réessayer";
      return;
    }
  }

  btn.disabled = false;
  btn.innerText = "❌ Non confirmé — Contactez-nous";
}
function closePaymentModal() {
  document.getElementById("payment-modal").style.display = "none";
}
function confirmPayment() {
  closePaymentModal();
  doExport(false);
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
    let paid = false, commune, error, color, author;

    for (let i = 0; i < MAX_TRIES; i++) {
      const res = await fetch(`/.netlify/functions/check-token?token=${token}`);
      const data = await res.json();
      paid = data.paid;
      commune = data.commune;
      error = data.error;
      color = data.color;
      author = data.author;

      if (paid) break;

      // Erreur définitive (expiré, déjà utilisé, introuvable) → pas la peine de réessayer
      if (error) break;

      // Paiement en attente de confirmation webhook → on attend
      const dlStatus = document.getElementById("dl-status");
      if (dlStatus) dlStatus.innerText = `Confirmation en cours… (${i + 1}/${MAX_TRIES})`;
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
      const r = await fetch("data/communes.geojson");
      geoData.communes = await r.json();
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
    const mapType =
      sessionStorage.getItem("sutura_maptype") ||
      pending.maptype ||
      "localisation";
    const level =
      sessionStorage.getItem("sutura_level") || pending.level || "commune";

    // Construction de la zone selon le niveau.
    let targetFeature;
    if (level === "commune") {
      targetFeature = geoData.communes.features.find(
        (f) => f.properties.CCRCA === commune,
      );
    } else {
      targetFeature = await buildMergedFeature(level, pending.dept, pending.reg);
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

    if (mapType === "occupation") {
      const dept = targetFeature.properties.DEPT;
      const reg = targetFeature.properties.REG;
      try {
        const ocRes = await fetch("/.netlify/functions/get-occupation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commune, dept, reg, level: "commune" }),
        });
        if (!ocRes.ok) throw new Error(`HTTP ${ocRes.status}`);
        const ocJson = await ocRes.json();
        occupationClipped = ocJson.features || [];
      } catch (e) {
        occupationClipped = [];
      }

      try {
        occupationPalette = JSON.parse(
          sessionStorage.getItem("sutura_palette") || "null",
        ) ||
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
        "commune",
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
