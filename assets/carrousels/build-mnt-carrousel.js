/*
  Carrousel Sutura Maps — Relief (MNT) par classes.
  Lance :  node build-mnt-carrousel.js
  Les PNG 1080x1080 sortent dans ./out (préfixe mnt-).
*/

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MAP_IMG = "mnt_dindefello.png"; // dans ./img
const CROP = 0.9; // garde 90 % du haut de l'image (masque la barre de boutons)

const slides = [
  { type: "cover" },
  { type: "annotated" },
  {
    type: "feature",
    eyebrow: "Précision",
    title: "Découpé sur tes limites",
    text: "Le terrain est clippé pixel par pixel sur le contour exact de ta zone. Pas un rectangle approximatif.",
  },
  {
    type: "classes",
    eyebrow: "Lecture",
    title: "5 classes d'altitude",
    text: "L'intervalle s'adapte à la dénivelée réelle. Une plaine et une montagne n'ont pas la même légende, et c'est normal.",
  },
  {
    type: "feature",
    eyebrow: "Honnête",
    title: "Sous le niveau de la mer ?",
    text: "Quand le terrain descend sous zéro, une classe « < 0 » l'affiche clairement. Source SRTM, NASA, 30 m.",
  },
  {
    type: "cta",
    price: "2 000",
    currency: "FCFA · à partir de",
    url: "sutura-maps",
    note: "Ta zone, en quelques minutes.",
  },
];

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;0,700;1,300;1,400&family=DM+Sans:wght@300;400;500&family=Barlow+Condensed:wght@500;700&display=swap" rel="stylesheet">`;

const BASE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:1080px; overflow:hidden; }
  body { background:#f7f3ec; font-family:"DM Sans",sans-serif; position:relative; color:#0e0c0a; }
  .frame { position:absolute; inset:0; padding:88px 80px; display:flex; flex-direction:column; }
  .deco { position:absolute; top:120px; right:-40px; width:240px; height:240px; border:1px solid #e0d9cf; transform:rotate(15deg); }
  .deco2 { position:absolute; top:150px; right:-15px; width:180px; height:180px; border:1px solid #d4784a; opacity:.3; transform:rotate(15deg); }
  .eyebrow { font-family:"Barlow Condensed",sans-serif; font-size:1.1rem; font-weight:700; letter-spacing:5px; text-transform:uppercase; color:#b85c2c; }
  .divider { width:70px; height:3px; background:#b85c2c; margin:28px 0; }
  .shot { width:100%; border:1px solid #d8d0c4; background:#fff; box-shadow:0 18px 40px rgba(14,12,10,.10); display:block; }
  .shot-wrap { width:100%; display:flex; align-items:center; justify-content:center; position:relative; }
  .pin { position:absolute; width:54px; height:54px; border-radius:50%; background:#b85c2c; color:#fff;
         display:flex; align-items:center; justify-content:center; font-family:"Barlow Condensed",sans-serif;
         font-weight:700; font-size:1.7rem; border:4px solid #f7f3ec; box-shadow:0 5px 14px rgba(14,12,10,.4);
         transform:translate(-50%,-50%); }
  .ramp { display:flex; flex-direction:column; gap:0; width:100%; margin-top:10px; border:1px solid #d8d0c4; }
  .ramp .band { display:flex; align-items:center; gap:16px; padding:14px 20px; }
  .ramp .sw { width:46px; height:30px; flex:0 0 auto; border:1px solid rgba(0,0,0,.15); }
  .ramp .lab { font-size:1.25rem; color:#0e0c0a; }
`;

function imgExists(name) {
  return name && fs.existsSync(path.join(__dirname, "img", name));
}
function imgSrc(name) {
  return `file:///${path.join(__dirname, "img", name).replace(/\\/g, "/")}`;
}

function brandBar() {
  return `<div style="position:absolute;left:80px;bottom:60px;font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600;letter-spacing:2px;color:#0e0c0a;">Sutura <em style="font-style:italic;color:#b85c2c;">Maps</em></div>`;
}

function render(slide) {
  if (slide.type === "cover") {
    const H = 470,
      cropH = Math.round(H * CROP);
    const shot = imgExists(MAP_IMG)
      ? `<div class="shot-wrap" style="margin-top:40px;flex:1;min-height:0;">
           <div class="shot" style="overflow:hidden;height:${cropH}px;line-height:0;">
             <img src="${imgSrc(MAP_IMG)}" style="display:block;height:${H}px;width:auto;">
           </div>
         </div>`
      : `<div style="flex:1;"></div>`;
    return `<div class="frame">
      <div class="eyebrow">Nouveau · Relief (MNT)</div>
      <div class="divider"></div>
      <h1 style="font-family:'Cormorant Garamond',serif;font-size:4.4rem;font-weight:700;line-height:1.04;">
        Le relief de ta commune,<br><em style="font-style:italic;font-weight:300;color:#b85c2c;">au mètre près.</em>
      </h1>
      ${shot}
    </div>`;
  }

  if (slide.type === "annotated") {
    const H = 660,
      cropH = Math.round(H * CROP);
    // Positions des features dans l'image PLEINE, converties sur l'image recadrée.
    const pin = (xPct, yPctFull, n) =>
      `<span class="pin" style="left:${xPct}%;top:${((yPctFull / 100) * H) / cropH * 100}%;">${n}</span>`;
    return `<div class="frame">
      <div class="eyebrow">Ce que tu obtiens</div>
      <div class="divider"></div>
      <div class="shot-wrap" style="flex:1;min-height:0;margin-bottom:24px;">
        <div style="position:relative;display:inline-block;">
          <div class="shot" style="overflow:hidden;height:${cropH}px;line-height:0;">
            <img src="${imgSrc(MAP_IMG)}" style="display:block;height:${H}px;width:auto;">
          </div>
          ${pin(30, 30, 1)}
          ${pin(45, 62, 2)}
          ${pin(82, 22, 3)}
        </div>
      </div>
      <div style="display:flex;gap:22px;">
        <div style="flex:1;font-size:1.2rem;line-height:1.35;"><b>1.</b> Découpé sur tes limites exactes.</div>
        <div style="flex:1;font-size:1.2rem;line-height:1.35;"><b>2.</b> 5 classes d'altitude.</div>
        <div style="flex:1;font-size:1.2rem;line-height:1.35;"><b>3.</b> Légende verticale et claire.</div>
      </div>
    </div>`;
  }

  if (slide.type === "feature") {
    return `<div class="frame" style="justify-content:center;">
      ${brandBar()}
      <div class="eyebrow">${slide.eyebrow}</div>
      <div class="divider"></div>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:4rem;font-weight:700;line-height:1.05;max-width:880px;">${slide.title}</h2>
      <p style="font-size:1.7rem;color:#7a7068;margin-top:24px;line-height:1.45;max-width:880px;">${slide.text}</p>
    </div>`;
  }

  if (slide.type === "classes") {
    const bands = [
      ["#f0ebe1", "> 425 m"],
      ["#b4784a", "340 – 425 m"],
      ["#e1c873", "255 – 340 m"],
      ["#aac364", "170 – 255 m"],
      ["#3c8c50", "85 – 170 m"],
    ];
    const ramp = bands
      .map(
        ([c, l]) =>
          `<div class="band"><span class="sw" style="background:${c};"></span><span class="lab">${l}</span></div>`,
      )
      .join("");
    return `<div class="frame" style="justify-content:center;">
      ${brandBar()}
      <div class="eyebrow">${slide.eyebrow}</div>
      <div class="divider"></div>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:3.6rem;font-weight:700;line-height:1.05;">${slide.title}</h2>
      <p style="font-size:1.45rem;color:#7a7068;margin:18px 0 26px;line-height:1.45;max-width:880px;">${slide.text}</p>
      <div class="ramp">${ramp}</div>
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
  const htmlPath = path.join(outDir, `mnt-${n}.html`);
  const pngPath = path.join(outDir, `mnt-${n}.png`);
  fs.writeFileSync(htmlPath, html);

  const profileDir = path.join(require("os").tmpdir(), "sutura-mnt-" + n);
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
  console.log(`OK  mnt-${n}.png`);
});

console.log(`\nTerminé. ${slides.length} PNG dans : ${outDir}`);
