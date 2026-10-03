// Draws an Indian roadside tea-stall scene as the page background (pure SVG, no images).
// Call Ambience.blur(true) to soften it when a newspaper is open.
const Ambience = (() => {
  // Small seeded random so the scene looks the same on every load
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  function steam(x, y, scale = 1) {
    return `<g class="steam" transform="translate(${x} ${y}) scale(${scale})">
      <path d="M0 0 C-12 -20 12 -40 0 -60 S-12 -100 0 -120" style="animation-delay:${(rnd() * 3).toFixed(2)}s"/>
      <path d="M10 0 C-2 -22 22 -44 10 -66 S-2 -104 10 -126" style="animation-delay:${(rnd() * 3 + 1).toFixed(2)}s"/>
    </g>`;
  }

  function garland() {
    let s = '';
    for (let x = 0; x <= 1600; x += 16) {
      const y = 84 + 26 * Math.sin((Math.PI * (x % 400)) / 400);
      const color = pick(['#f39c12', '#f5b041', '#e67e22', '#f8c471']);
      s += `<circle cx="${x}" cy="${y.toFixed(1)}" r="8" fill="${color}"/>`;
      if (x % 400 === 192) s += `<path d="M${x} ${y + 6} q-6 18 0 30 q6 -12 0 -30" fill="#3f8f3a"/>`;
    }
    return `<g class="garland">${s}</g>`;
  }

  function bulb(x) {
    return `<g class="bulb">
      <line x1="${x}" y1="74" x2="${x}" y2="168" stroke="#1b1b1b" stroke-width="2"/>
      <circle class="glow" cx="${x}" cy="186" r="240" fill="url(#glow)"/>
      <rect x="${x - 7}" y="164" width="14" height="12" fill="#3a3a3a" rx="2"/>
      <circle cx="${x}" cy="188" r="15" fill="#fff4cc"/>
    </g>`;
  }

  function jarShelf(y) {
    let s = `<rect x="60" y="${y}" width="420" height="14" fill="url(#wood)"/>
             <rect x="60" y="${y + 14}" width="420" height="6" fill="rgba(0,0,0,.35)"/>`;
    const fills = ['#d98a2b', '#c0692b', '#e8c07a', '#b84a2a', '#f1d59a'];
    const lids = ['#c0392b', '#2e6fb5', '#e0b528', '#2f8f5b', '#c0392b'];
    for (let i = 0; i < 5; i++) {
      const x = 76 + i * 80;
      s += `<rect x="${x + 4}" y="${y - 58}" width="54" height="56" rx="9" fill="${fills[(i + y) % 5]}"/>`;
      for (let k = 0; k < 4; k++)
        s += `<circle cx="${x + 14 + rnd() * 34}" cy="${y - 48 + rnd() * 40}" r="${4 + rnd() * 4}" fill="rgba(255,255,255,.18)"/>`;
      s += `<rect x="${x}" y="${y - 88}" width="62" height="88" rx="12" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.3)" stroke-width="2"/>
            <rect x="${x + 2}" y="${y - 100}" width="58" height="14" rx="3" fill="${lids[(i + 1) % 5]}"/>
            <rect x="${x + 10}" y="${y - 80}" width="6" height="60" rx="3" fill="rgba(255,255,255,.22)"/>`;
    }
    return s;
  }

  function packets() {
    const colors = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#ff6f91'];
    let s = '';
    for (let j = 0; j < 8; j++) {
      const x = 1150 + j * 56;
      let g = `<line x1="${x}" y1="74" x2="${x}" y2="${74 + 6 * 52}" stroke="#d8d2c4" stroke-width="1.5"/>`;
      for (let i = 0; i < 6; i++) {
        const c = pick(colors);
        const py = 90 + i * 52;
        const rot = (rnd() * 10 - 5).toFixed(1);
        g += `<g transform="rotate(${rot} ${x} ${py})">
          <rect x="${x - 20}" y="${py}" width="40" height="46" rx="3" fill="${c}"/>
          <rect x="${x - 20}" y="${py + 16}" width="40" height="12" fill="rgba(255,255,255,.75)"/>
          <rect x="${x - 20}" y="${py}" width="40" height="5" fill="rgba(0,0,0,.2)"/></g>`;
      }
      s += `<g class="sway" style="animation-delay:-${(rnd() * 4).toFixed(2)}s; transform-origin:${x}px 74px">${g}</g>`;
    }
    return s;
  }

  function bananas() {
    let s = `<line x1="560" y1="74" x2="560" y2="196" stroke="#cbbf9a" stroke-width="2"/>`;
    for (let k = 0; k < 7; k++) {
      const d = k - 3;
      s += `<ellipse cx="${560 + d * 9}" cy="${236 + Math.abs(d) * 4}" rx="10" ry="40" transform="rotate(${d * 13} 560 200)" fill="#e9c235" stroke="#a78a1f" stroke-width="1.5"/>`;
    }
    return `<g class="sway" style="transform-origin:560px 74px">${s}<rect x="552" y="190" width="16" height="14" rx="3" fill="#6b5a2a"/></g>`;
  }

  function tumbler(x) {
    return `<path d="M${x - 20} 672 L${x - 24} 600 L${x + 24} 600 L${x + 20} 672 Z" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
      <path d="M${x - 20.5} 668 L${x - 23} 620 L${x + 23} 620 L${x + 20.5} 668 Z" fill="#a8682f"/>
      <rect x="${x - 23}" y="613" width="46" height="9" rx="2" fill="#e8cfa2"/>
      ${steam(x - 4, 596, 0.55)}`;
  }

  function bokeh() {
    let s = '';
    for (let i = 0; i < 20; i++) {
      s += `<circle class="bokeh" cx="${(rnd() * 1600).toFixed(0)}" cy="${(rnd() * 900).toFixed(0)}" r="${(18 + rnd() * 60).toFixed(0)}"
        fill="url(#bokehG)" style="animation-delay:-${(rnd() * 12).toFixed(1)}s; animation-duration:${(10 + rnd() * 10).toFixed(1)}s"/>`;
    }
    return s;
  }

  function counterLines() {
    let s = '';
    for (let x = 0; x <= 1600; x += 160) s += `<line x1="${x}" y1="696" x2="${x}" y2="900" stroke="rgba(0,0,0,.28)" stroke-width="3"/>`;
    return s;
  }

  const svg = `
  <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3519"/><stop offset="1" stop-color="#2a170b"/></linearGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a26"/><stop offset="1" stop-color="#4a2913"/></linearGradient>
      <linearGradient id="counterTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a06a3c"/><stop offset="1" stop-color="#5b3519"/></linearGradient>
      <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f959b"/><stop offset=".45" stop-color="#eef1f3"/><stop offset="1" stop-color="#7d8389"/></linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="rgba(255,200,115,.6)"/><stop offset="1" stop-color="rgba(255,200,115,0)"/></radialGradient>
      <radialGradient id="bokehG"><stop offset="0" stop-color="rgba(255,214,150,.35)"/><stop offset="1" stop-color="rgba(255,214,150,0)"/></radialGradient>
      <pattern id="tin" width="36" height="74" patternUnits="userSpaceOnUse">
        <rect width="18" height="74" fill="#74777b"/><rect x="18" width="18" height="74" fill="#55585c"/>
      </pattern>
      <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>

    <rect width="1600" height="900" fill="url(#wall)"/>
    <rect x="0" y="0" width="1600" height="70" fill="url(#tin)"/>
    <rect x="0" y="66" width="1600" height="8" fill="#26262a"/>

    <g transform="translate(560 120)">
      <rect width="480" height="118" rx="6" fill="#a8321b" stroke="#f0c75e" stroke-width="4"/>
      <text x="240" y="58" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="40" fill="#f6d77b" letter-spacing="3">SRI MURUGAN</text>
      <text x="240" y="96" text-anchor="middle" font-family="Georgia, serif" font-size="21" fill="#fbe7b0" letter-spacing="6">TEA · COFFEE · SNACKS</text>
    </g>

    ${jarShelf(340)}
    ${jarShelf(480)}
    ${bananas()}
    ${packets()}
    ${garland()}
    ${bulb(300)}${bulb(820)}${bulb(1320)}

    <!-- counter -->
    <rect x="0" y="690" width="1600" height="210" fill="url(#wood)"/>
    ${counterLines()}
    <rect x="0" y="672" width="1600" height="24" fill="url(#counterTop)"/>

    <!-- a folded newspaper on the counter -->
    <g transform="rotate(-5 260 655)">
      <rect x="150" y="632" width="230" height="44" fill="#ece4cf"/>
      <rect x="162" y="640" width="90" height="7" fill="#3b3b3b"/>
      <rect x="162" y="652" width="200" height="3" fill="#9a9384"/>
      <rect x="162" y="660" width="200" height="3" fill="#9a9384"/>
      <rect x="162" y="668" width="140" height="3" fill="#9a9384"/>
    </g>

    ${[440, 510, 580, 650, 720].map(tumbler).join('')}

    <!-- stove + kettle -->
    <rect x="1010" y="640" width="210" height="34" rx="4" fill="#1f1f1f"/>
    <ellipse class="flame" cx="1115" cy="640" rx="60" ry="7" fill="#4aa3ff" opacity=".7"/>
    <path d="M1045 640 Q1032 560 1082 540 L1142 540 Q1192 560 1180 640 Z" fill="url(#steel)"/>
    <ellipse cx="1112" cy="540" rx="36" ry="8" fill="#c9cdd1"/>
    <circle cx="1112" cy="530" r="7" fill="#2b2b2b"/>
    <path d="M1180 600 Q1216 590 1232 552 L1243 557 Q1228 606 1182 622 Z" fill="url(#steel)"/>
    <path d="M1060 552 Q1112 470 1164 552" fill="none" stroke="#2b2b2b" stroke-width="7" stroke-linecap="round"/>
    ${steam(1236, 545, 1)}
    ${steam(1112, 520, 0.8)}

    ${bokeh()}
  </svg>`;

  function mount() {
    if (document.querySelector('.ambience')) return;
    const wrap = document.createElement('div');
    wrap.className = 'ambience';
    wrap.innerHTML = svg;
    document.body.prepend(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return {
    blur(on) { document.body.classList.toggle('bg-blur', !!on); },
  };
})();
