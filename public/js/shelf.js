(async () => {
  const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
  let user;
  try { user = await requireUser(); } catch { return; }

  // Re-check every minute so a shelf left open overnight doesn't keep saying "Good morning".
  const greet = () => {
    const g = greetingFor(user.displayName);
    $('#greeting').textContent = g;
    $('#greetingMobile').textContent = g;
  };
  greet();
  setInterval(greet, 60 * 1000);

  const drawAccount = () => {
    $('#accountInitial').textContent = (user.displayName || user.username || '?')[0].toUpperCase();
    const needs = !user.email || !user.emailVerified;
    $('#emailNudge').classList.toggle('hidden', !needs);
    $('#emailNudgeText').textContent = !user.email
      ? '✉️ Add your email so you hear when a friend shares a paper or reacts to one of your days.'
      : `✉️ Confirm ${user.email} so notifications can reach you.`;
    $('#emailNudgeBtn').textContent = user.email ? 'Confirm email' : 'Add email';
  };
  drawAccount();
  $('#accountBtn').onclick = () => openAccount(user, () => { drawAccount(); greet(); });
  $('#emailNudgeBtn').onclick = () => openAccount(user, () => { drawAccount(); greet(); });
  Bell.mount($('#topTools'));

  let data = { mine: [], shared: [] };
  let tab = 'mine';

  $('#logoutBtn').onclick = async () => {
    await API.post('/api/auth/logout');
    location.replace('/');
  };

  $$('.shelf-tabs .tab').forEach((t) =>
    t.addEventListener('click', () => {
      tab = t.dataset.tab;
      $$('.shelf-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      render();
    })
  );

  $('#fab').onclick = openCreate;

  async function load() {
    data = await API.get('/api/papers');
    drawStreak(data.writtenDays || []);
    const n = data.shared.length;
    $('#sharedCount').textContent = n;
    $('#sharedCount').classList.toggle('hidden', !n);
    render();
  }

  // Writing streak: consecutive days with something written, counting back from
  // today (or from yesterday, so the streak isn't "lost" before you've written today).
  function drawStreak(days) {
    const set = new Set(days);
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const d = new Date();
    const wroteToday = set.has(key(d));
    if (!wroteToday) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
    const el = $('#streak');
    el.classList.toggle('hidden', n < 1);
    el.textContent = `🔥 ${n}-day streak`;
    el.title = wroteToday ? 'You wrote today. See you tomorrow!' : "Write today's page to keep it going";
    el.classList.toggle('pending', !wroteToday);
  }

  function card(p, i) {
    const tilt = ((p.id * 37) % 7) - 3; // stable little tilt per paper
    const shared = p.role !== 'owner';
    return `<div class="slot">
      <button class="paper-card" data-id="${p.id}" style="--tilt:${tilt}deg; animation-delay:${i * 60}ms" title="Open ${esc(MONTHS[p.month - 1])} ${p.year}">
        ${shared ? `<span class="ribbon">${p.role === 'edit' ? 'CAN EDIT' : 'VIEW ONLY'}</span>` : `<span class="card-del" data-del="${p.id}" role="button" aria-label="Delete">${TRASH}</span>`}
        <div class="mini-title">${esc(p.title)}</div>
        <div class="mini-date"><span>Vol. ${p.year - 2000 > 0 ? p.year - 2000 : 1}</span><span>Monthly</span></div>
        <div class="mini-month">${esc(MONTHS[p.month - 1])}</div>
        <div class="mini-year">${p.year}</div>
        <div class="mini-cols"></div>
        <div class="mini-foot">
          <span>${p.pageCount} ${p.pageCount === 1 ? 'day' : 'days'}</span>
          <span>${shared ? '@' + esc(p.ownerUsername) : ''}</span>
        </div>
      </button>
    </div>`;
  }

  function render() {
    const shelf = $('#shelf');
    const list = data[tab];
    let html = list.map(card).join('');
    if (tab === 'mine') {
      html += `<div class="slot"><button class="add-card" id="addCard"><span class="plus">+</span><span>New month</span></button></div>`;
    } else if (!list.length) {
      html = `<p class="empty-msg">Nothing shared with you yet. When a friend shares their newspaper, it lands here.</p>`;
    }
    shelf.innerHTML = html;
    $('#addCard')?.addEventListener('click', openCreate);

    $$('.paper-card', shelf).forEach((el) =>
      el.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.preventDefault(); e.stopPropagation(); return removePaper(Number(del.dataset.del)); }
        el.classList.add('pulling');
        setTimeout(() => (location.href = `/paper?id=${el.dataset.id}`), 380);
      })
    );
  }

  async function removePaper(id) {
    // Compare as numbers: Postgres BIGINT ids can arrive as strings.
    const p = data.mine.find((x) => Number(x.id) === Number(id));
    if (!p) return toast('Could not find that newspaper, try refreshing', 'error');
    const ok = await confirmModal(`Delete "${p.title}" for ${MONTHS[p.month - 1]} ${p.year}? All ${p.pageCount} day(s) will be gone for good.`, { okText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await API.del(`/api/papers/${id}`);
      toast('Newspaper deleted', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  function openCreate() {
    const now = new Date();
    const opts = MONTHS.map((m, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${m}</option>`).join('');
    openModal(
      `<h2>Start a new month</h2>
       <p class="sub">Each month gets its own newspaper. Each day is a page.</p>
       <form id="createForm">
         <div class="row">
           <label class="field"><span>Month</span><select class="input" name="month">${opts}</select></label>
           <label class="field"><span>Year</span><input class="input" name="year" type="number" min="1900" max="2200" value="${now.getFullYear()}"/></label>
         </div>
         <label class="field"><span>Newspaper name</span><input class="input" name="title" maxlength="60" value="The ${esc(user.displayName)} Times"/></label>
         <div class="modal-actions">
           <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
           <button class="btn btn-primary" type="submit">Print it</button>
         </div>
       </form>`,
      {
        onOpen(m, close) {
          $('[data-cancel]', m).onclick = close;
          $('#createForm', m).onsubmit = async (e) => {
            e.preventDefault();
            const f = e.target;
            try {
              const { paper } = await API.post('/api/papers', { month: Number(f.month.value), year: Number(f.year.value), title: f.title.value });
              close();
              toast(`${MONTHS[paper.month - 1]} ${paper.year} is on the shelf`, 'success');
              tab = 'mine';
              $$('.shelf-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'mine'));
              await load();
            } catch (ex) { toast(ex.message, 'error'); }
          };
        },
      }
    );
  }

  load().catch((e) => toast(e.message, 'error'));
})();
