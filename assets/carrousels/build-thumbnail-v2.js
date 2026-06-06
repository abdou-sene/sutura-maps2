/*
  Miniature YouTube Sutura Maps — v2 avec photo — 1280x720.
  Lance :  node build-thumbnail-v2.js
  Sort dans ./out/thumbnail-v2.png
  Utilise img/abdou-img.png (photo) et img/map-dankh-sene.png (carte).
*/

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// ===================================================================
const data = {
  eyebrow: "Tutoriel SIG",
  line1: "Ta carte de",
  line2: "localisation",
  line3: "en 5 minutes",
  struck: "Sans QGIS",
  photo: "abdou-img.png",
  map: "map-dankh-sene.png",
  photoPosition: "0px 0px", // x y du cadrage. Ajuste si le visage ou la main est coupé.
};
// ===================================================================

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400;1,700&family=Barlow+Condensed:wght@600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">`;

const dir = (n) =>
  `file:///${path.join(__dirname, "img", n).replace(/\\/g, "/")}`;
const hasPhoto = fs.existsSync(path.join(__dirname, "img", data.photo));
const hasMap = fs.existsSync(path.join(__dirname, "img", data.map));

const mapInset = hasMap
  ? `<img src="${dir(data.map)}" style="position:absolute;bottom:34px;left:34px;width:290px;height:180px;
       object-fit:cover;object-position:left center;border:4px solid #f7f3ec;
       box-shadow:0 14px 34px rgba(0,0,0,.5);">`
  : "";

const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">${FONTS}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1280px; height:720px; overflow:hidden; }
  body { background:#0e0c0a; font-family:"DM Sans",sans-serif; position:relative; }

  .photo { position:absolute; inset:0; width:100%; height:100%;
           object-fit:cover; object-position:${data.photoPosition}; }

  /* Dégradé sombre depuis la droite pour la lisibilité du texte */
  .scrim { position:absolute; inset:0;
           background:linear-gradient(270deg,
             rgba(14,12,10,.97) 0%,
             rgba(14,12,10,.93) 40%,
             rgba(14,12,10,.55) 58%,
             rgba(14,12,10,0) 76%); }

  .panel { position:absolute; right:56px; top:0; bottom:0; width:660px; text-align:right;
           display:flex; flex-direction:column; justify-content:center; align-items:flex-end; }
  .brand { position:absolute; top:34px; left:46px; font-family:"Cormorant Garamond";
           font-size:1.4rem; font-weight:600; letter-spacing:3px; text-transform:uppercase;
           color:#cfc7bd; text-shadow:0 2px 10px rgba(0,0,0,.7); }
  .eyebrow { font-family:"Barlow Condensed"; font-size:1.5rem; font-weight:700;
             letter-spacing:7px; text-transform:uppercase; color:#d4784a; margin-bottom:16px; }
  .h1 { font-family:"Barlow Condensed"; font-weight:700; text-transform:uppercase;
        color:#f7f3ec; line-height:.92; font-size:5.2rem; text-shadow:0 2px 18px rgba(0,0,0,.6); }
  .h1 .accent { color:#d4784a; font-family:"Cormorant Garamond"; font-style:italic;
                font-weight:700; text-transform:none; font-size:5.4rem; }
  .struck { display:inline-block; margin-top:24px; font-family:"Barlow Condensed";
            font-size:2.2rem; font-weight:700; text-transform:uppercase; letter-spacing:2px;
            color:#cfc7bd; position:relative; }
  .struck::after { content:""; position:absolute; left:-6px; right:-6px; top:52%;
                   height:5px; background:#b85c2c; transform:rotate(-4deg); }
  .badge { position:absolute; top:34px; right:56px; background:#b85c2c; color:#fff;
           font-family:"Barlow Condensed"; font-weight:700; font-size:1.7rem; letter-spacing:2px;
           text-transform:uppercase; padding:12px 24px; box-shadow:0 10px 24px rgba(0,0,0,.4); }
</style></head><body>
  ${hasPhoto ? `<img class="photo" src="${dir(data.photo)}">` : ""}
  <div class="scrim"></div>
  <div class="brand">Sutura Maps</div>
  <div class="panel">
    <div class="eyebrow">${data.eyebrow}</div>
    <div class="h1">${data.line1}<br><span class="accent">${data.line2}</span><br>${data.line3}</div>
    <div class="struck">${data.struck}</div>
  </div>
  <div class="badge">2 000 FCFA</div>
  ${mapInset}
</body></html>`;

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, "thumbnail-v2.html");
const pngPath = path.join(outDir, "thumbnail-v2.png");
fs.writeFileSync(htmlPath, html);

const profileDir = path.join(require("os").tmpdir(), "sutura-chrome-thumb2");
execFileSync(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profileDir}`,
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1280,720",
  "--default-background-color=FFFFFFFF",
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, "/")}`,
]);

console.log(`OK  thumbnail-v2.png  photo:${hasPhoto} carte:${hasMap}`);
console.log(`-> ${pngPath}`);
