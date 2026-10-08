// Newspaper reader: page turning, day navigation, add day, sharing, renaming.
const App = {
  user: null,
  paper: null,
  pages: [],
  reactionChoices: ['❤️', '😂', '😮', '😢', '👏', '☕'],
  index: 0,
  zoom: 1,
  editing: false,
  busy: false,
  get page() { return this.pages[this.index]; },
  get canEdit() { return this.paper && (this.paper.role === 'owner' || this.paper.role === 'edit'); },
  get daysInMonth() { return new Date(this.paper.year, this.paper.month, 0).getDate(); },
  scale() { return parseFloat($('#book').style.getPropertyValue('--s')) || 1; },
};

App.load = async function (id) {
  const data = await API.get(`/api/papers/${id || 0}`);
  this.paper = data.paper;
  this.pages = data.pages.sort((a, b) => a.day - b.day);
  if (Array.isArray(data.reactionChoices)) this.reactionChoices = data.reactionChoices;
};

App.reload = async function () {
  const day = this.page?.day;
  await this.load(this.paper.id);
  const i = this.pages.findIndex((p) => p.day === day);
  this.index = i >= 0 ? i : Math.max(0, this.pages.length - 1);
};

App.setupHeader = function () {
  const p = this.paper;
  document.title = `${p.title} · ${MONTHS[p.month - 1]} ${p.year}`;
  $('#paperTitle').textContent = p.title;
  $('#paperTitle').classList.toggle('renamable', this.canEdit);
  const badge = $('#roleBadge');
  badge.className = `badge ${p.role}`;
  badge.textContent = p.role === 'owner' ? 'Owner' : p.role === 'edit' ? 'Can edit' : 'View only';
  $('#addDayBtn').classList.toggle('hidden', !this.canEdit);
  $('#shareBtn').classList.toggle('hidden', p.role !== 'owner');
  this.updateMeta();
};

App.updateMeta = function () {
  const p = this.paper;
  const pg = this.page;
  let sub = `${MONTHS[p.month - 1]} ${p.year}`;
  if (p.role !== 'owner') sub += ` · by @${p.ownerUsername}`;
  if (pg) sub += ` · Day ${pg.day}` + (pg.updatedBy ? ` · last edited by ${pg.updatedBy}` : '');
  $('#paperSub').textContent = sub;
  $('#editBtn').classList.toggle('hidden', !this.canEdit || !pg);
  this.renderReactions();
};

/* ---------- Reactions ---------- */
App.renderReactions = function () {
  const bar = $('#reactBar');
  const pg = this.page;
  const r = pg && pg.reactions ? pg.reactions : { counts: {}, mine: null, people: [] };
  const isOwner = this.paper.role === 'owner';
  const total = r.people.length;
  // Owners see what readers felt (if anyone reacted). Readers get buttons to react.
  if (!pg || this.editing || (isOwner && !total)) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const names = r.people.map((p) => p.name);
  const who = total
    ? `<button class="react-who" data-who>${esc(names.slice(0, 2).join(', '))}${total > 2 ? ` +${total - 2}` : ''}</button>`
    : '<span class="react-hint">How did this day make you feel?</span>';
  const chips = this.reactionChoices
    .filter((e) => !isOwner || r.counts[e])
    .map((e) => {
      const c = r.counts[e] || 0;
      return `<button class="react-chip ${r.mine === e ? 'mine' : ''}" data-emoji="${e}" ${isOwner ? 'disabled' : ''} aria-pressed="${r.mine === e}" title="${isOwner ? '' : r.mine === e ? 'Remove your reaction' : 'React'}">
        <span class="e">${e}</span>${c ? `<span class="c">${c}</span>` : ''}</button>`;
    })
    .join('');
  bar.innerHTML = `<div class="react-inner">${isOwner ? '<span class="react-label">Readers felt</span>' : ''}${chips}${who}</div>`;
};

App.react = async function (emoji) {
  const pg = this.page;
  if (!pg || this.paper.role === 'owner') return;
  const prev = pg.reactions;
  const removing = prev && prev.mine === emoji;
  try {
    const { reactions } = removing
      ? await API.del(`/api/pages/${pg.id}/reaction`)
      : await API.put(`/api/pages/${pg.id}/reaction`, { emoji });
    pg.reactions = reactions;
    this.renderReactions();
    if (!removing) {
      const chip = $(`.react-chip[data-emoji="${emoji}"] .e`, $('#reactBar'));
      chip?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6) rotate(-10deg)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.4,.4,1)' });
      toast(`Sent ${emoji} to ${this.paper.ownerName}`, 'success', 1800);
    }
  } catch (e) { toast(e.message, 'error'); }
};

App.showReactors = function () {
  const r = this.page?.reactions;
  if (!r || !r.people.length) return;
  openModal(
    `<h2>Reactions</h2>
     <p class="sub">${MONTHS[this.paper.month - 1]} ${this.page.day}</p>
     <ul class="share-list">${r.people.map((p) => `<li><span class="avatar">${esc((p.name || p.username || '?')[0].toUpperCase())}</span>
       <span class="who"><b>${esc(p.name)}</b><small>@${esc(p.username)}</small></span><span class="react-big">${esc(p.emoji)}</span></li>`).join('')}</ul>`
  );
};

/* ---------- More menu: rename, delete, leave ---------- */
App.openMore = function () {
  const p = this.paper;
  const small = window.matchMedia('(max-width: 760px)').matches;
  openMenu($('#moreBtn'), [
    small && p.role === 'owner' && { label: 'Share with people', onClick: () => this.openShare() },
    small && { label: 'Download / share PDF', onClick: () => PdfExport.open(this) },
    this.canEdit && { label: 'Rename newspaper', onClick: () => this.openRename() },
    p.role === 'owner' && { label: 'Delete this newspaper', danger: true, onClick: () => this.deletePaper() },
    p.role !== 'owner' && { label: 'Remove from my shelf', danger: true, onClick: () => this.leavePaper() },
  ]);
};

App.deletePaper = async function () {
  const p = this.paper;
  const n = this.pages.length;
  const ok = await confirmModal(`Delete "${p.title}" for ${MONTHS[p.month - 1]} ${p.year}? All ${n} ${n === 1 ? 'day' : 'days'} will be gone for good, for everyone it's shared with.`, { okText: 'Delete newspaper', danger: true });
  if (!ok) return;
  try {
    await API.del(`/api/papers/${p.id}`);
    toast('Newspaper deleted', 'success');
    setTimeout(() => (location.href = '/shelf'), 500);
  } catch (e) { toast(e.message, 'error'); }
};

App.leavePaper = async function () {
  const p = this.paper;
  const ok = await confirmModal(`Remove "${p.title}" from your shelf? @${p.ownerUsername} would have to share it with you again.`, { okText: 'Remove', danger: true });
  if (!ok || !this.user) return;
  try {
    await API.del(`/api/papers/${p.id}/shares/${this.user.id}`);
    location.href = '/shelf';
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------- Double-tap / double-click to zoom while reading ---------- */
App.toggleReadZoom = function (clientX, clientY) {
  if (this.editing) return;
  const wrap = $('#bookWrap');
  const book = $('#book');
  const r = book.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const fy = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
  const w = wrap.getBoundingClientRect();
  this.zoom = this.zoom > 1 ? 1 : 2.4;
  this.layout();
  wrap.classList.toggle('zoomed', this.zoom > 1);
  wrap.scrollLeft = book.offsetLeft + fx * book.offsetWidth - (clientX - w.left);
  wrap.scrollTop = book.offsetTop + fy * book.offsetHeight - (clientY - w.top);
};

App.resetReadZoom = function () {
  if (this.zoom === 1) return;
  this.zoom = 1;
  $('#bookWrap').classList.remove('zoomed');
  this.layout();
};

/* ---------- Layout / scaling ---------- */
App.layout = function () {
  const wrap = $('#bookWrap');
  const availW = wrap.clientWidth - 20;
  const availH = wrap.clientHeight - 36;
  const fit = Math.max(0.15, Math.min(availW / PAGE_W, availH / PAGE_H));
  const s = fit * this.zoom;
  const book = $('#book');
  book.style.width = `${PAGE_W * s}px`;
  book.style.height = `${PAGE_H * s}px`;
  book.style.setProperty('--s', s);
};

/* ---------- Pages ---------- */
App.makeSheet = function (page) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  if (page) {
    sheet.appendChild(renderPage(page, this.paper));
  } else {
    sheet.innerHTML = `<div class="empty-paper">
      <h2>${esc(this.paper.title)}</h2>
      <p>${MONTHS[this.paper.month - 1]} ${this.paper.year}. Not a single day written yet.</p>
      ${this.canEdit ? '<div><button class="btn btn-primary" id="emptyAdd">+ Write your first day</button></div>' : '<p>Check back once the owner adds a page.</p>'}
    </div>`;
    $('#emptyAdd', sheet)?.addEventListener('click', () => this.openAddDay());
  }
  return sheet;
};

// dir: +1 next (current page turns away), -1 previous (page turns back in), 0 no animation
App.showPage = function (i, dir = 0, opening = false) {
  if (!this.editing) this.resetReadZoom();
  const book = $('#book');
  const old = $('.sheet.current', book);
  this.index = i;
  const sheet = this.makeSheet(this.pages[i]);
  sheet.classList.add('current');

  if (!old || !dir) {
    book.innerHTML = '';
    book.appendChild(sheet);
    if (opening) {
      book.classList.add('opening');
      setTimeout(() => book.classList.remove('opening'), 950);
    }
  } else if (dir > 0) {
    book.insertBefore(sheet, old);
    old.classList.remove('current');
    old.classList.add('flip-out-next');
    this.busy = true;
    const done = (e) => {
      if (e.target !== old || e.pseudoElement) return;
      old.removeEventListener('animationend', done);
      old.remove();
      this.busy = false;
    };
    old.addEventListener('animationend', done);
  } else {
    book.appendChild(sheet);
    old.classList.remove('current');
    sheet.classList.add('flip-in-prev');
    this.busy = true;
    const done = (e) => {
      if (e.target !== sheet || e.pseudoElement) return;
      sheet.removeEventListener('animationend', done);
      sheet.classList.remove('flip-in-prev');
      old.remove();
      this.busy = false;
    };
    sheet.addEventListener('animationend', done);
  }

  this.renderStrip();
  this.updateNav();
  this.updateMeta();
  const url = new URL(location.href);
  if (this.page) url.searchParams.set('day', this.page.day); else url.searchParams.delete('day');
  history.replaceState(null, '', url);
};

App.go = function (delta) {
  if (this.editing || this.busy) return;
  const i = this.index + delta;
  if (i < 0 || i >= this.pages.length) return;
  this.showPage(i, delta);
};

App.goToDay = function (day) {
  if (this.editing || this.busy) return;
  const i = this.pages.findIndex((p) => p.day === day);
  if (i < 0 || i === this.index) return;
  this.showPage(i, i > this.index ? 1 : -1);
};

App.updateNav = function () {
  $('#prevBtn').disabled = this.index <= 0;
  $('#nextBtn').disabled = this.index >= this.pages.length - 1;
};

App.renderStrip = function () {
  const has = new Set(this.pages.map((p) => p.day));
  const cur = this.page?.day;
  let html = '';
  for (let d = 1; d <= this.daysInMonth; d++) {
    html += `<button class="day-chip ${has.has(d) ? 'has' : ''} ${d === cur ? 'current' : ''}" data-day="${d}" ${has.has(d) ? '' : 'disabled'} title="${MONTHS[this.paper.month - 1]} ${d}">${d}</button>`;
  }
  const strip = $('#dayStrip');
  strip.innerHTML = html;
  $('.day-chip.current', strip)?.scrollIntoView({ block: 'nearest', inline: 'center' });
};

App.replacePage = function (page) {
  const i = this.pages.findIndex((p) => p.id === page.id);
  if (i >= 0) this.pages[i] = { reactions: this.pages[i].reactions, ...page };
};

App.setEditing = function (on) {
  this.editing = on;
  $('#book').classList.toggle('editing', on);
  $('#toolbar').classList.toggle('hidden', !on);
  $('#viewActions').classList.toggle('hidden', on);
  $('#editActions').classList.toggle('hidden', !on);
  $('#prevBtn').classList.toggle('hidden', on);
  $('#nextBtn').classList.toggle('hidden', on);
  $('#dayStrip').classList.toggle('hidden', on);
  $('#bookWrap').classList.remove('zoomed');
  this.zoom = 1;
  this.renderReactions();
  requestAnimationFrame(() => this.layout());
};

/* ---------- Add a day ---------- */
App.openAddDay = function () {
  const p = this.paper;
  const has = new Set(this.pages.map((x) => x.day));
  const first = new Date(p.year, p.month - 1, 1).getDay();
  const now = new Date();
  const today = now.getFullYear() === p.year && now.getMonth() + 1 === p.month ? now.getDate() : -1;
  let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => `<div class="wd">${w}</div>`).join('');
  cells += '<div></div>'.repeat(first);
  for (let d = 1; d <= this.daysInMonth; d++) {
    cells += `<button data-day="${d}" class="${d === today ? 'today' : ''}" ${has.has(d) ? 'disabled title="Already written"' : ''}>${d}</button>`;
  }
  openModal(
    `<h2>Add a day</h2>
     <p class="sub">${MONTHS[p.month - 1]} ${p.year}. Pick a day to print a fresh page for it.</p>
     <div class="day-grid">${cells}</div>`,
    {
      onOpen: (m, close) => {
        $$('.day-grid button', m).forEach((b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              const day = Number(b.dataset.day);
              const { page } = await API.post(`/api/papers/${p.id}/pages`, { day, content: { elements: Template.defaultElements() } });
              close();
              this.pages.push(page);
              this.pages.sort((a, c) => a.day - c.day);
              const i = this.pages.findIndex((x) => x.id === page.id);
              const dir = this.pages.length === 1 ? 0 : i > this.index ? 1 : -1;
              this.showPage(i, dir);
              toast(`${MONTHS[p.month - 1]} ${day} added. Start writing!`, 'success');
              setTimeout(() => Editor.start(this), dir ? 800 : 50);
            } catch (e) {
              toast(e.message, 'error');
              b.disabled = false;
            }
          })
        );
      },
    }
  );
};

/* ---------- Sharing (owner only) ---------- */
App.openShare = function () {
  const p = this.paper;
  const row = (s) => `<li data-uid="${s.id}">
      <span class="avatar">${esc((s.displayName || s.username)[0].toUpperCase())}</span>
      <span class="who"><b>${esc(s.displayName)}</b><small>@${esc(s.username)}</small></span>
      <select class="input" data-role><option value="view" ${s.role === 'view' ? 'selected' : ''}>Can view</option><option value="edit" ${s.role === 'edit' ? 'selected' : ''}>Can edit</option></select>
      <button class="icon-btn" style="color:#7a2b20;border-color:rgba(0,0,0,.12)" data-remove title="Remove">&times;</button>
    </li>`;
  openModal(
    `<h2>Share this newspaper</h2>
     <p class="sub">People you add will find it under “Shared with me” on their shelf. Viewers can read and download; editors can also write.</p>
     <form class="share-form" id="shareForm">
       <input class="input" name="username" placeholder="Their username, e.g. akshath" required autocomplete="off"/>
       <select class="input" name="role"><option value="view">Can view</option><option value="edit">Can edit</option></select>
       <button class="btn btn-primary" type="submit">Add</button>
     </form>
     <ul class="share-list" id="shareList"><li>Loading…</li></ul>`,
    {
      onOpen: async (m) => {
        const list = $('#shareList', m);
        const draw = (shares) => {
          list.innerHTML = shares.length ? shares.map(row).join('') : '<li style="justify-content:center;color:#7a6f5c">Only you can see this newspaper right now.</li>';
        };
        try { draw((await API.get(`/api/papers/${p.id}/shares`)).shares); } catch (e) { toast(e.message, 'error'); }

        $('#shareForm', m).onsubmit = async (e) => {
          e.preventDefault();
          const f = e.target;
          try {
            const { shares } = await API.post(`/api/papers/${p.id}/shares`, { username: f.username.value, role: f.role.value });
            draw(shares);
            toast(`Shared with @${f.username.value.replace(/^@/, '')}`, 'success');
            f.username.value = '';
          } catch (ex) { toast(ex.message, 'error'); }
        };
        list.addEventListener('change', async (e) => {
          const li = e.target.closest('li[data-uid]');
          if (!li || !e.target.matches('[data-role]')) return;
          const username = $('.who small', li).textContent.slice(1);
          try { draw((await API.post(`/api/papers/${p.id}/shares`, { username, role: e.target.value })).shares); toast('Access updated', 'success'); }
          catch (ex) { toast(ex.message, 'error'); }
        });
        list.addEventListener('click', async (e) => {
          const li = e.target.closest('li[data-uid]');
          if (!li || !e.target.closest('[data-remove]')) return;
          try { draw((await API.del(`/api/papers/${p.id}/shares/${li.dataset.uid}`)).shares); toast('Removed', 'success'); }
          catch (ex) { toast(ex.message, 'error'); }
        });
      },
    }
  );
};

App.openRename = function () {
  if (!this.canEdit || this.editing) return;
  openModal(
    `<h2>Rename newspaper</h2>
     <form id="renameForm">
       <label class="field"><span>Name on the masthead</span><input class="input" name="title" maxlength="60" value="${esc(this.paper.title)}"/></label>
       <div class="modal-actions"><button class="btn btn-primary" type="submit">Save name</button></div>
     </form>`,
    {
      onOpen: (m, close) => {
        $('#renameForm', m).onsubmit = async (e) => {
          e.preventDefault();
          try {
            const { title } = await API.patch(`/api/papers/${this.paper.id}`, { title: e.target.title.value });
            this.paper.title = title;
            close();
            this.setupHeader();
            this.showPage(this.index, 0);
            toast('Masthead updated', 'success');
          } catch (ex) { toast(ex.message, 'error'); }
        };
      },
    }
  );
};

/* ---------- Events ---------- */
App.bindEvents = function () {
  $('#prevBtn').onclick = () => this.go(-1);
  $('#nextBtn').onclick = () => this.go(1);
  $('#dayStrip').onclick = (e) => {
    const b = e.target.closest('.day-chip.has');
    if (b) this.goToDay(Number(b.dataset.day));
  };
  $('#addDayBtn').onclick = () => this.openAddDay();
  $('#editBtn').onclick = () => Editor.start(this);
  $('#shareBtn').onclick = () => this.openShare();
  $('#pdfBtn').onclick = () => PdfExport.open(this);
  $('#paperTitle').onclick = () => this.openRename();
  $('#moreBtn').onclick = () => this.openMore();
  $('#reactBar').onclick = (e) => {
    if (e.target.closest('[data-who]')) return this.showReactors();
    const chip = e.target.closest('.react-chip');
    if (chip && !chip.disabled) this.react(chip.dataset.emoji);
  };

  document.addEventListener('keydown', (e) => {
    if (this.editing || $('.modal-back')) return;
    if (e.key === 'ArrowRight') this.go(1);
    if (e.key === 'ArrowLeft') this.go(-1);
  });

  // Touch: swipe to turn pages (when not zoomed), double-tap to zoom in/out.
  let tx = null;
  let ty = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  const wrap = $('#bookWrap');
  wrap.addEventListener('touchstart', (e) => {
    if (this.editing || e.touches.length !== 1) { tx = null; return; }
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (tx === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tx;
    const dy = t.clientY - ty;
    tx = null;
    if (this.zoom === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lastTap.t = 0;
      return this.go(dx < 0 ? 1 : -1);
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = Date.now();
      if (now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40) {
        lastTap.t = 0;
        e.preventDefault();
        this.toggleReadZoom(t.clientX, t.clientY);
      } else {
        lastTap = { t: now, x: t.clientX, y: t.clientY };
      }
    }
  });
  let lastPointer = 'mouse';
  wrap.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true);
  wrap.addEventListener('dblclick', (e) => {
    if (lastPointer === 'mouse' && !this.editing) this.toggleReadZoom(e.clientX, e.clientY);
  });

  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this.layout(), 80); });
};

/* ---------- Boot ---------- */
(async () => {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  try {
    App.user = await requireUser();
    await App.load(id);
  } catch (e) {
    toast(e.message || 'Could not open that newspaper', 'error');
    setTimeout(() => (location.href = '/shelf'), 1500);
    return;
  }
  Ambience.blur(true);
  App.setupHeader();

  // Start on ?day=, else today (if it's this month), else the latest day.
  const wanted = Number(params.get('day'));
  const now = new Date();
  const today = now.getFullYear() === App.paper.year && now.getMonth() + 1 === App.paper.month ? now.getDate() : null;
  let start = App.pages.findIndex((p) => p.day === wanted);
  if (start < 0 && today) start = App.pages.findIndex((p) => p.day === today);
  if (start < 0) start = App.pages.length - 1;
  App.index = Math.max(0, start);

  App.layout();
  App.showPage(App.index, 0, true);
  App.bindEvents();
  Bell.mount($('#topTools'));

  // One-time tip for phones: the page is big, so show how to zoom.
  if (window.matchMedia('(pointer: coarse)').matches && App.pages.length) {
    let seen = false;
    try { seen = localStorage.getItem('tip-zoom') === '1'; localStorage.setItem('tip-zoom', '1'); } catch { /* storage blocked */ }
    if (!seen) setTimeout(() => toast('Tip: double-tap the page to zoom in, swipe to turn pages', 'info', 4200), 1200);
  }
})();
