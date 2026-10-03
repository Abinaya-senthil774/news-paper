// Export selected pages as a PDF (download or native share).
const PdfExport = (() => {
  const slug = (s) => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'newspaper';

  function fileName(paper, pages) {
    const base = `${slug(paper.title)}-${MONTHS[paper.month - 1]}-${paper.year}`;
    if (pages.length === 1) return `${base}-day-${pages[0].day}.pdf`;
    return `${base}.pdf`;
  }

  async function waitForImages(el) {
    await Promise.all(
      $$('img', el).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {})))
    );
  }

  async function build(paper, pages, onProgress) {
    if (!window.jspdf || !window.html2canvas) throw new Error('PDF tools are still loading, try again in a second');
    await document.fonts.ready;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', format: [PAGE_W, PAGE_H], orientation: 'portrait', hotfixes: ['px_scaling'], compress: true });
    const host = document.createElement('div');
    host.className = 'render-host';
    document.body.appendChild(host);
    try {
      for (let i = 0; i < pages.length; i++) {
        const el = renderPage(pages[i], paper, { print: true });
        host.innerHTML = '';
        host.appendChild(el);
        await waitForImages(el);
        const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#f7f3e8', logging: false, width: PAGE_W, height: PAGE_H });
        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, PAGE_W, PAGE_H);
        onProgress((i + 1) / pages.length);
      }
    } finally {
      host.remove();
    }
    return pdf.output('blob');
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function open(app) {
    const { paper, pages } = app;
    if (!pages.length) return toast('There are no pages to export yet');
    const picked = new Set([app.page.id]);
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));

    openModal(
      `<h2>Download &amp; share</h2>
       <p class="sub">Pick the pages you want. One page, a few, or the whole month.</p>
       <div class="select-row">
         <button class="btn btn-ghost btn-sm" data-pick="all">All</button>
         <button class="btn btn-ghost btn-sm" data-pick="none">None</button>
         <button class="btn btn-ghost btn-sm" data-pick="current">Just this day</button>
         <span style="flex:1"></span><b id="pickCount"></b>
       </div>
       <div class="thumb-grid" id="thumbs"></div>
       <div class="progress hidden" id="prog"><i></i></div>
       <div class="modal-actions">
         ${canShareFiles ? '<button class="btn btn-ghost" id="sharePdf">Share…</button>' : ''}
         <button class="btn btn-primary" id="dlPdf">Download PDF</button>
       </div>`,
      {
        wide: true,
        onOpen(m) {
          const grid = $('#thumbs', m);
          pages.forEach((p) => {
            const t = document.createElement('div');
            t.className = 'thumb';
            t.dataset.id = p.id;
            t.innerHTML = `<div class="mini"></div><span class="tick">✓</span><div class="lbl">${MONTHS[paper.month - 1].slice(0, 3)} ${p.day}</div>`;
            $('.mini', t).appendChild(renderPage(p, paper, { print: true }));
            t.onclick = () => { picked.has(p.id) ? picked.delete(p.id) : picked.add(p.id); sync(); };
            grid.appendChild(t);
          });

          const sync = () => {
            $$('.thumb', grid).forEach((t) => t.classList.toggle('picked', picked.has(Number(t.dataset.id))));
            $('#pickCount', m).textContent = `${picked.size} selected`;
            $('#dlPdf', m).disabled = !picked.size;
            if ($('#sharePdf', m)) $('#sharePdf', m).disabled = !picked.size;
          };
          $$('[data-pick]', m).forEach((b) =>
            (b.onclick = () => {
              picked.clear();
              if (b.dataset.pick === 'all') pages.forEach((p) => picked.add(p.id));
              if (b.dataset.pick === 'current') picked.add(app.page.id);
              sync();
            })
          );
          sync();
          $('.thumb.picked', grid)?.scrollIntoView({ block: 'nearest' });

          let cached = null; // { key, blob, name }
          const prog = $('#prog', m);
          const make = async () => {
            const chosen = pages.filter((p) => picked.has(p.id));
            const key = chosen.map((p) => `${p.id}:${p.updatedAt}`).join('|');
            if (cached && cached.key === key) return cached;
            prog.classList.remove('hidden');
            $('i', prog).style.width = '3%';
            const blob = await build(paper, chosen, (f) => ($('i', prog).style.width = `${Math.round(f * 100)}%`));
            cached = { key, blob, name: fileName(paper, chosen) };
            setTimeout(() => prog.classList.add('hidden'), 600);
            return cached;
          };
          const busy = (on) => $$('.modal-actions button', m).forEach((b) => (b.disabled = on));

          $('#dlPdf', m).onclick = async () => {
            busy(true);
            try {
              const { blob, name } = await make();
              download(blob, name);
              toast('PDF downloaded', 'success');
            } catch (e) { toast(e.message, 'error'); }
            busy(false);
          };

          const shareBtn = $('#sharePdf', m);
          if (shareBtn) {
            shareBtn.onclick = async () => {
              busy(true);
              try {
                const { blob, name } = await make();
                const file = new File([blob], name, { type: 'application/pdf' });
                await navigator.share({ files: [file], title: paper.title, text: `${paper.title} · ${MONTHS[paper.month - 1]} ${paper.year}` });
              } catch (e) {
                if (e.name === 'NotAllowedError') {
                  // Browser wants a fresh tap after the PDF was generated.
                  shareBtn.textContent = 'Ready! Tap to share';
                } else if (e.name !== 'AbortError') {
                  toast(e.message, 'error');
                }
              }
              busy(false);
            };
          }
        },
      }
    );
  }

  return { open };
})();
