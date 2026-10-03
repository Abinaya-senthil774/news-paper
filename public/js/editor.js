// Edit mode: drag, resize, type, add/remove elements, images, save.
const Editor = (() => {
  let app = null;
  let draft = null; // { elements: [...] } being edited
  let selId = null;
  let dirty = false;
  let pageEl = null;
  let pendingImageFor = null; // element id waiting for a chosen file
  let toolbarBound = false;

  const find = (id) => draft.elements.find((e) => e.id === id);
  const nodeOf = (id) => pageEl && pageEl.querySelector(`.np-el[data-id="${id}"]`);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const snap = (v) => Math.round(v / 2) * 2;
  const LABELS = { text: 'Text', image: 'Photo', rule: 'Line' };

  /* ---------- lifecycle ---------- */
  function start(a) {
    app = a;
    if (!app.page || !app.canEdit || app.editing) return;
    draft = structuredClone(app.page.content || { elements: [] });
    if (!Array.isArray(draft.elements)) draft.elements = [];
    selId = null;
    setDirty(false);
    app.setEditing(true);
    requestAnimationFrame(mount);
    bindToolbar();
    updateToolbar();
    window.addEventListener('beforeunload', guard);
    document.addEventListener('keydown', onKey);
    toast('Edit mode: drag the orange tabs to move things, the corner to resize.', 'info', 3600);
  }

  function stop() {
    window.removeEventListener('beforeunload', guard);
    document.removeEventListener('keydown', onKey);
    selId = null;
    app.setEditing(false);
    app.showPage(app.index, 0);
  }

  function guard(e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  }

  function setDirty(v) {
    dirty = v;
    $('#dirtyDot').classList.toggle('hidden', !v);
  }

  /* ---------- render ---------- */
  function mount() {
    const book = $('#book');
    book.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet current';
    pageEl = renderPage({ ...app.page, content: draft }, app.paper);
    sheet.appendChild(pageEl);
    book.appendChild(sheet);
    $$('.np-el', pageEl).forEach(decorate);

    pageEl.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.np-el')) select(null);
    });
    pageEl.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); pageEl.classList.add('drop-hover'); }
    });
    pageEl.addEventListener('dragleave', () => pageEl.classList.remove('drop-hover'));
    pageEl.addEventListener('drop', onDrop);
  }

  function decorate(n) {
    const e = find(n.dataset.id);
    if (!e) return;
    const label = e.type === 'text' && e.font === 'headline' ? 'Headline' : LABELS[e.type];
    const handle = document.createElement('div');
    handle.className = 'el-handle';
    handle.innerHTML = `⠿ ${label}`;
    const resize = document.createElement('div');
    resize.className = 'el-resize';
    n.append(handle, resize);

    handle.addEventListener('pointerdown', (ev) => startDrag(ev, e, n, 'move'));
    resize.addEventListener('pointerdown', (ev) => startDrag(ev, e, n, 'resize'));
    n.addEventListener('pointerdown', () => select(e.id));

    if (e.type === 'text') {
      const t = $('.np-text', n);
      t.contentEditable = 'true';
      t.spellcheck = true;
      t.addEventListener('focus', () => select(e.id));
      t.addEventListener('input', () => {
        if (isBlankText(t.innerHTML)) t.innerHTML = '';
        e.html = t.innerHTML;
        setDirty(true);
      });
      t.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const text = ev.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    }
    if (e.type === 'image') {
      n.addEventListener('dblclick', () => pickImage(e.id));
    }
    if (e.id === selId) n.classList.add('selected');
  }

  function rerender(e) {
    const old = nodeOf(e.id);
    if (!old) return;
    const n = renderElement(e);
    old.replaceWith(n);
    decorate(n);
  }

  function apply(n, e) {
    n.style.left = `${e.x}px`;
    n.style.top = `${e.y}px`;
    n.style.width = `${e.w}px`;
    n.style.height = `${e.h}px`;
    n.style.zIndex = e.z || 1;
  }

  /* ---------- selection ---------- */
  function select(id) {
    if (selId === id) return;
    selId = id;
    $$('.np-el.selected', pageEl).forEach((x) => x.classList.remove('selected'));
    if (id) nodeOf(id)?.classList.add('selected');
    updateToolbar();
  }

  /* ---------- drag & resize ---------- */
  function startDrag(ev, e, n, mode) {
    ev.preventDefault();
    ev.stopPropagation();
    select(e.id);
    const s = app.scale();
    const sx = ev.clientX;
    const sy = ev.clientY;
    const o = { x: e.x, y: e.y, w: e.w, h: e.h };
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    n.classList.add('dragging');

    const move = (m) => {
      const dx = (m.clientX - sx) / s;
      const dy = (m.clientY - sy) / s;
      if (mode === 'move') {
        e.x = clamp(snap(o.x + dx), 20 - e.w, PAGE_W - 20);
        e.y = clamp(snap(o.y + dy), 0, PAGE_H - 10);
      } else {
        const thin = e.type === 'rule';
        e.w = clamp(snap(o.w + dx), thin ? 1 : 30, PAGE_W - e.x);
        e.h = clamp(snap(o.h + dy), thin ? 1 : 20, PAGE_H - e.y);
        if (thin && o.w <= 4 && Math.abs(dx) < 3) e.w = o.w; // keep hairline width
        if (thin && o.h <= 4 && Math.abs(dy) < 3) e.h = o.h;
      }
      apply(n, e);
      setDirty(true);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      n.classList.remove('dragging');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /* ---------- images ---------- */
  function readImage(file, max = 1400) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  function pickImage(id) {
    pendingImageFor = id;
    const input = $('#fileInput');
    input.value = '';
    input.click();
  }

  async function onFileChosen() {
    const file = $('#fileInput').files[0];
    const e = pendingImageFor && find(pendingImageFor);
    pendingImageFor = null;
    if (!file || !e) return;
    try {
      e.src = await readImage(file);
      rerender(e);
      setDirty(true);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function onDrop(ev) {
    ev.preventDefault();
    pageEl.classList.remove('drop-hover');
    const file = [...ev.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    try {
      const src = await readImage(file);
      const hit = ev.target.closest('.el-image');
      let e = hit && find(hit.dataset.id);
      if (e) {
        e.src = src;
        rerender(e);
      } else {
        const r = pageEl.getBoundingClientRect();
        const s = app.scale();
        e = Template.newElement('image', snap((ev.clientX - r.left) / s - 160), snap((ev.clientY - r.top) / s - 110));
        e.src = src;
        addElement(e);
      }
      select(e.id);
      setDirty(true);
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- element ops ---------- */
  function addElement(e) {
    e.z = Math.max(1, ...draft.elements.map((x) => x.z || 1)) + 1;
    draft.elements.push(e);
    const n = renderElement(e);
    $('.np-body', pageEl).appendChild(n);
    decorate(n);
    n.animate([{ transform: 'scale(.85)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    select(e.id);
    setDirty(true);
    if (e.type === 'text') setTimeout(() => $('.np-text', nodeOf(e.id))?.focus(), 30);
  }

  function removeSelected() {
    const e = selId && find(selId);
    if (!e) return;
    const n = nodeOf(e.id);
    draft.elements = draft.elements.filter((x) => x.id !== e.id);
    select(null);
    setDirty(true);
    n.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 160 }).onfinish = () => n.remove();
  }

  function updateSelected(fn) {
    const e = selId && find(selId);
    if (!e) return;
    fn(e);
    rerender(e);
    setDirty(true);
    updateToolbar();
  }

  /* ---------- toolbar ---------- */
  function setGroupEnabled(sel, on) {
    $$(`${sel} button, ${sel} select`).forEach((b) => (b.disabled = !on));
  }

  function updateToolbar() {
    const e = selId && draft && find(selId);
    setGroupEnabled('#textTools', e && e.type === 'text');
    setGroupEnabled('#imageTools', e && e.type === 'image');
    setGroupEnabled('#elTools', !!e);
    if (e && e.type === 'text') {
      $('#fontSel').value = e.font || 'serif';
      $('#sizeVal').textContent = e.size || 14;
      $('#alignSel').value = e.align || 'left';
      $('#colsSel').value = String(e.cols || 1);
      $('#italicBtn').classList.toggle('on', !!e.italic);
      $('#boldBtn').classList.toggle('on', !!e.bold);
    } else {
      $('#sizeVal').textContent = '–';
      $('#italicBtn').classList.remove('on');
      $('#boldBtn').classList.remove('on');
    }
  }

  // Bold/italic: format the highlighted words if there is a selection inside the box,
  // otherwise toggle it for the whole box.
  function formatInline(cmd, prop) {
    const sel = window.getSelection();
    const n = selId && nodeOf(selId);
    const t = n && $('.np-text', n);
    if (t && sel.rangeCount && !sel.isCollapsed && t.contains(sel.anchorNode)) {
      document.execCommand(cmd);
      find(selId).html = t.innerHTML;
      setDirty(true);
    } else {
      updateSelected((e) => (e[prop] = !e[prop]));
    }
  }

  function bindToolbar() {
    if (toolbarBound) return;
    toolbarBound = true;
    const tb = $('#toolbar');
    // keep text selection when clicking toolbar buttons
    tb.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

    $$('[data-add]', tb).forEach((b) =>
      b.addEventListener('click', () => {
        const n = draft.elements.length;
        const e = Template.newElement(b.dataset.add, 120 + (n % 8) * 14, 220 + (n % 8) * 14);
        addElement(e);
        if (e.type === 'image') pickImage(e.id);
      })
    );
    $('#fontSel').onchange = (ev) => updateSelected((e) => (e.font = ev.target.value));
    $('#alignSel').onchange = (ev) => updateSelected((e) => (e.align = ev.target.value));
    $('#colsSel').onchange = (ev) => updateSelected((e) => (e.cols = Number(ev.target.value)));
    $('#sizeUp').onclick = () => updateSelected((e) => (e.size = Math.min(120, (e.size || 14) + ((e.size || 14) >= 24 ? 2 : 1))));
    $('#sizeDown').onclick = () => updateSelected((e) => (e.size = Math.max(8, (e.size || 14) - ((e.size || 14) > 24 ? 2 : 1))));
    $('#boldBtn').onclick = () => formatInline('bold', 'bold');
    $('#italicBtn').onclick = () => formatInline('italic', 'italic');
    $('#replaceImg').onclick = () => selId && pickImage(selId);
    $('#fileInput').onchange = onFileChosen;
    $('#delBtn').onclick = removeSelected;
    $('#dupBtn').onclick = () => {
      const e = selId && find(selId);
      if (!e) return;
      addElement({ ...structuredClone(e), id: uid(), x: e.x + 16, y: e.y + 16 });
    };
    $('#frontBtn').onclick = () => updateSelected((e) => (e.z = Math.max(1, ...draft.elements.map((x) => x.z || 1)) + 1));
    $('#backBtn').onclick = () => {
      updateSelected((e) => {
        draft.elements.forEach((x) => (x.z = (x.z || 1) + 1));
        e.z = 1;
      });
      draft.elements.forEach((x) => { const n = nodeOf(x.id); if (n) n.style.zIndex = x.z; });
    };
    $('#zoomIn').onclick = () => { app.zoom = Math.min(3, app.zoom + 0.25); app.layout(); };
    $('#zoomOut').onclick = () => { app.zoom = Math.max(0.5, app.zoom - 0.25); app.layout(); };
    $('#zoomFit').onclick = () => { app.zoom = 1; app.layout(); };
    $('#saveBtn').onclick = () => save();
    $('#cancelBtn').onclick = async () => {
      if (dirty && !(await confirmModal('Throw away your unsaved changes?', { okText: 'Discard', danger: true }))) return;
      stop();
    };
    $('#deleteDayBtn').onclick = deleteDay;
  }

  function onKey(e) {
    if ($('.modal-back')) return;
    const typing = document.activeElement && document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (typing) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (!selId) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Escape') { select(null); return; }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const el = find(selId);
      el.x += d[0];
      el.y += d[1];
      apply(nodeOf(selId), el);
      setDirty(true);
    }
  }

  /* ---------- save / delete ---------- */
  function cleanContent() {
    return {
      elements: draft.elements.map((e) => (e.type === 'text' ? { ...e, html: isBlankText(e.html) ? '' : sanitizeHTML(e.html) } : e)),
    };
  }

  let saving = false;
  async function save(force = false) {
    if (saving || !app.editing) return;
    saving = true;
    const btn = $('#saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { page } = await API.put(`/api/pages/${app.page.id}`, {
        content: cleanContent(),
        baseUpdatedAt: app.page.updatedAt,
        force,
      });
      app.replacePage(page);
      setDirty(false);
      toast('Page saved to your shelf', 'success');
      stop();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.conflict) {
        saving = false;
        const overwrite = await confirmModal(
          `${e.data.updatedBy} saved this page while you were editing. Keep your version (theirs will be replaced), or load theirs and lose your changes?`,
          { okText: 'Keep mine', cancelText: 'Load theirs' }
        );
        if (overwrite) return save(true);
        await app.reload();
        setDirty(false);
        stop();
        toast(`Loaded the latest version from ${e.data.updatedBy}`);
      } else {
        toast(e.message, 'error');
      }
    } finally {
      saving = false;
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }

  async function deleteDay() {
    const ok = await confirmModal(`Delete ${MONTHS[app.paper.month - 1]} ${app.page.day} entirely? This can't be undone.`, { okText: 'Delete day', danger: true });
    if (!ok) return;
    try {
      await API.del(`/api/pages/${app.page.id}`);
      app.pages.splice(app.index, 1);
      app.index = Math.max(0, Math.min(app.index, app.pages.length - 1));
      setDirty(false);
      stop();
      toast('Day deleted', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  return { start };
})();
