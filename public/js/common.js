// Shared helpers: API client, toasts, modals, misc.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const API = {
  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && !url.startsWith('/api/auth')) {
      location.href = '/';
      throw new Error('Not signed in');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b || {}),
  put: (u, b) => API.req('PUT', u, b || {}),
  patch: (u, b) => API.req('PATCH', u, b || {}),
  del: (u) => API.req('DELETE', u),
};

/* ---------- Toasts ---------- */
function toast(message, type = 'info', ms = 2800) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, ms);
}

/* ---------- Modals ---------- */
function openModal(html, { onOpen, wide } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
      <button class="modal-x" aria-label="Close">&times;</button>${html}</div>`;
  document.body.appendChild(back);
  const modal = $('.modal', back);
  const close = () => {
    back.classList.add('closing');
    back.addEventListener('animationend', () => back.remove(), { once: true });
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('.modal-x', back).onclick = close;
  if (onOpen) onOpen(modal, close);
  const first = $('input, select, button:not(.modal-x)', modal);
  if (first) setTimeout(() => first.focus(), 50);
  return { modal, close };
}

function confirmModal(message, { okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openModal(
      `<p class="confirm-msg">${esc(message)}</p>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-a="no">${esc(cancelText)}</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-a="yes">${esc(okText)}</button>
       </div>`,
      {
        onOpen(m, close) {
          $$('[data-a]', m).forEach((b) =>
            (b.onclick = () => { answered = true; resolve(b.dataset.a === 'yes'); close(); })
          );
          new MutationObserver((_, obs) => {
            if (!document.body.contains(m)) { obs.disconnect(); if (!answered) resolve(false); }
          }).observe(document.body, { childList: true });
        },
      }
    );
  });
}

/* ---------- Button ripple (tiny delight) ---------- */
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn, .icon-btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'ripple';
  const size = Math.max(r.width, r.height);
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  btn.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
});

async function requireUser() {
  const { user } = await API.get('/api/auth/me');
  return user;
}

/* ---------- Greeting that follows the clock (midnight is not "morning") ---------- */
function greetingFor(name, date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return `Good morning 🌅, ${name}. Your space is ready.`;
  if (h >= 12 && h < 17) return `Good afternoon ☀️, ${name}. Your space is ready.`;
  if (h >= 17 && h < 21) return `Good evening 🌃, ${name}. Your space is ready.`;
  return `Still up, ${name}? 🌙 Write it down before you sleep.`;
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ---------- Notification bell ---------- */
const Bell = (() => {
  let host, btn, badge, panel;
  let state = { unread: 0, items: [] };

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function text(n) {
    const who = `<b>${esc(n.actorName)}</b>`;
    const paper = `<i>${esc(n.paperTitle)}</i>`;
    const when = n.month ? `${MONTHS[n.month - 1]}${n.day ? ' ' + n.day : ' ' + n.year}` : '';
    if (n.type === 'share') return `${who} shared ${paper} (${esc(when)}) with you. ${n.data.role === 'edit' ? 'You can edit it.' : 'You can read it.'}`;
    if (n.type === 'role') return `${who} changed your access to ${paper}: ${n.data.role === 'edit' ? 'you can edit now' : 'view only'}.`;
    if (n.type === 'reaction') return `${who} reacted <span class="n-emoji">${esc(n.data.emoji)}</span> to your ${esc(when)} page in ${paper}.`;
    return `${who} did something in ${paper}.`;
  }

  function link(n) {
    if (!n.paperId) return null;
    return `/paper?id=${n.paperId}${n.day ? `&day=${n.day}` : ''}`;
  }

  function draw() {
    badge.textContent = state.unread > 9 ? '9+' : state.unread;
    badge.classList.toggle('hidden', !state.unread);
    btn.setAttribute('aria-label', state.unread ? `Notifications, ${state.unread} unread` : 'Notifications');
    if (!panel) return;
    const list = state.items.length
      ? state.items.map((n) => `<li><button class="n-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-href="${esc(link(n) || '')}">
            <span class="n-text">${text(n)}</span><small>${esc(timeAgo(n.createdAt))}</small></button></li>`).join('')
      : '<li class="n-empty">No news yet. When a friend shares a paper or reacts to one of your days, it shows up here.</li>';
    panel.innerHTML = `<div class="n-head"><b>Notifications</b>${state.unread ? '<button class="n-all" data-all>Mark all read</button>' : ''}</div><ul class="n-list">${list}</ul>`;
  }

  async function refresh() {
    try {
      state = await API.get('/api/notifications');
      draw();
    } catch { /* offline or signed out: ignore */ }
  }

  function close() {
    panel?.remove();
    panel = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) {
    if (!panel) return;
    if (!panel.contains(e.target) && !btn.contains(e.target)) close();
  }

  function toggle() {
    if (panel) return close();
    panel = document.createElement('div');
    panel.className = 'n-panel';
    host.appendChild(panel);
    draw();
    document.addEventListener('pointerdown', outside, true);
    panel.addEventListener('click', async (e) => {
      if (e.target.closest('[data-all]')) {
        await API.post('/api/notifications/read', {}).catch(() => {});
        state.items.forEach((n) => (n.read = true));
        state.unread = 0;
        return draw();
      }
      const item = e.target.closest('.n-item');
      if (!item) return;
      const id = Number(item.dataset.id);
      const n = state.items.find((x) => x.id === id);
      if (n && !n.read) API.post('/api/notifications/read', { ids: [id] }).catch(() => {});
      if (item.dataset.href) location.href = item.dataset.href;
    });
    refresh();
  }

  function mount(container) {
    host = document.createElement('div');
    host.className = 'bell-wrap';
    host.innerHTML = `<button class="icon-btn bell" type="button" aria-label="Notifications">${ICON}<span class="bell-badge hidden"></span></button>`;
    container.appendChild(host);
    btn = $('.bell', host);
    badge = $('.bell-badge', host);
    btn.onclick = toggle;
    refresh();
    // Check again when you come back to the tab, and every 2 minutes while it's open.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 120000);
  }

  return { mount, refresh };
})();

/* ---------- "Resend code" countdown on a button ---------- */
function cooldown(btn, seconds, label) {
  let left = Math.max(0, Math.ceil(seconds));
  btn.disabled = true;
  const tick = () => {
    if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `${label} in ${left}s`;
    left--;
  };
  const t = setInterval(tick, 1000);
  tick();
  return () => { clearInterval(t); btn.disabled = false; btn.textContent = label; };
}

/* ---------- Live "username available?" check under an input ---------- */
function watchUsername(input, status, { enabled = false, onChange } = {}) {
  let timer = null;
  let seq = 0;
  let on = enabled;
  const set = (cls, html) => {
    status.className = `name-status ${cls}`;
    status.innerHTML = html;
    onChange && onChange(cls);
  };
  async function check() {
    const u = input.value.trim().toLowerCase().replace(/^@/, '');
    if (!on) return;
    if (!u) return set('', '');
    const my = ++seq;
    set('checking', 'Checking…');
    try {
      const r = await API.get(`/api/auth/username-available?u=${encodeURIComponent(u)}`);
      if (my !== seq) return; // a newer keystroke won
      if (r.available) {
        set('ok', r.mine ? `✓ ${esc(r.reason)}` : `✓ @${esc(r.username)} is available`);
      } else {
        const sug = (r.suggestions || []).map((x) => `<button type="button" class="sug" data-u="${esc(x)}">@${esc(x)}</button>`).join('');
        set('bad', `✗ ${esc(r.reason)}${sug ? `<span class="sug-row">Try ${sug}</span>` : ''}`);
      }
    } catch { if (my === seq) set('', ''); }
  }
  input.addEventListener('input', () => {
    if (!on) return;
    // Usernames are lowercase: fix as they type.
    const pos = input.selectionStart;
    const clean = input.value.toLowerCase().replace(/\s/g, '');
    if (clean !== input.value) { input.value = clean; try { input.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    clearTimeout(timer);
    timer = setTimeout(check, 350);
  });
  status.addEventListener('click', (e) => {
    const b = e.target.closest('.sug');
    if (!b) return;
    input.value = b.dataset.u;
    check();
  });
  return {
    setEnabled(v) { on = v; if (!v) set('', ''); else if (input.value) check(); },
    check,
  };
}

/* ---------- Account settings ---------- */
function openAccount(user, onSaved) {
  const saved = (u, msg) => { Object.assign(user, u); toast(msg, 'success'); onSaved && onSaved(user); };
  const emailState = () => !user.email
    ? '<span class="pill warn">No email yet</span>'
    : user.emailVerified ? '<span class="pill ok">✓ Verified</span>' : '<span class="pill warn">Not verified</span>';

  openModal(
    `<h2>Your account</h2>
     <p class="sub">Signed in as <b id="accHandle">@${esc(user.username)}</b></p>

     <section class="acc-sec">
       <h3>Email</h3>
       <p class="acc-now"><span id="accEmailNow">${esc(user.email || 'None')}</span> <span id="accEmailState">${emailState()}</span></p>
       <form id="emailForm" class="acc-row" novalidate>
         <input class="input" name="email" type="email" inputmode="email" autocomplete="email" placeholder="${user.email ? 'New email address' : 'you@example.com'}" />
         <button class="btn btn-primary" type="submit" id="emailSend">Send code</button>
       </form>
       ${user.email && !user.emailVerified ? '<button type="button" class="link-btn" id="verifyCurrent">Verify my current email instead</button>' : ''}
       <form id="emailCodeForm" class="acc-row hidden" novalidate>
         <input class="input code-input sm" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" />
         <button class="btn btn-primary" type="submit">Confirm</button>
       </form>
       <p class="acc-hint" id="emailHint"></p>
     </section>

     <section class="acc-sec">
       <h3>Username</h3>
       <form id="userForm" novalidate>
         <div class="acc-row">
           <input class="input" name="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(user.username)}" />
           <button class="btn btn-primary" type="submit" id="userSave" disabled>Save</button>
         </div>
         <small class="name-status" id="accNameStatus" aria-live="polite"></small>
         <p class="acc-hint">Friends use this to share newspapers with you.</p>
       </form>
     </section>

     <section class="acc-sec">
       <h3>Name</h3>
       <form id="nameForm" class="acc-row" novalidate>
         <input class="input" name="displayName" maxlength="40" value="${esc(user.displayName)}" />
         <button class="btn btn-primary" type="submit">Save</button>
       </form>
     </section>

     <section class="acc-sec">
       <h3>Password</h3>
       <form id="pwForm" novalidate>
         <label class="field"><span>Current password</span><input class="input" name="currentPassword" type="password" autocomplete="current-password" /></label>
         <label class="field"><span>New password</span><input class="input" name="newPassword" type="password" autocomplete="new-password" placeholder="At least 6 characters" /></label>
         <button class="btn btn-primary" type="submit">Change password</button>
         <p class="acc-hint">This signs you out on your other devices.</p>
       </form>
     </section>

     <section class="acc-sec">
       <h3>Notifications</h3>
       <label class="check"><input type="checkbox" id="notifyBox" ${user.notifyEmail !== false ? 'checked' : ''}/> Email me when someone shares a newspaper or reacts to my page</label>
     </section>`,
    {
      onOpen(m) {
        const busy = async (btn, fn) => {
          btn.disabled = true;
          try { await fn(); } catch (ex) { toast(ex.message, 'error'); } finally { btn.disabled = false; }
        };
        const redrawEmail = () => {
          $('#accEmailNow', m).textContent = user.email || 'None';
          $('#accEmailState', m).innerHTML = emailState();
          $('#verifyCurrent', m)?.remove();
        };

        /* Email: send code -> confirm */
        let target = '';
        let stop = null;
        const ef = $('#emailForm', m);
        const cf = $('#emailCodeForm', m);
        const sendTo = async (email) => {
          const r = await API.post('/api/auth/email/start', { email });
          target = r.email;
          cf.classList.remove('hidden');
          $('#emailHint', m).textContent = `Code sent to ${r.email}. Check your inbox (and spam).`;
          stop?.();
          stop = cooldown($('#emailSend', m), r.retryIn || 60, 'Resend');
          setTimeout(() => cf.code.focus(), 50);
        };
        ef.onsubmit = async (e) => {
          e.preventDefault();
          const btn = $('#emailSend', m);
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            await sendTo(ef.email.value.trim()); // starts the resend countdown on success
          } catch (ex) {
            toast(ex.message, 'error');
            stop?.();
            stop = ex.data?.retryIn ? cooldown(btn, ex.data.retryIn, 'Resend') : null;
            if (!stop) btn.disabled = false;
          }
        };
        $('#verifyCurrent', m)?.addEventListener('click', () => { ef.email.value = user.email; ef.requestSubmit(); });
        cf.code.addEventListener('input', () => {
          cf.code.value = cf.code.value.replace(/\D/g, '').slice(0, 6);
          if (cf.code.value.length === 6) cf.requestSubmit();
        });
        cf.onsubmit = (e) => {
          e.preventDefault();
          busy($('button', cf), async () => {
            const { user: u } = await API.post('/api/auth/email/verify', { email: target, code: cf.code.value });
            stop?.();
            cf.classList.add('hidden');
            ef.reset();
            $('#emailHint', m).textContent = '';
            saved(u, 'Email confirmed');
            redrawEmail();
          });
        };

        /* Username with live availability */
        const uf = $('#userForm', m);
        watchUsername(uf.username, $('#accNameStatus', m), {
          enabled: true,
          onChange: (state) => { $('#userSave', m).disabled = state !== 'ok' || uf.username.value === user.username; },
        });
        uf.onsubmit = (e) => {
          e.preventDefault();
          busy($('#userSave', m), async () => {
            const { user: u } = await API.post('/api/auth/username', { username: uf.username.value });
            saved(u, `You're now @${u.username}`);
            $('#accHandle', m).textContent = `@${u.username}`;
            $('#accNameStatus', m).innerHTML = '';
          }).then(() => { $('#userSave', m).disabled = true; });
        };

        /* Display name */
        const nf = $('#nameForm', m);
        nf.onsubmit = (e) => {
          e.preventDefault();
          busy($('button', nf), async () => {
            const { user: u } = await API.patch('/api/auth/me', { displayName: nf.displayName.value });
            saved(u, 'Name saved');
          });
        };

        /* Password */
        const pf = $('#pwForm', m);
        pf.onsubmit = (e) => {
          e.preventDefault();
          busy($('button', pf), async () => {
            const { user: u } = await API.post('/api/auth/password', { currentPassword: pf.currentPassword.value, newPassword: pf.newPassword.value });
            pf.reset();
            saved(u, 'Password changed');
          });
        };

        /* Notifications: saves straight away */
        $('#notifyBox', m).onchange = async (e) => {
          try {
            const { user: u } = await API.patch('/api/auth/me', { notifyEmail: e.target.checked });
            saved(u, e.target.checked ? 'Emails on' : 'Emails off');
          } catch (ex) { toast(ex.message, 'error'); e.target.checked = !e.target.checked; }
        };
      },
    }
  );
}

/* ---------- Small dropdown menu (used for the "⋯" button) ---------- */
function openMenu(anchor, items) {
  document.querySelector('.menu-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'menu-pop';
  pop.setAttribute('role', 'menu');
  pop.innerHTML = items
    .filter(Boolean)
    .map((it, i) => `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`)
    .join('');
  const list = items.filter(Boolean);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.addEventListener('pointerdown', outside, true);
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    close();
    list[Number(b.dataset.i)].onClick();
  });
}
