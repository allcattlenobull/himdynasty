/* 100 cartoon animal butts, drawn as SVG. 20 species x 5 variations. */
(() => {
  "use strict";

  // Small seeded random so the gallery is the same on every visit.
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // ---- building blocks (viewBox 0 0 120 120, animal seen from behind) ----
  const shadow = `<ellipse cx="60" cy="108" rx="40" ry="5" fill="rgba(0,0,0,.45)"/>`;
  const body = (c, rx = 36, ry = 32, cy = 64) => `<ellipse cx="60" cy="${cy}" rx="${rx}" ry="${ry}" fill="${c}"/>`;
  const legs = (c, o = {}) => {
    const { x1 = 38, x2 = 68, w = 14, y = 80, h = 26 } = o;
    return `<rect x="${x1}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${c}"/>` +
           `<rect x="${x2}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${c}"/>`;
  };
  const hooves = (c, o = {}) => {
    const { x1 = 38, x2 = 68, w = 14, y = 100 } = o;
    return `<rect x="${x1}" y="${y}" width="${w}" height="6" rx="2" fill="${c}"/>` +
           `<rect x="${x2}" y="${y}" width="${w}" height="6" rx="2" fill="${c}"/>`;
  };
  const crease = (c, y1 = 72, y2 = 94) =>
    `<path d="M60 ${y1} Q57 ${(y1 + y2) / 2} 60 ${y2}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`;
  const tail = (d, c, w, outline) =>
    `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${w + 3}" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;

  // ---- species ----
  const SPECIES = [
    { name: "Pig", colors: ["#f7a8bd", "#f4b6c2", "#e8a0a8", "#f9c0cb", "#d9909f"], draw: (c) =>
      legs(shade(c, 0.9), { y: 82, h: 22 }) + hooves("#5a3a3f", { y: 100 }) + body(c, 38, 32, 62) +
      crease(shade(c, 0.75), 70, 92) +
      tail("M60 40 c7 -3 9 -12 2 -13 c-6 -1 -7 7 -1 8 c6 1 10 -5 9 -11", shade(c, 0.95), 3.5, shade(c, 0.7)) },

    { name: "Cat", colors: ["#f39c4a", "#2b2b2e", "#9a9aa0", "#f1e3c8", "#c77a3a"], draw: (c) => {
      const tabby = c === "#f39c4a" || c === "#c77a3a";
      return legs(shade(c, 0.9), { x1: 40, x2: 66, w: 14, y: 82, h: 22 }) + body(c, 32, 30, 66) +
        (tabby ? `<path d="M34 56 q8 -4 12 4 M86 56 q-8 -4 -12 4 M30 70 q8 -3 12 4 M90 70 q-8 -3 -12 4" stroke="${shade(c, 0.7)}" stroke-width="3" fill="none" stroke-linecap="round"/>` : "") +
        crease(shade(c, 0.7), 76, 94) + tail("M60 44 C52 26 70 18 64 6", c, 8, shade(c, 0.65)); } },

    { name: "Dog", colors: ["#d9a35b", "#3b2a20", "#f1e3c8", "#8a5a35", "#c9c1b6"], draw: (c) =>
      legs(shade(c, 0.9), { y: 80, h: 26 }) + body(c, 36, 30, 62) + crease(shade(c, 0.7), 72, 90) +
      tail("M60 40 Q76 28 86 12", c, 8, shade(c, 0.65)) },

    { name: "Corgi", colors: ["#e8a25a", "#d98b3a", "#2f2a28", "#b5651d", "#f0b26e"], draw: (c, id) =>
      legs(shade(c, 0.85), { x1: 36, x2: 70, w: 14, y: 86, h: 18 }) +
      `<clipPath id="k${id}"><circle cx="47" cy="66" r="25"/><circle cx="73" cy="66" r="25"/></clipPath>` +
      `<circle cx="47" cy="66" r="25" fill="${c}"/><circle cx="73" cy="66" r="25" fill="${c}"/>` +
      `<g clip-path="url(#k${id})"><ellipse cx="60" cy="94" rx="46" ry="20" fill="#fbf4ea"/></g>` +
      crease(shade(c, 0.6), 70, 90) + `<path d="M52 44 q8 -10 16 0 q-8 -4 -16 0" fill="#fbf4ea"/>` },

    { name: "Bunny", colors: ["#d9cfc4", "#8b6f5a", "#f4efe8", "#6e6e74", "#c4a484"], draw: (c) =>
      `<ellipse cx="42" cy="101" rx="14" ry="6" fill="${shade(c, 0.9)}"/><ellipse cx="78" cy="101" rx="14" ry="6" fill="${shade(c, 0.9)}"/>` +
      body(c, 31, 31, 68) + crease(shade(c, 0.75), 78, 96) +
      `<circle cx="52" cy="50" r="7" fill="#fff"/><circle cx="68" cy="50" r="7" fill="#fff"/><circle cx="60" cy="44" r="7" fill="#fff"/><circle cx="60" cy="54" r="9" fill="#fff"/>` },

    { name: "Duck", colors: ["#f7f3e8", "#f0e6c8", "#ffffff", "#e9e2d0", "#fff4d6"], draw: (c) =>
      `<rect x="47" y="86" width="5" height="16" fill="#f28c28"/><rect x="68" y="86" width="5" height="16" fill="#f28c28"/>` +
      `<polygon points="38,106 50,98 56,106" fill="#f28c28"/><polygon points="64,106 70,98 82,106" fill="#f28c28"/>` +
      `<polygon points="50,42 60,16 70,42" fill="${c}" stroke="${shade(c, 0.85)}" stroke-width="2"/>` +
      body(c, 30, 30, 62) + `<path d="M36 56 q10 10 6 24 M84 56 q-10 10 -6 24" stroke="${shade(c, 0.85)}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` },

    { name: "Penguin", colors: ["#1d1d24", "#23232c", "#191920", "#2a2a33", "#1f2028"], draw: (c) =>
      `<ellipse cx="29" cy="62" rx="7" ry="22" transform="rotate(14 29 62)" fill="${shade(c, 1.3)}"/>` +
      `<ellipse cx="91" cy="62" rx="7" ry="22" transform="rotate(-14 91 62)" fill="${shade(c, 1.3)}"/>` +
      `<ellipse cx="47" cy="102" rx="10" ry="5" fill="#f28c28"/><ellipse cx="73" cy="102" rx="10" ry="5" fill="#f28c28"/>` +
      body(c, 30, 40, 60) + `<polygon points="53,96 60,106 67,96" fill="${c}"/>` + crease("#3a3a46", 74, 94) },

    { name: "Sheep", colors: ["#efe9dc", "#f6f2ea", "#3a3a3e", "#e6ddc9", "#d9d2c3"], draw: (c) =>
      `<rect x="44" y="82" width="8" height="24" rx="3" fill="#222"/><rect x="68" y="82" width="8" height="24" rx="3" fill="#222"/>` +
      [[40, 58, 16], [60, 48, 18], [80, 58, 16], [42, 76, 17], [78, 76, 17], [60, 80, 18], [60, 64, 22]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("") +
      `<circle cx="60" cy="42" r="7" fill="${shade(c, 0.92)}"/>` },

    { name: "Horse", colors: ["#7b4a2c", "#3a2618", "#c49a6c", "#e8e2d6", "#5c3a24"], draw: (c) =>
      legs(shade(c, 0.9), { x1: 37, x2: 69, w: 14, y: 76, h: 28 }) + hooves("#222", { x1: 37, x2: 69, y: 100 }) +
      body(c, 38, 34, 60) +
      `<path d="M54 34 C48 60 46 84 42 104 L58 102 C60 80 64 58 66 34 Z" fill="${c === "#e8e2d6" ? "#cfc8bb" : "#241710"}"/>` },

    { name: "Zebra", colors: ["#f4f4f4"], draw: (c, id) =>
      legs(c, { x1: 38, x2: 68, y: 78, h: 26 }) + hooves("#111", { y: 100 }) +
      `<clipPath id="z${id}"><ellipse cx="60" cy="62" rx="36" ry="32"/><rect x="38" y="78" width="14" height="22"/><rect x="68" y="78" width="14" height="22"/></clipPath>` +
      body(c, 36, 32, 62) +
      `<g clip-path="url(#z${id})" stroke="#111" stroke-width="5" fill="none">` +
      [26, 36, 46, 74, 84, 94].map((x) => `<path d="M${x} 28 q${x < 60 ? -6 : 6} 34 0 80"/>`).join("") +
      `<path d="M30 92 h22 M68 92 h22 M30 84 h22 M68 84 h22"/></g>` +
      tail("M60 34 Q63 58 60 80", "#111", 3, "#111") + `<ellipse cx="60" cy="84" rx="4" ry="7" fill="#111"/>` },

    { name: "Cow", colors: ["#f6f3ee"], draw: (c, id) =>
      legs(c, { y: 80, h: 24 }) + hooves("#3a2a20", { y: 100 }) +
      `<clipPath id="c${id}"><ellipse cx="60" cy="62" rx="38" ry="32"/></clipPath>` + body(c, 38, 32, 62) +
      `<g clip-path="url(#c${id})" fill="#1c1c1c"><ellipse cx="34" cy="50" rx="14" ry="10"/><ellipse cx="86" cy="72" rx="13" ry="11"/><ellipse cx="62" cy="88" rx="9" ry="6"/><ellipse cx="80" cy="40" rx="8" ry="6"/></g>` +
      crease("#c9c2b8", 70, 92) + tail("M60 34 Q66 62 60 90", "#d9d2c6", 3, "#b5ada0") +
      `<ellipse cx="60" cy="94" rx="4" ry="7" fill="#1c1c1c"/>` },

    { name: "Bear", colors: ["#6b4428", "#3a2a1e", "#f2efe9", "#8a5a35", "#2a1d14"], draw: (c) =>
      legs(shade(c, 0.85), { x1: 32, x2: 68, w: 20, y: 80, h: 26 }) + body(c, 40, 36, 62) +
      crease(shade(c, 0.7), 74, 96) + `<circle cx="60" cy="40" r="7" fill="${shade(c, 0.85)}"/>` },

    { name: "Fox", colors: ["#e8692c", "#d4562a", "#f08a3c", "#c94f1e", "#e2773a"], draw: (c) =>
      legs("#2a2220", { x1: 42, x2: 66, w: 12, y: 82, h: 24 }) + body(c, 30, 28, 64) + crease(shade(c, 0.7), 74, 90) +
      `<g transform="rotate(-28 70 60)"><ellipse cx="70" cy="86" rx="13" ry="30" fill="${c}" stroke="${shade(c, 0.7)}" stroke-width="2"/>` +
      `<ellipse cx="70" cy="110" rx="9" ry="7" fill="#fff"/></g>` },

    { name: "Elephant", colors: ["#8e9399", "#9da1a6", "#7f858c", "#a3a1a8", "#868b91"], draw: (c) =>
      legs(shade(c, 0.9), { x1: 32, x2: 66, w: 22, y: 78, h: 28 }) + body(c, 44, 38, 58) +
      `<path d="M30 50 q6 4 4 10 M90 50 q-6 4 -4 10 M40 82 q4 -4 8 0 M72 82 q4 -4 8 0" stroke="${shade(c, 0.75)}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
      crease(shade(c, 0.72), 66, 94) + tail("M60 30 L60 72", shade(c, 0.85), 2.5, shade(c, 0.7)) +
      `<ellipse cx="60" cy="76" rx="3.5" ry="6" fill="#333"/>` },

    { name: "Hippo", colors: ["#9a8aa8", "#8c7f97", "#a8939f", "#7f7488", "#b49aa6"], draw: (c) =>
      legs(shade(c, 0.88), { x1: 30, x2: 70, w: 20, y: 86, h: 18 }) + body(c, 46, 34, 64) +
      crease(shade(c, 0.75), 76, 96) + tail("M60 31 L60 40", shade(c, 0.8), 5, shade(c, 0.65)) },

    { name: "Panda", colors: ["#f5f3ee"], draw: (c) =>
      legs("#141414", { x1: 32, x2: 68, w: 20, y: 80, h: 26 }) + body(c, 38, 34, 62) +
      crease("#cfcac0", 74, 94) + `<circle cx="60" cy="38" r="6.5" fill="${c}" stroke="#cfcac0" stroke-width="2"/>` },

    { name: "Raccoon", colors: ["#8a8a90", "#7a7a80", "#94949a", "#6e6e74", "#9a9a9f"], draw: (c) =>
      legs("#2f2f34", { x1: 40, x2: 66, w: 14, y: 82, h: 22 }) + body(c, 32, 30, 66) + crease(shade(c, 0.7), 76, 94) +
      [0, 1, 2, 3, 4, 5, 6].map((i) =>
        `<circle cx="${64 + i * 3.4}" cy="${46 - i * 6}" r="${9.5 - i * 0.5}" fill="${i % 2 ? "#2f2f34" : "#c8c8cc"}"/>`).join("") },

    { name: "Chicken", colors: ["#f3efe6", "#b5651d", "#f7f0dc", "#8a4b22", "#e9dcc4"], draw: (c) =>
      [-46, -23, 0, 23, 46].map((a, i) =>
        `<ellipse cx="60" cy="22" rx="6" ry="19" transform="rotate(${a} 60 46)" fill="${i % 2 ? "#1f5f3a" : "#123d27"}"/>`).join("") +
      `<rect x="48" y="88" width="5" height="16" fill="#f2b705"/><rect x="67" y="88" width="5" height="16" fill="#f2b705"/>` +
      `<path d="M42 106 l8 -4 l8 4 M62 106 l8 -4 l8 4" stroke="#f2b705" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      body(c, 30, 28, 66) + `<path d="M36 60 q10 8 6 20 M84 60 q-10 8 -6 20" stroke="${shade(c, 0.8)}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` },

    { name: "Squirrel", colors: ["#9b6b43", "#7a7a80", "#b5653a", "#5a3a24", "#a8826a"], draw: (c) =>
      tail("M62 62 C34 54 32 14 58 8 C82 4 90 28 74 32", shade(c, 1.15), 18, shade(c, 0.75)) +
      legs(shade(c, 0.85), { x1: 44, x2: 64, w: 12, y: 88, h: 16 }) + body(c, 26, 26, 72) + crease(shade(c, 0.7), 82, 96) },

    { name: "Gorilla", colors: ["#2c2c30", "#3a3438", "#24242a", "#4a4248", "#333338"], draw: (c) =>
      legs(shade(c, 0.85), { x1: 30, x2: 70, w: 20, y: 80, h: 26 }) + body(c, 42, 36, 60) +
      `<ellipse cx="60" cy="58" rx="22" ry="18" fill="#9a9aa0" opacity=".55"/>` + crease("#55555c", 74, 96) },
  ];

  const QUIPS = ["Not HIM", "Still not HIM", "Definitely not HIM", "Thinks they're HIM", "Wants to be HIM",
                 "Will never be HIM", "Benched", "Last place energy", "Auto-drafted", "Traded away"];

  // Build 100 entries: every species, five variations each, then shuffle.
  const entries = [];
  SPECIES.forEach((sp, s) => {
    for (let v = 0; v < 5; v++) entries.push({ sp, color: sp.colors[v % sp.colors.length], key: `${s}-${v}` });
  });
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }

  const BACKDROPS = ["#16161b", "#1a1214", "#12161a", "#17141c", "#141814"];
  const grid = document.getElementById("butts");
  const frag = document.createDocumentFragment();

  entries.forEach((e, i) => {
    const id = `b${i}`;
    const tilt = ((rand() - 0.5) * 8).toFixed(1);
    const card = document.createElement("figure");
    card.className = "butt-card";
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.style.background = BACKDROPS[i % BACKDROPS.length];
    stage.innerHTML =
      `<svg viewBox="0 0 120 120" role="img" aria-label="Cartoon ${e.sp.name.toLowerCase()} seen from behind" style="rotate:${tilt}deg">` +
      shadow + e.sp.draw(e.color, id) + `</svg>`;
    const cap = document.createElement("figcaption");
    const b = document.createElement("b");
    b.textContent = `#${i + 1} ${e.sp.name}`;
    const q = document.createElement("span");
    q.textContent = QUIPS[i % QUIPS.length];
    cap.append(b, q);
    card.append(stage, cap);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
})();
