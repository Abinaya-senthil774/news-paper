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
