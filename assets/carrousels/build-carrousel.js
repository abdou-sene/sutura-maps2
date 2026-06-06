/*
  Générateur de carrousel Sutura Maps.
  Édite le tableau "slides" ci-dessous, puis lance :  node build-carrousel.js
  Les PNG 1080x1080 sortent dans le dossier ./out
*/

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---- Emplacement de Chrome (modifie si besoin) ----
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// ===================================================================
//  CONTENU DU CARROUSEL  —  c'est la seule partie à modifier
// ===================================================================
const slides = [
  {
    type: "cover",
    eyebrow: "Sutura Maps",
    title: "Ta carte de<br><em>localisation</em><br>en 5 minutes",
    sub: "Ta commune, personnalisée, prête à imprimer ou à rendre.",
    image: "map-dankh-sene.png",
  },
  {
    type: "step",
    num: "01",
    label: "Choisis",
    text: "Ta commune parmi les 557 du Sénégal.",
    image: "select-commune.png",
  },
  {
    type: "step",
    num: "02",
    label: "Personnalise",
    text: "La couleur, ton nom, le style de la carte.",
    image: "style-signature.png",
  },
  {
    type: "step",
    num: "03",
    label: "Paie",
    text: "Par Wave, Orange ou autre mobile money. En quelques secondes.",
    image: "payment-operators.png",
  },
  {
    type: "step",
    num: "04",
    label: "Télécharge",
    text: "Un fichier haute résolution, tout de suite.",
    image: "map-dankh-sene.png",
  },
  {
    type: "cta",
    price: "2 000",
    currency: "FCFA par carte",
    url: "sutura-maps.netlify.app",
    note: "Moins de 5 minutes, chrono.",
  },
];
// ===================================================================

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;0,700;1,300;1,400&family=DM+Sans:wght@300;400;500&family=Barlow+Condensed:wght@500;700&display=swap" rel="stylesheet">`;

const BASE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:1080px; overflow:hidden; }
  body {
    background:#f7f3ec; font-family:"DM Sans",sans-serif;
    position:relative; color:#0e0c0a;
  }
  .frame { position:absolute; inset:0; padding:90px 80px; display:flex; flex-direction:column; }
  .deco { position:absolute; top:120px; right:-40px; width:240px; height:240px;
          border:1px solid #e0d9cf; transform:rotate(15deg); }
  .deco2 { position:absolute; top:150px; right:-15px; width:180px; height:180px;
           border:1px solid #d4784a; opacity:.3; transform:rotate(15deg); }
  .eyebrow { font-family:"Barlow Condensed",sans-serif; font-size:1.1rem; font-weight:700;
             letter-spacing:5px; text-transform:uppercase; color:#b85c2c; }
  .divider { width:70px; height:3px; background:#b85c2c; margin:30px 0; }
  .shot { width:100%; border:1px solid #d8d0c4; background:#fff;
          box-shadow:0 18px 40px rgba(14,12,10,.10); display:block; }
  .shot-wrap { width:100%; display:flex; align-items:center; justify-content:center; }
`;

function imgExists(name) {
  return name && fs.existsSync(path.join(__dirname, "img", name));
}
function imgSrc(name) {
  return `file:///${path.join(__dirname, "img", name).replace(/\\/g, "/")}`;
}

function render(slide) {
  if (slide.type === "cover") {
    const shot = imgExists(slide.image)
      ? `<div class="shot-wrap" style="margin-top:40px;flex:1;min-height:0;">
           <img class="shot" src="${imgSrc(slide.image)}" style="max-height:430px;width:auto;object-fit:contain;">
         </div>`
      : `<div style="flex:1;"></div>`;
    return `<div class="frame">
      <div class="eyebrow">${slide.eyebrow}</div>
      <div class="divider"></div>
      <h1 style="font-family:'Cormorant Garamond',serif;font-size:4.4rem;font-weight:700;line-height:1.04;">
        ${slide.title.replace(/<em>/g, '<em style="font-style:italic;font-weight:300;color:#b85c2c;">')}
      </h1>
      <p style="font-family:'Cormorant Garamond',serif;font-size:1.7rem;color:#7a7068;margin-top:20px;line-height:1.4;">
        ${slide.sub}
      </p>
      ${shot}
    </div>`;
  }
  if (slide.type === "step") {
    const shot = imgExists(slide.image)
      ? `<div class="shot-wrap" style="flex:1;min-height:0;margin-bottom:36px;">
           <img class="shot" src="${imgSrc(slide.image)}" style="max-height:540px;max-width:100%;width:auto;object-fit:contain;">
         </div>`
      : `<div style="font-family:'Barlow Condensed',sans-serif;font-size:18rem;font-weight:700;color:#e8e2d8;line-height:.8;flex:1;">${slide.num}</div>`;
    return `<div class="frame">
      <div style="display:flex;align-items:baseline;gap:20px;">
        <div class="eyebrow">Étape ${slide.num}</div>
      </div>
      <div style="margin-top:14px;">
        <h2 style="font-family:'Cormorant Garamond',serif;font-size:3.8rem;font-weight:700;">${slide.label}</h2>
        <p style="font-size:1.5rem;color:#7a7068;margin-top:12px;line-height:1.4;max-width:820px;">${slide.text}</p>
        <div class="divider"></div>
      </div>
      ${shot}
    </div>`;
  }
  if (slide.type === "cta") {
    return `<div class="frame" style="justify-content:center;align-items:flex-start;">
      <div class="deco"></div><div class="deco2"></div>
      <div class="eyebrow">Disponible maintenant</div>
      <div class="divider"></div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:8rem;font-weight:700;line-height:1;">${slide.price}</div>
      <div style="font-family:'DM Sans';font-size:1.3rem;letter-spacing:2px;text-transform:uppercase;color:#7a7068;margin-top:8px;">${slide.currency}</div>
      <p style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:2rem;color:#7a7068;margin-top:40px;">${slide.note}</p>
      <div style="margin-top:60px;font-family:'Barlow Condensed',sans-serif;font-size:2.1rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;border-bottom:3px solid #b85c2c;padding-bottom:6px;">${slide.url}</div>
    </div>`;
  }
  return "";
}

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });

slides.forEach((slide, i) => {
  const n = String(i + 1).padStart(2, "0");
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">${FONTS}<style>${BASE}</style></head><body>${render(slide)}</body></html>`;
  const htmlPath = path.join(outDir, `slide-${n}.html`);
  const pngPath = path.join(outDir, `slide-${n}.png`);
  fs.writeFileSync(htmlPath, html);

  const profileDir = path.join(require("os").tmpdir(), "sutura-chrome-" + n);
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1080,1080",
    "--default-background-color=FFFFFFFF",
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ]);

  console.log(`OK  slide-${n}.png`);
});

console.log(`\nTerminé. ${slides.length} PNG dans : ${outDir}`);
