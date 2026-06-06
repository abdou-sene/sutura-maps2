/*
  Miniature YouTube Sutura Maps — 1280x720.
  Édite le bloc "data" ci-dessous, puis :  node build-thumbnail.js
  Le PNG sort dans ./out/thumbnail.png
  Si img/map-dankh-sene.png existe, il est intégré à droite.
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
  mapImage: "map-dankh-sene.png",
};
// ===================================================================

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400&family=Barlow+Condensed:wght@600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">`;

const imgPath = path.join(__dirname, "img", data.mapImage);
const hasMap = fs.existsSync(imgPath);
const mapSrc = `file:///${imgPath.replace(/\\/g, "/")}`;

const mapBlock = hasMap
  ? `<img src="${mapSrc}" style="width:100%;height:100%;object-fit:cover;object-position:left center;">`
  : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
        background:#e8e2d8;color:#b85c2c;font-family:'Barlow Condensed';font-size:2rem;
        font-weight:700;letter-spacing:3px;text-transform:uppercase;text-align:center;padding:40px;">
        Dépose<br>map-dankh-sene.png<br>dans img/
     </div>`;

const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">${FONTS}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1280px; height:720px; overflow:hidden; }
  body { background:#0e0c0a; font-family:"DM Sans",sans-serif; position:relative; }
  .wrap { position:absolute; inset:0; display:flex; }
  .left { width:60%; padding:64px 56px; display:flex; flex-direction:column; justify-content:center; }
  .right { width:40%; position:relative; border-left:6px solid #b85c2c; }
  .eyebrow { font-family:"Barlow Condensed"; font-size:1.5rem; font-weight:700;
             letter-spacing:7px; text-transform:uppercase; color:#d4784a; margin-bottom:18px; }
  .h1 { font-family:"Barlow Condensed"; font-weight:700; text-transform:uppercase;
        color:#f7f3ec; line-height:.92; font-size:5.4rem; }
  .h1 .accent { color:#d4784a; font-family:"Cormorant Garamond"; font-style:italic;
                font-weight:700; text-transform:none; font-size:5.6rem; }
  .struck { display:inline-block; margin-top:26px; font-family:"Barlow Condensed";
            font-size:2.3rem; font-weight:700; text-transform:uppercase; letter-spacing:2px;
            color:#9a9088; position:relative; }
  .struck::after { content:""; position:absolute; left:-6px; right:-6px; top:52%;
                   height:5px; background:#b85c2c; transform:rotate(-4deg); }
  .badge { position:absolute; bottom:34px; left:34px; background:#b85c2c; color:#fff;
           font-family:"Barlow Condensed"; font-weight:700; font-size:1.5rem; letter-spacing:2px;
           text-transform:uppercase; padding:10px 20px; }
  .brand { position:absolute; top:30px; left:56px; font-family:"Cormorant Garamond";
           font-size:1.4rem; font-weight:600; letter-spacing:3px; text-transform:uppercase; color:#7a7068; }
</style></head><body>
  <div class="wrap">
    <div class="left">
      <div class="brand">Sutura Maps</div>
      <div class="eyebrow">${data.eyebrow}</div>
      <div class="h1">${data.line1}<br><span class="accent">${data.line2}</span><br>${data.line3}</div>
      <div class="struck">${data.struck}</div>
    </div>
    <div class="right">
      ${mapBlock}
      <div class="badge">2 000 FCFA</div>
    </div>
  </div>
</body></html>`;

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, "thumbnail.html");
const pngPath = path.join(outDir, "thumbnail.png");
fs.writeFileSync(htmlPath, html);

const profileDir = path.join(require("os").tmpdir(), "sutura-chrome-thumb");
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

console.log(`OK  thumbnail.png ${hasMap ? "(avec carte)" : "(sans carte, placeholder)"}`);
console.log(`-> ${pngPath}`);
