(async () => {
  // Already signed in? Go straight to the shelf.
  try {
    await API.get('/api/auth/me');
    location.replace('/shelf');
    return;
  } catch { /* not signed in */ }

  let mode = 'login';
  const form = $('#authForm');
  const err = $('#err');
  const card = $('#card');
  const submit = $('#submitBtn');

  $$('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.register-only').forEach((el) => el.classList.toggle('hidden', mode !== 'register'));
      form.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      submit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
      err.textContent = '';
    })
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const body = {
        username: form.username.value,
        password: form.password.value,
        displayName: form.displayName.value,
      };
      await API.post(mode === 'register' ? '/api/auth/register' : '/api/auth/login', body);
      card.classList.add('folding');
      card.addEventListener('animationend', () => location.replace('/shelf'), { once: true });
    } catch (ex) {
      err.textContent = ex.message;
      card.classList.remove('shake');
      void card.offsetWidth; // restart animation
      card.classList.add('shake');
      submit.disabled = false;
    }
  });
})();
