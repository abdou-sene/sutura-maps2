let map;
let geoData = { communes: null };
let mapControls = { scale: null, north: null };
let locatorMap = null;
let regionMap = null;

let selectedMapType = "localisation";
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
}

/* ════════════════════════════════
   INITIALISATION
════════════════════════════════ */

window.onload = async () => {
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
    const res = await fetch("data/communes.geojson");
    geoData.communes = await res.json();
    initFilters();
    document.querySelectorAll(".color-swatch").forEach((swatch) => {
      swatch.onclick = () => {
        document
          .querySelectorAll(".color-swatch")
          .forEach((s) => s.classList.remove("selected"));
        swatch.classList.add("selected");
        document.getElementById("color-picker").value = swatch.dataset.color;
      };
    });
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
  const regions = [
    ...new Set(geoData.communes.features.map((f) => f.properties.REG)),
  ].sort();
  regions.forEach((r) => selReg.add(new Option(r, r)));

  selReg.onchange = () => {
    const reg = selReg.value;
    const selDept = document.getElementById("select-dept");
    selDept.innerHTML = '<option value="">-- Département --</option>';
    selDept.disabled = !reg;
    if (reg) {
      const depts = [
        ...new Set(
          geoData.communes.features
            .filter((f) => f.properties.REG === reg)
            .map((f) => f.properties.DEPT),
        ),
      ].sort();
      depts.forEach((d) => selDept.add(new Option(d, d)));
      selDept.onchange = updateCommunes;
    }
  };
}

function updateCommunes() {
  const dept = document.getElementById("select-dept").value;
  const selCom = document.getElementById("select-commune");
  selCom.innerHTML = '<option value="">-- Commune --</option>';
  selCom.disabled = !dept;
  if (dept) {
    const coms = geoData.communes.features
      .filter((f) => f.properties.DEPT === dept)
      .sort((a, b) => a.properties.CCRCA.localeCompare(b.properties.CCRCA));
    coms.forEach((c) =>
      selCom.add(new Option(c.properties.CCRCA, c.properties.CCRCA)),
    );

    selCom.onchange = async () => {
      document.getElementById("btn-to-step2").disabled = false;
      if (selectedMapType === "occupation") {
        showStep2LoadingScreen();
        await preloadOccupation();
      } else {
        restoreStep2Localisation();
      }
    };
  }
}

/* ════════════════════════════════
   ÉTAPE 2 — ÉCRAN DE CHARGEMENT
════════════════════════════════ */

function showStep2LoadingScreen() {
  const card = document.querySelector("#step-2 .card");
  card.innerHTML = `
    <h2>2. Couleurs des classes</h2>
    <div style="
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      min-height:200px;gap:1rem;width:100%;text-align:center;
    ">
      <div style="
        width:48px;height:48px;border-radius:50%;
        border:2px solid var(--line);
        border-top:2px solid var(--terra);
        animation:spinRing 0.9s linear infinite;
        flex-shrink:0;
      "></div>
      <p style="font-size:0.78rem;color:var(--muted);font-weight:300;letter-spacing:0.5px;margin:0;">
        Analyse de la commune...
      </p>
    </div>
    <div class="btn-group" style="margin-top:1rem;justify-content:center;">
      <button class="btn-back" onclick="goToStep(1)">Retour</button>
      <button class="btn-next" disabled style="opacity:0.4;cursor:not-allowed;">Patienter...</button>
    </div>
  `;
}

/* ════════════════════════════════
   ÉTAPE 2 — DYNAMIQUE
════════════════════════════════ */

function goToStep2() {
  if (selectedMapType === "occupation") {
    goToStep(2);
    if (!occupationClipped) {
      showStep2LoadingScreen();
    }
  } else {
    goToStep(2);
  }
}

function buildStep2Occupation(classes) {
  occupationPalette = {};
  classes.forEach((nom) => {
    occupationPalette[nom] = PALETTE_DEFAULT[nom] || "#cccccc";
  });

  const card = document.querySelector("#step-2 .card");

  // Fondu sortant
  card.style.transition = "opacity 0.25s ease";
  card.style.opacity = "0";

  setTimeout(() => {
    card.innerHTML = `
      <h2>2. Couleurs des classes</h2>
      <p style="font-size:0.75rem;color:var(--muted);margin-bottom:1.2rem;font-weight:300;">
        Couleurs suggérées — ajustez selon vos préférences.
      </p>
      <div id="occupation-colors" style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;padding-right:4px;">
        ${classes
          .map(
            (nom, i) => `
          <div style="
            display:flex;align-items:center;gap:10px;
            padding:6px 0;border-bottom:1px solid var(--line);
            opacity:0;animation:fadeUp 0.3s ease ${i * 40}ms forwards;
          ">
            <input type="color" value="${occupationPalette[nom]}"
              data-class="${nom}"
              onchange="occupationPalette[this.dataset.class] = this.value"
              style="width:32px;height:28px;padding:2px;cursor:pointer;flex-shrink:0;border-radius:1px;">
            <span style="font-size:0.78rem;color:var(--ink);font-weight:300;">${nom}</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="btn-group" style="margin-top:1.5rem;">
        <button class="btn-back" onclick="goToStep(1)">Retour</button>
        <button class="btn-next" onclick="generateFinalMap()">Générer la carte</button>
      </div>
    `;
    // Fondu entrant
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
  const comName = document.getElementById("select-commune").value;
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;

  try {
    const res = await fetch("/.netlify/functions/get-occupation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commune: comName, dept, reg }),
    });

    const geojson = await res.json();

    occupationClipped = geojson.features || [];

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
      <span>Chef-lieu</span>
    </div>
    <div class="legend-item" id="legend-autres">
      <span class="legend-point" style="background:#555555;border-color:#fff"></span>
      <span>Village</span>
    </div>
    <div class="legend-item" id="legend-routes">
      <span class="legend-line road-line"></span>
      <span>Route</span>
    </div>
    <div class="legend-item" id="legend-cours-eau">
      <span class="legend-line water-line"></span>
      <span>Cours d'eau</span>
    </div>
    <div class="legend-item">
      <span class="legend-swatch commune-swatch" id="legend-commune-swatch"></span>
      <span id="legend-commune-label">Zone d'étude</span>
    </div>
    <div class="legend-item">
      <span class="legend-swatch neighbor-swatch"></span>
      <span>Communes limitrophes</span>
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
   LÉGENDE DYNAMIQUE (localisation)
════════════════════════════════ */

function updateLegendVisibility({
  hasChefLieu,
  hasAutres,
  hasCours,
  hasRoutes,
}) {
  const el = (id) => document.getElementById(id);
  if (el("legend-chef-lieu"))
    el("legend-chef-lieu").style.display = hasChefLieu ? "flex" : "none";
  if (el("legend-autres"))
    el("legend-autres").style.display = hasAutres ? "flex" : "none";
  if (el("legend-cours-eau"))
    el("legend-cours-eau").style.display = hasCours ? "flex" : "none";
  if (el("legend-routes"))
    el("legend-routes").style.display = hasRoutes ? "flex" : "none";
}

/* ════════════════════════════════
   FONCTIONS DE CHARGEMENT
════════════════════════════════ */

async function addLayer(url, style, communeFeature) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    const filtered = data.features.filter((f) => {
      try {
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

async function addPoints(url, communeFeature) {
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

    const features = data.features.filter((f) => {
      try {
        const type = (f.properties.popPlace_1 || "").trim();
        if (type === "Hameau") return false;
        if (type === "Quartier") return false;
        if (type === "Chef lieu de quartier") return false;
        const [x, y] = f.geometry.coordinates;
        if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3])
          return false;
        return turf.booleanPointInPolygon(f, communeFeature);
      } catch (e) {
        return false;
      }
    });

    const hasChefLieu = features.some((f) =>
      CHEF_LIEUX.some((c) => (f.properties.popPlace_1 || "").includes(c)),
    );
    const hasAutres = features.some(
      (f) =>
        !CHEF_LIEUX.some((c) => (f.properties.popPlace_1 || "").includes(c)),
    );

    // Mettre à jour la légende localisation (IDs existent déjà)
    const elCL = document.getElementById("legend-chef-lieu");
    const elAU = document.getElementById("legend-autres");
    if (elCL) elCL.style.display = hasChefLieu ? "flex" : "none";
    if (elAU) elAU.style.display = hasAutres ? "flex" : "none";

    features.sort((a, b) => a.properties.nom.length - b.properties.nom.length);

    L.geoJSON(
      { ...data, features },
      {
        pointToLayer: (feature, latlng) => {
          const type = (feature.properties.popPlace_1 || "").trim();
          const isChefLieu = CHEF_LIEUX.some((c) => type.includes(c));
          return L.circleMarker(latlng, {
            radius: isChefLieu ? 6 : 4,
            fillColor: isChefLieu ? "#e74c3c" : "#555555",
            color: "#fff",
            weight: 1.5,
            fillOpacity: 1,
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties?.nom) {
            const type = (feature.properties.popPlace_1 || "").trim();
            const isChefLieu = CHEF_LIEUX.some((c) => type.includes(c));
            const isHameau = /H[1-9]/.test(feature.properties.nom);
            if (!isHameau) {
              layer.bindTooltip(feature.properties.nom, {
                permanent: true,
                direction: "right",
                offset: [1, 0],
                className: `leaflet-tooltip-localite${isChefLieu ? " chef-lieu" : ""}`,
              });
            }
          }
        },
      },
    ).addTo(map);

    setTimeout(() => {
      const tooltips = document.querySelectorAll(".leaflet-tooltip-localite");
      const boxes = [];
      tooltips.forEach((el) => {
        const r = el.getBoundingClientRect();
        const overlaps = boxes.some(
          (b) =>
            !(
              r.right < b.left ||
              r.left > b.right ||
              r.bottom < b.top ||
              r.top > b.bottom
            ),
        );
        if (overlaps) {
          el.style.display = "none";
        } else {
          boxes.push(r);
        }
      });
    }, 800);

    document.getElementById("localite-count").innerText = features.length;
  } catch (e) {
    console.error("addPoints error:", e);
  }
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
  const minX = bounds.getWest();
  const maxX = bounds.getEast();
  const minY = bounds.getSouth();
  const maxY = bounds.getNorth();

  const spanX = maxX - minX;
  const interval = spanX < 0.1 ? 0.02 : spanX < 0.3 ? 0.05 : 0.1;
  const style = { color: "#555", weight: 0.5, opacity: 0.5, dashArray: "3 4" };

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
    weight: 3,
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
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="wm" x="0" y="0" width="280" height="180" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
          <text x="0" y="40" font-family="DM Sans" font-size="13" font-weight="300"
                fill="rgba(14,12,10,0.23)" letter-spacing="1">© Sutura Maps</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>
    </svg>`;
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
  marker.on("dragstart", (e) => {
    L.DomEvent.stopPropagation(e);
    map.dragging.disable();
  });
  marker.on("dragend", (e) => {
    L.DomEvent.stopPropagation(e);
    map.dragging.disable();
  });

  return marker;
}

/* ════════════════════════════════
   HELPER — LABELS VOISINS (partagé)
════════════════════════════════ */

function addNeighborLabels(neighbors, targetFeature, neighborStyle) {
  const style = neighborStyle || {
    color: "#777879",
    fillColor: "#bdc3c7",
    fillOpacity: 0.5,
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

      // Hint drag
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

/* ════════════════════════════════
   CARTES DE LOCALISATION (PANNEAU)
════════════════════════════════ */

function buildLocatorMap(targetFeature, userColor) {
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
  fetch("data/departements.geojson")
    .then((r) => r.json())
    .then((data) => {
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

async function generateFinalMap() {
  const comName = document.getElementById("select-commune").value;
  const userColor = document.getElementById("color-picker")?.value || "#7BA05B";
  const author = document.getElementById("author-name")?.value || "Sutura Maps";
  const source = document.getElementById("data-source")?.value || "";
  const dept = document.getElementById("select-dept").value;
  const reg = document.getElementById("select-reg").value;
  const mapType = selectedMapType;

  goToStep("loading");
  document.getElementById("loading-commune").innerText = comName.toUpperCase();

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
  goToStep(3);

  setTimeout(async () => {
    await new Promise((r) => setTimeout(r, 200));
    map.invalidateSize();

    map.eachLayer((layer) => map.removeLayer(layer));
    if (mapControls.scale) map.removeControl(mapControls.scale);
    if (mapControls.north) map.removeControl(mapControls.north);

    const targetFeature = geoData.communes.features.find(
      (f) =>
        f.properties.CCRCA === comName &&
        f.properties.DEPT === dept &&
        f.properties.REG === reg,
    );

    if (!targetFeature) {
      showError("Commune introuvable. Veuillez réessayer.");
      goToStep(2);
      return;
    }

    const tempBounds = L.geoJSON(targetFeature).getBounds();
    map.fitBounds(tempBounds, { animate: false });

    if (mapType === "localisation") {
      await generateLocalisationMap(
        targetFeature,
        userColor,
        comName,
        author,
        source,
      );
    } else if (mapType === "occupation") {
      await generateOccupationMap(
        targetFeature,
        userColor,
        comName,
        author,
        source,
      );
    }
  }, 600);
}

/* ════════════════════════════════
   CARTE DE LOCALISATION
════════════════════════════════ */

async function generateLocalisationMap(
  targetFeature,
  userColor,
  comName,
  author,
  source,
) {
  // 1. Restaurer la légende EN PREMIER — avant tout appel qui modifie les IDs
  restoreLocalisationLegend();

  // 2. Voisins
  const neighbors = geoData.communes.features.filter((f) => {
    if (f.properties.CCRCA === comName) return false;
    return turf.booleanIntersects(targetFeature, f);
  });
  addNeighborLabels(neighbors, targetFeature);

  // 3. Zone d'étude
  const studyAreaLayer = L.geoJSON(targetFeature, {
    style: {
      color: userColor,
      fillColor: userColor,
      fillOpacity: 0.5,
      weight: 4,
    },
  }).addTo(map);

  // 4. Couches linéaires
  const hasCours = await addLayer(
    "data/cours_eau.geojson",
    { color: "#3498db", weight: 2, opacity: 0.6 },
    targetFeature,
  );
  const hasRoutes = await addLayer(
    "data/routes.geojson",
    { color: "#e74c3c", weight: 1.5, opacity: 0.8 },
    targetFeature,
  );

  // 5. Mettre à jour légende cours/routes (IDs existent maintenant)
  const elCE = document.getElementById("legend-cours-eau");
  const elRO = document.getElementById("legend-routes");
  if (elCE) elCE.style.display = hasCours ? "flex" : "none";
  if (elRO) elRO.style.display = hasRoutes ? "flex" : "none";

  // 6. Localités
  await addPoints("data/localites.geojson", targetFeature);

  // 7. Cadrage + contrôles
  map.fitBounds(studyAreaLayer.getBounds(), {
    padding: [10, 35, 60, 35],
    animate: false,
  });
  addGraticule(map);
  addMapControls();

  // 8. Panneau latéral
  updateSidePanel(comName, userColor, author, "DTGC");

  // 9. Réafficher locators
  document.getElementById("locator-card").style.display = "flex";
  document.getElementById("region-card").style.display = "flex";
  buildLocatorMap(targetFeature, userColor);
  buildRegionMap(targetFeature, userColor);

  // 10. Filigrane
  addLiveWatermark();
}

/* ════════════════════════════════
   CARTE D'OCCUPATION DU SOL
════════════════════════════════ */

async function generateOccupationMap(
  targetFeature,
  userColor,
  comName,
  author,
  source,
) {
  const clipped = occupationClipped;
  const classesReelles = [
    ...new Set(
      occupationClipped
        .map((f) => (f.properties.NOM || "").trim())
        .filter(Boolean),
    ),
  ];

  const PALETTE = {};
  classesReelles.forEach((nom) => {
    PALETTE[nom] = occupationPalette[nom] || PALETTE_DEFAULT[nom] || "#cccccc";
  });

  if (!clipped || clipped.length === 0) {
    showError("Aucune donnée d'occupation du sol pour cette commune.");
    return;
  }

  // 1. Voisins (style neutre pour ne pas masquer l'occupation)
  const neighbors = geoData.communes.features.filter((f) => {
    if (f.properties.CCRCA === comName) return false;
    return turf.booleanIntersects(targetFeature, f);
  });
  addNeighborLabels(neighbors, targetFeature, {
    color: "#aaa",
    fillColor: "#e0e0e0",
    fillOpacity: 0.4,
    weight: 1,
  });

  // 2. Couche occupation clippée
  L.geoJSON(
    { type: "FeatureCollection", features: clipped },
    {
      style: (feature) => {
        const nom = (feature.properties.NOM || "").trim();
        const color = PALETTE[nom] || "#cccccc";
        return { color: "#fff", weight: 0.1, fillColor: color, fillOpacity: 1 };
      },
      interactive: false,
    },
  ).addTo(map);

  // 3. Contour commune par dessus
  const studyAreaLayer = L.geoJSON(targetFeature, {
    style: { color: "#2c3e50", fillColor: "transparent", weight: 3 },
  }).addTo(map);

  // 4. Légende dynamique
  const classesPresentes = [
    ...new Set(
      clipped.map((f) => (f.properties.NOM || "").trim()).filter(Boolean),
    ),
  ].sort();
  buildOccupationLegend(classesPresentes, PALETTE);

  // 5. Cadrage + contrôles
  map.fitBounds(studyAreaLayer.getBounds(), {
    padding: [10, 35, 60, 35],
    animate: false,
  });
  addGraticule(map);
  addMapControls();

  // 6. Panneau — masquer locators
  updateSidePanel(comName, userColor, author, "ANAT / CSE / ANSD (2020)");
  document.getElementById("locator-card").style.display = "none";
  document.getElementById("region-card").style.display = "none";
  addLiveWatermark();

  // 7. Surcharger le titre
  document.getElementById("display-commune").innerText =
    `OCCUPATION DU SOL — COMMUNE DE ${comName.toUpperCase()}`;
}

/* ════════════════════════════════
   PANNEAU LATÉRAL
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
  }, 30000);
}

function exportToPNG() {
  document.getElementById("payment-modal").style.display = "flex";
}

function closePaymentModal() {
  document.getElementById("payment-modal").style.display = "none";
}

function confirmPayment() {
  closePaymentModal();
  doExport(false);
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
        const link = document.createElement("a");
        link.download = `Carte_${document.getElementById("select-commune").value}_${new Date().getTime()}.png`;
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
