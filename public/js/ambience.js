// Draws a homely Kerala-style veranda as the page background (pure SVG, no images).
// The scene follows the time of day: morning, afternoon, evening and night.
//   Ambience.blur(true)        -> soften it when a newspaper is open
//   Ambience.setPhase('night') -> force a phase (morning | afternoon | evening | night)
//   Ambience.setPhase(null)    -> back to automatic (follows the clock)
// You can also test a phase with ?phase=evening in the page URL.
const Ambience = (() => {
  // Small seeded random so the scene looks the same on every load
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // ---------- time-of-day palettes ----------
  const PHASES = {
    morning: {
      sky: ['#a9cfe8', '#d9e6ec', '#fde4c4'],
      orb: { x: 560, y: 380, r: 46, c: '#fff3c4', halo: 'rgba(255,236,180,.6)', moon: false },
      far: '#93b59c', leaves: ['#5f9a4a', '#77ad55', '#4a8540'],
      tint: '#fff2e2', lamps: 0, shafts: 0.16, bokeh: 0, stars: false,
    },
    afternoon: {
      sky: ['#5fa8e3', '#a9d3ef', '#e2f1f8'],
      orb: { x: 640, y: 200, r: 40, c: '#fffbe8', halo: 'rgba(255,255,220,.55)', moon: false },
      far: '#7fa889', leaves: ['#4f8f3c', '#68a646', '#3d7a33'],
      tint: '#ffffff', lamps: 0, shafts: 0.1, bokeh: 0, stars: false,
    },
    evening: {
      sky: ['#4d5c8f', '#d9727a', '#f6a55c'],
      orb: { x: 560, y: 440, r: 56, c: '#ffb35c', halo: 'rgba(255,150,80,.6)', moon: false },
      far: '#5b5468', leaves: ['#34502f', '#3f5a33', '#2a4326'],
      tint: '#e6ae8e', lamps: 0.75, shafts: 0, bokeh: 0.6, stars: false,
    },
    night: {
      sky: ['#070d22', '#111c3d', '#1f2b52'],
      orb: { x: 690, y: 205, r: 30, c: '#f4f1dc', halo: 'rgba(210,225,255,.3)', moon: true },
      far: '#0f1626', leaves: ['#1b2a24', '#22332b', '#16231d'],
      tint: '#3b4370', lamps: 1, shafts: 0, bokeh: 1, stars: true,
    },
  };

  function phaseFor(date = new Date()) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 16) return 'afternoon';
    if (h >= 16 && h < 19) return 'evening';
    return 'night';
  }

  // ---------- outdoor: sky, sun/moon, trees ----------
  function sky(p) {
    const o = p.orb;
    let s = `<rect x="0" y="0" width="900" height="700" fill="url(#sky)"/>
      <circle cx="${o.x}" cy="${o.y}" r="${o.r * 3.2}" fill="url(#halo)"/>
      <circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="${o.c}"/>`;
    if (o.moon) {
      s += `<circle cx="${o.x - 9}" cy="${o.y - 6}" r="6" fill="rgba(0,0,0,.07)"/>
            <circle cx="${o.x + 8}" cy="${o.y + 9}" r="4" fill="rgba(0,0,0,.06)"/>`;
    }
    if (p.stars) {
      for (let i = 0; i < 45; i++) {
        s += `<circle class="amb-twinkle" cx="${(rnd() * 860).toFixed(0)}" cy="${(130 + rnd() * 330).toFixed(0)}"
          r="${(0.8 + rnd() * 1.6).toFixed(1)}" fill="#fffbe6"
          style="animation-delay:-${(rnd() * 4).toFixed(1)}s"/>`;
      }
    }
    return s;
  }

  function leafCluster(cx, cy, spread, n, p) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
      s += `<circle cx="${(cx + Math.cos(a) * d * 1.3).toFixed(0)}" cy="${(cy + Math.sin(a) * d * 0.8).toFixed(0)}"
        r="${(18 + rnd() * 30).toFixed(0)}" fill="${pick(p.leaves)}"/>`;
    }
    return s;
  }

  function trees(p) {
    // distant tree line
    let d = 'M0 560 L0 470';
    for (let x = 0; x <= 900; x += 45) d += ` Q${x + 22} ${(420 + rnd() * 50).toFixed(0)} ${x + 45} ${(455 + rnd() * 30).toFixed(0)}`;
    d += ' L900 560 Z';
    let s = `<path d="${d}" fill="${p.far}"/>`;
    // two big trees in the garden
    const trunk = p.stars ? '#1a1410' : '#5b4030';
    s += `<path d="M150 560 C160 450 120 380 90 300 M150 470 C200 400 260 360 320 330" stroke="${trunk}" stroke-width="16" fill="none" stroke-linecap="round"/>
          <path d="M700 560 C690 470 720 420 760 380" stroke="${trunk}" stroke-width="12" fill="none" stroke-linecap="round"/>`;
    s += `<g class="amb-leaves">${leafCluster(150, 260, 110, 38, p)}${leafCluster(330, 320, 70, 18, p)}</g>`;
    s += `<g class="amb-leaves" style="animation-delay:-3s">${leafCluster(760, 360, 80, 24, p)}</g>`;
    // flowering hedge along the railing
    let hedge = leafCluster(420, 520, 90, 20, p) + leafCluster(40, 525, 60, 12, p);
    for (let i = 0; i < 14; i++) {
      hedge += `<circle cx="${(330 + rnd() * 200).toFixed(0)}" cy="${(480 + rnd() * 70).toFixed(0)}" r="5"
        fill="${p.stars ? '#5a2430' : pick(['#e0393e', '#f06a3b', '#f2c14e'])}"/>`;
    }
    return s + hedge;
  }

  // ---------- the veranda ----------
  function ceiling() {
    let s = `<rect x="0" y="0" width="1600" height="96" fill="#6b3a1c"/>`;
    for (let x = 0; x <= 1600; x += 24) s += `<line x1="${x}" y1="0" x2="${x + 6}" y2="96" stroke="rgba(0,0,0,.18)" stroke-width="2"/>`;
    for (let x = -20; x <= 1600; x += 120) s += `<polygon points="${x},0 ${x + 18},0 ${x + 30},96 ${x + 12},96" fill="#45230e"/>`;
    s += `<rect x="0" y="96" width="1600" height="28" fill="url(#wood)"/>
          <rect x="0" y="124" width="1600" height="8" fill="rgba(0,0,0,.28)"/>`;
    return s;
  }

  function shutterDoor(x, y, w, h) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#4a2410"/>
      <rect x="${x + 12}" y="${y + 12}" width="${w / 2 - 18}" height="${h - 24}" fill="url(#louver)"/>
      <rect x="${x + w / 2 + 6}" y="${y + 12}" width="${w / 2 - 18}" height="${h - 24}" fill="url(#louver)"/>
      <rect x="${x + w / 2 - 3}" y="${y}" width="6" height="${h}" fill="#3a1b0b"/>
      <circle cx="${x + w / 2 - 12}" cy="${y + h * 0.55}" r="4" fill="#c99a3c"/>
      <circle cx="${x + w / 2 + 12}" cy="${y + h * 0.55}" r="4" fill="#c99a3c"/>`;
  }

  function backWall() {
    return `<rect x="880" y="132" width="460" height="568" fill="#5a2c14"/>
      ${shutterDoor(900, 210, 200, 490)}
      ${shutterDoor(1120, 210, 200, 490)}
      <rect x="900" y="146" width="420" height="50" fill="#3a1b0b"/>
      <rect x="910" y="152" width="400" height="38" fill="url(#louver)"/>
      <rect x="1340" y="132" width="260" height="568" fill="url(#brick)"/>
      <rect x="1340" y="132" width="260" height="568" fill="url(#brickShade)"/>
      <rect x="860" y="124" width="42" height="576" fill="url(#pillar)"/>
      <rect x="852" y="672" width="58" height="28" fill="#3a1d0c"/>`;
  }

  function railing() {
    let s = `<rect x="0" y="556" width="862" height="18" fill="url(#wood)"/>
             <rect x="0" y="574" width="862" height="5" fill="rgba(0,0,0,.3)"/>
             <rect x="0" y="686" width="862" height="14" fill="#4a2913"/>`;
    for (let x = 8; x < 850; x += 24) s += `<rect x="${x}" y="579" width="11" height="107" fill="#6e3f1e"/><rect x="${x}" y="579" width="3" height="107" fill="rgba(255,255,255,.08)"/>`;
    return s;
  }

  function floor() {
    let s = `<rect x="0" y="700" width="1600" height="200" fill="url(#floor)"/>`;
    [750, 815, 895].forEach((y) => (s += `<line x1="0" y1="${y}" x2="1600" y2="${y}" stroke="rgba(0,0,0,.14)" stroke-width="2"/>`));
    for (let x = -400; x <= 2000; x += 160) s += `<line x1="800" y1="560" x2="${x}" y2="900" stroke="rgba(0,0,0,.08)" stroke-width="2" clip-path="url(#floorClip)"/>`;
    s += `<rect x="0" y="700" width="1600" height="40" fill="url(#floorShine)"/>`;
    return s;
  }

  function plant(x, base, scale = 1, flowers = false) {
    let s = `<g transform="translate(${x} ${base}) scale(${scale})">`;
    for (let i = 0; i < 9; i++) {
      const a = -75 + i * 18 + (rnd() * 10 - 5);
      s += `<ellipse cx="0" cy="-70" rx="12" ry="48" fill="${pick(['#3f8f3a', '#2f7a32', '#4fa047'])}" transform="rotate(${a.toFixed(0)} 0 -10)"/>`;
    }
    if (flowers) for (let i = 0; i < 6; i++) s += `<circle cx="${(rnd() * 90 - 45).toFixed(0)}" cy="${(-60 - rnd() * 60).toFixed(0)}" r="7" fill="#e0393e"/>`;
    s += `<path d="M-34 -14 L34 -14 L26 40 L-26 40 Z" fill="#b5532e"/><rect x="-38" y="-20" width="76" height="10" rx="3" fill="#c96a3f"/></g>`;
    return s;
  }

  function hangingPlant(x) {
    return `<g class="sway" style="transform-origin:${x}px 124px">
      <line x1="${x}" y1="124" x2="${x - 20}" y2="250" stroke="#d8c9a6" stroke-width="2"/>
      <line x1="${x}" y1="124" x2="${x + 20}" y2="250" stroke="#d8c9a6" stroke-width="2"/>
      <path d="M${x - 26} 248 L${x + 26} 248 L${x + 18} 284 L${x - 18} 284 Z" fill="#b5532e"/>
      ${[...Array(7)].map((_, i) => `<path d="M${x - 20 + i * 7} 250 q${rnd() * 20 - 10} 40 ${rnd() * 16 - 8} ${60 + rnd() * 50}" stroke="#3f8f3a" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('')}
    </g>`;
  }

  function caneChair() {
    return `<path d="M574 702 L578 596 Q642 556 706 596 L710 702 Z" fill="url(#cane)" stroke="#7a5428" stroke-width="7"/>
      <rect x="556" y="694" width="172" height="24" rx="6" fill="#8a5f2f"/>
      <rect x="568" y="680" width="148" height="20" rx="8" fill="#e8dcc0"/>
      <rect x="566" y="716" width="9" height="88" fill="#6b4520"/><rect x="710" y="716" width="9" height="88" fill="#6b4520"/>`;
  }

  function sofa() {
    let s = `<rect x="1080" y="560" width="480" height="130" rx="6" fill="url(#wood)"/>`;
    for (let x = 1100; x < 1540; x += 30) s += `<rect x="${x}" y="576" width="16" height="96" rx="3" fill="#4a2913"/>`;
    const cushions = [['#d9622b', 1110], ['#5d7f3a', 1225], ['#2f7f7a', 1340], ['#b83a2a', 1450]];
    cushions.forEach(([c, x], i) => {
      s += `<g transform="rotate(${i % 2 ? 4 : -5} ${x + 50} 640)">
        <rect x="${x}" y="596" width="100" height="84" rx="16" fill="${c}"/>
        <path d="M${x + 12} 620 h76 M${x + 12} 652 h76" stroke="rgba(255,255,255,.35)" stroke-width="4" stroke-dasharray="6 6"/>
      </g>`;
    });
    s += `<rect x="1088" y="672" width="464" height="40" rx="12" fill="#efe6d2"/>
      <rect x="1070" y="708" width="500" height="22" fill="#5b3519"/>
      <rect x="1058" y="620" width="34" height="112" rx="8" fill="#6e3f1e"/>
      <rect x="1548" y="620" width="34" height="112" rx="8" fill="#6e3f1e"/>
      <rect x="1078" y="728" width="14" height="76" fill="#4a2913"/><rect x="1548" y="728" width="14" height="76" fill="#4a2913"/>`;
    return s;
  }

  function steam(x, y, scale = 1) {
    return `<g class="steam" transform="translate(${x} ${y}) scale(${scale})">
      <path d="M0 0 C-12 -20 12 -40 0 -60 S-12 -100 0 -120" style="animation-delay:${(rnd() * 3).toFixed(2)}s"/>
      <path d="M10 0 C-2 -22 22 -44 10 -66 S-2 -104 10 -126" style="animation-delay:${(rnd() * 3 + 1).toFixed(2)}s"/>
    </g>`;
  }

  function tumbler(x, base) {
    return `<path d="M${x - 16} ${base} L${x - 19} ${base - 56} L${x + 19} ${base - 56} L${x + 16} ${base} Z" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.45)" stroke-width="2"/>
      <path d="M${x - 16.5} ${base - 3} L${x - 18.5} ${base - 42} L${x + 18.5} ${base - 42} L${x + 16.5} ${base - 3} Z" fill="#a8682f"/>
      <rect x="${x - 18.5}" y="${base - 48}" width="37" height="7" rx="2" fill="#e8cfa2"/>
      ${steam(x - 3, base - 60, 0.45)}`;
  }

  function teaTable() {
    return `<rect x="760" y="730" width="260" height="16" rx="3" fill="url(#counterTop)"/>
      <rect x="772" y="746" width="236" height="16" fill="#4a2913"/>
      <rect x="778" y="760" width="12" height="80" fill="#3d210f"/><rect x="990" y="760" width="12" height="80" fill="#3d210f"/>
      <g transform="rotate(-6 830 722)">
        <rect x="772" y="708" width="130" height="24" fill="#ece4cf"/>
        <rect x="780" y="713" width="54" height="5" fill="#3b3b3b"/>
        <rect x="780" y="722" width="112" height="2" fill="#9a9384"/>
      </g>
      <ellipse cx="960" cy="728" rx="52" ry="7" fill="#c99a3c"/>
      ${tumbler(940, 728)}${tumbler(982, 728)}`;
  }

  // ---------- lights ----------
  function bulb(x, len, lit) {
    const y = 124 + len;
    return `<line x1="${x}" y1="124" x2="${x}" y2="${y}" stroke="#1b1b1b" stroke-width="2"/>
      <rect x="${x - 7}" y="${y - 4}" width="14" height="12" fill="#3a3a3a" rx="2"/>
      <circle cx="${x}" cy="${y + 20}" r="15" fill="${lit ? '#fff4cc' : '#efeadb'}" opacity="${lit ? 1 : 0.85}"/>`;
  }

  const BULBS = [[300, 120], [760, 90], [1230, 110]];

  function fairyPoints() {
    const pts = [];
    for (let x = 0; x <= 1600; x += 32) {
      const t = (x % 320) / 320;
      pts.push([x, 130 + 34 * Math.sin(Math.PI * t)]);
    }
    return pts;
  }

  function fairyString(p) {
    if (!p.lamps) return '';
    const pts = fairyPoints();
    let s = `<polyline points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#2a2a2a" stroke-width="1.5"/>`;
    pts.forEach(([x, y]) => (s += `<circle cx="${x}" cy="${y.toFixed(1) * 1 + 5}" r="3.5" fill="#ffe7a8"/>`));
    return s;
  }

  function lightLayer(p) {
    if (!p.lamps) return '';
    let s = '';
    BULBS.forEach(([x, len]) => {
      const y = 124 + len + 20;
      s += `<circle class="glow" cx="${x}" cy="${y}" r="260" fill="url(#glow)"/>
            <circle cx="${x}" cy="${y}" r="15" fill="#fff4cc"/>
            <ellipse cx="${x}" cy="800" rx="230" ry="50" fill="url(#glow)" opacity=".7"/>`;
    });
    fairyPoints().forEach(([x, y], i) => {
      s += `<circle class="amb-twinkle" cx="${x}" cy="${(y + 5).toFixed(1)}" r="16" fill="url(#fairy)"
        style="animation-delay:-${((i * 0.37) % 3).toFixed(2)}s"/>`;
    });
    return `<g style="mix-blend-mode:screen" opacity="${p.lamps}">${s}</g>`;
  }

  function shafts(p) {
    if (!p.shafts) return '';
    return `<g opacity="${p.shafts}" fill="#fff6dc">
      <polygon points="80,132 260,132 760,900 420,900"/>
      <polygon points="420,132 560,132 1120,900 860,900"/>
    </g>`;
  }

  function fireflies(p) {
    if (!p.stars) return '';
    let s = '';
    for (let i = 0; i < 16; i++) {
      s += `<circle class="amb-fly" cx="${(30 + rnd() * 800).toFixed(0)}" cy="${(380 + rnd() * 170).toFixed(0)}" r="2.5"
        fill="#d9ff8a" style="animation-delay:-${(rnd() * 6).toFixed(1)}s; animation-duration:${(4 + rnd() * 5).toFixed(1)}s"/>`;
    }
    return s;
  }

  function bokeh(p) {
    if (!p.bokeh) return '';
    let s = '';
    for (let i = 0; i < 14; i++) {
      s += `<circle class="bokeh" cx="${(900 + rnd() * 700).toFixed(0)}" cy="${(140 + rnd() * 700).toFixed(0)}" r="${(18 + rnd() * 50).toFixed(0)}"
        fill="url(#bokehG)" style="animation-delay:-${(rnd() * 12).toFixed(1)}s; animation-duration:${(10 + rnd() * 10).toFixed(1)}s"/>`;
    }
    return `<g opacity="${p.bokeh}">${s}</g>`;
  }

  // ---------- assemble ----------
  function build(phase) {
    seed = 7; // same layout every time, only colours/lights change
    const p = PHASES[phase];
    const lit = p.lamps > 0;
    return `
  <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-phase="${phase}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".55" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/>
      </linearGradient>
      <radialGradient id="halo"><stop offset="0" stop-color="${p.orb.halo}"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a26"/><stop offset="1" stop-color="#4a2913"/></linearGradient>
      <linearGradient id="pillar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a2913"/><stop offset=".4" stop-color="#7a4a26"/><stop offset="1" stop-color="#3a1d0c"/></linearGradient>
      <linearGradient id="counterTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a06a3c"/><stop offset="1" stop-color="#5b3519"/></linearGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e3f26"/><stop offset="1" stop-color="#5a2313"/></linearGradient>
      <linearGradient id="floorShine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(0,0,0,.25)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></linearGradient>
      <linearGradient id="brickShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,.35)"/><stop offset=".3" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.15)"/></linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="rgba(255,200,115,.6)"/><stop offset="1" stop-color="rgba(255,200,115,0)"/></radialGradient>
      <radialGradient id="fairy"><stop offset="0" stop-color="rgba(255,226,150,.9)"/><stop offset="1" stop-color="rgba(255,226,150,0)"/></radialGradient>
      <radialGradient id="bokehG"><stop offset="0" stop-color="rgba(255,214,150,.35)"/><stop offset="1" stop-color="rgba(255,214,150,0)"/></radialGradient>
      <pattern id="brick" width="64" height="32" patternUnits="userSpaceOnUse">
        <rect width="64" height="32" fill="#b0552f"/>
        <rect x="2" y="2" width="28" height="12" fill="#bd6238"/><rect x="34" y="18" width="28" height="12" fill="#a24b29"/>
        <rect y="15" width="64" height="2" fill="#d7a07c"/><rect y="31" width="64" height="1" fill="#d7a07c"/>
        <rect x="0" width="2" height="16" fill="#d7a07c"/><rect x="32" y="16" width="2" height="16" fill="#d7a07c"/>
      </pattern>
      <pattern id="louver" width="10" height="14" patternUnits="userSpaceOnUse">
        <rect width="10" height="14" fill="#3e1c0a"/><rect y="1" width="10" height="10" fill="#7a4220"/><rect y="1" width="10" height="3" fill="#9a5a2e"/>
      </pattern>
      <pattern id="cane" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#c9a46a"/><path d="M0 0 L8 8 M8 0 L0 8" stroke="#94723e" stroke-width="1.2"/>
      </pattern>
      <clipPath id="floorClip"><rect x="0" y="700" width="1600" height="200"/></clipPath>
    </defs>

    <!-- outside -->
    ${sky(p)}
    ${trees(p)}

    <!-- veranda -->
    ${backWall()}
    ${ceiling()}
    ${railing()}
    ${floor()}
    ${plant(70, 720, 1.1, true)}
    ${plant(480, 730, 0.9)}
    ${hangingPlant(1000)}
    ${caneChair()}
    ${sofa()}
    ${teaTable()}
    ${BULBS.map(([x, len]) => bulb(x, len, lit)).join('')}
    ${fairyString(p)}

    <!-- time-of-day tint on the veranda (the garden keeps its own colours) -->
    <path d="M0 0H1600V900H0Z M0 132H860V556H0Z" fill-rule="evenodd" fill="${p.tint}" style="mix-blend-mode:multiply"/>

    ${shafts(p)}
    ${lightLayer(p)}
    ${fireflies(p)}
    ${bokeh(p)}
  </svg>`;
  }

  // ---------- mounting & clock ----------
  const STYLE = `
    .ambience svg { transition: opacity 1.5s ease; }
    .ambience .amb-twinkle { animation: ambTwinkle 3s ease-in-out infinite; }
    .ambience .amb-fly { animation: ambFly 6s ease-in-out infinite; }
    .ambience .amb-leaves { animation: ambRustle 8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
    @keyframes ambTwinkle { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
    @keyframes ambFly { 0%,100% { transform: translate(0,0); opacity: .15 } 50% { transform: translate(14px,-18px); opacity: 1 } }
    @keyframes ambRustle { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(1deg) } }
    @media (prefers-reduced-motion: reduce) { .ambience .amb-twinkle, .ambience .amb-fly, .ambience .amb-leaves { animation: none; } }`;

  const urlPhase = new URLSearchParams(location.search).get('phase');
  let forced = PHASES[urlPhase] ? urlPhase : null;
  let current = null;
  let wrap = null;

  function render() {
    const phase = forced || phaseFor();
    if (!wrap || phase === current) return;
    current = phase;
    wrap.dataset.phase = phase;
    document.body.dataset.timeOfDay = phase; // handy if you want CSS to react too

    const holder = document.createElement('div');
    holder.innerHTML = build(phase);
    const next = holder.firstElementChild;
    const old = wrap.querySelector('svg');
    if (!old) return wrap.appendChild(next);

    // cross-fade from the old scene to the new one
    next.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0';
    wrap.appendChild(next);
    requestAnimationFrame(() => requestAnimationFrame(() => (next.style.opacity = '1')));
    setTimeout(() => { old.remove(); next.style.cssText = ''; }, 1600);
  }

  function mount() {
    if (document.querySelector('.ambience')) return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    wrap = document.createElement('div');
    wrap.className = 'ambience';
    document.body.prepend(wrap);
    render();
    setInterval(render, 60 * 1000); // check the clock every minute
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return {
    blur(on) { document.body.classList.toggle('bg-blur', !!on); },
    setPhase(name) { forced = PHASES[name] ? name : null; current = null; render(); },
    get phase() { return current; },
  };
})();