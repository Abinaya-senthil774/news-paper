// Newspaper page model + renderer.
// A page is a fixed 900 x 1400 canvas. Every element is absolutely positioned:
//   { id, type: 'text' | 'image' | 'rule', x, y, w, h, z,
//     text:  html, placeholder, font: 'headline'|'serif'|'sans', size, align, cols, italic, bold
//     image: src (data URL)
//     rule:  style: 'solid'|'double' }
const PAGE_W = 900;
const PAGE_H = 1400;

const uid = () => Math.random().toString(36).slice(2, 10);

const Template = {
  // The default broadsheet layout for a new day.
  defaultElements() {
    const T = (x, y, w, h, o) => ({ id: uid(), type: 'text', x, y, w, h, html: '', font: 'serif', size: 14, align: 'left', cols: 1, ...o });
    const R = (x, y, w, h, style = 'solid') => ({ id: uid(), type: 'rule', x, y, w, h, style });
    return [
      // Lead story
      T(28, 190, 600, 118, { font: 'headline', size: 44, placeholder: 'The Headline of Your Day Goes Right Here' }),
      T(28, 312, 600, 44, { font: 'serif', size: 17, italic: true, placeholder: 'One line that sums it all up, the way a sub-editor would.' }),
      { id: uid(), type: 'image', x: 28, y: 362, w: 600, h: 360, src: '' },
      T(28, 726, 600, 40, { font: 'sans', size: 11, placeholder: 'Caption: who, what, where. Double-click the photo box to add a picture.' }),
      R(642, 190, 1, 576),
      // Right column
      T(656, 190, 216, 112, { font: 'headline', size: 22, placeholder: 'Something Small That Made You Smile' }),
      T(656, 306, 216, 460, { size: 13.5, align: 'justify', placeholder: 'Write the story here. Who did you meet? What did you eat? What surprised you? Keep it short or let it run the whole column.' }),
      R(28, 780, 844, 4, 'double'),
      // Bottom three stories
      T(28, 798, 260, 84, { font: 'headline', size: 22, placeholder: 'Morning: How It All Began' }),
      T(28, 886, 260, 486, { size: 13.5, align: 'justify', placeholder: 'Start with the first cup of chai…' }),
      R(302, 798, 1, 574),
      T(316, 798, 260, 84, { font: 'headline', size: 22, placeholder: 'What I Learned Today' }),
      T(316, 886, 260, 486, { size: 13.5, align: 'justify', placeholder: 'A lecture, a bug fixed, a conversation…' }),
      R(590, 798, 1, 574),
      T(604, 798, 268, 84, { font: 'headline', size: 22, placeholder: "Tomorrow's Forecast" }),
      T(604, 886, 268, 486, { size: 13.5, align: 'justify', placeholder: 'Plans, hopes, and things to remember…' }),
    ];
  },

  newElement(type, x = 120, y = 220) {
    if (type === 'headline') return { id: uid(), type: 'text', x, y, w: 420, h: 90, html: '', font: 'headline', size: 32, align: 'left', cols: 1, placeholder: 'New headline' };
    if (type === 'text') return { id: uid(), type: 'text', x, y, w: 280, h: 220, html: '', font: 'serif', size: 14, align: 'left', cols: 1, placeholder: 'Write something…' };
    if (type === 'image') return { id: uid(), type: 'image', x, y, w: 320, h: 220, src: '' };
    if (type === 'rule') return { id: uid(), type: 'rule', x, y, w: 300, h: 1, style: 'solid' };
    throw new Error('Unknown element type');
  },
};

/* ---------- Sanitising (shared editors must not be able to inject scripts) ---------- */
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H3', 'H4']);
function sanitizeHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(child.tagName)) child.remove();
          else { walk(child); child.replaceWith(...child.childNodes); }
          return;
        }
        [...child.attributes].forEach((a) => child.removeAttribute(a.name));
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
const safeImageSrc = (src) => (typeof src === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) ? src : '');

/* ---------- Rendering ---------- */
function toRoman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}
function dayOfYear(d) {
  return Math.round((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

function mastheadHTML(paper, day) {
  const d = new Date(paper.year, paper.month - 1, day);
  return `<header class="np-mast">
    <div class="np-ear np-ear-l">"Every Day<br>Worth Writing Down"</div>
    <h1 class="np-title" style="font-size:${Math.round(paper.title.length <= 15 ? 76 : Math.max(36, (76 * 15) / paper.title.length))}px">${esc(paper.title)}</h1>
    <div class="np-ear np-ear-r"><b>Late Edition</b><br>Today, chai and clear skies.<br>Tonight, quiet thoughts.</div>
    <div class="np-dateline">
      <span>VOL. ${toRoman(Math.max(1, paper.year - 2000))} . . . No. ${dayOfYear(d)}</span>
      <span>${WEEKDAYS[d.getDay()].toUpperCase()}, ${MONTHS[d.getMonth()].toUpperCase()} ${day}, ${paper.year}</span>
      <span>PRICELESS</span>
    </div>
  </header>`;
}

function renderElement(e) {
  const n = document.createElement('div');
  n.className = `np-el el-${e.type}`;
  n.dataset.id = e.id;
  n.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;z-index:${e.z || 1}`;

  if (e.type === 'image') {
    const src = safeImageSrc(e.src);
    n.innerHTML = src
      ? `<img src="${src}" alt="" draggable="false">`
      : `<div class="img-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-8 7"/></svg><span>Photo</span></div>`;
  } else if (e.type === 'rule') {
    n.classList.add(`rule-${e.style || 'solid'}`);
  } else {
    const t = document.createElement('div');
    t.className = `np-text f-${e.font || 'serif'}`;
    t.style.fontSize = `${e.size || 14}px`;
    t.style.textAlign = e.align || 'left';
    if (e.cols > 1) t.style.columnCount = e.cols;
    if (e.italic) t.style.fontStyle = 'italic';
    if (e.bold) t.style.fontWeight = '700';
    if (e.placeholder) t.dataset.placeholder = e.placeholder;
    t.innerHTML = isBlankText(e.html) ? '' : sanitizeHTML(e.html);
    n.appendChild(t);
  }
  return n;
}

// Returns a .np-page element (900x1400, unscaled).
function renderPage(page, paper, { print = false } = {}) {
  const el = document.createElement('article');
  el.className = 'np-page' + (print ? ' np-print' : '');
  el.dataset.day = page.day;
  el.innerHTML = mastheadHTML(paper, page.day);
  const body = document.createElement('div');
  body.className = 'np-body';
  (page.content?.elements || []).forEach((e) => body.appendChild(renderElement(e)));
  el.appendChild(body);
  const foot = document.createElement('div');
  foot.className = 'np-foot';
  foot.textContent = `${MONTHS[paper.month - 1]} ${page.day}, ${paper.year} · ${paper.title}`;
  el.appendChild(foot);
  return el;
}

const isBlankText = (html) => !String(html || '').replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
