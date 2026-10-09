(async () => {
  // Already signed in? Go straight to the shelf.
  try {
    await API.get('/api/auth/me');
    location.replace('/shelf');
    return;
  } catch { /* not signed in */ }

  let mode = 'login';
  let pending = null; // sign-up details waiting for the emailed code
  const form = $('#authForm');
  const err = $('#err');
  const card = $('#card');
  const submit = $('#submitBtn');

  const shake = () => {
    card.classList.remove('shake');
    void card.offsetWidth; // restart animation
    card.classList.add('shake');
  };
  const show = (view) => ['#mainView', '#codeView', '#forgotView'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
  const enter = () => {
    card.classList.add('folding');
    card.addEventListener('animationend', () => location.replace('/shelf'), { once: true });
  };

  const nameCheck = watchUsername(form.username, $('#nameStatus'));

  $$('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      const reg = mode === 'register';
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.register-only').forEach((el) => el.classList.toggle('hidden', !reg));
      $$('.login-only').forEach((el) => el.classList.toggle('hidden', reg));
      $('#userLabel').textContent = reg ? 'Username' : 'Username or email';
      form.username.placeholder = reg ? 'e.g. name.m' : 'Username';
      form.password.autocomplete = reg ? 'new-password' : 'current-password';
      form.password.placeholder = reg ? 'At least 6 characters' : '••••••';
      submit.textContent = reg ? 'Create account' : 'Sign in';
      nameCheck.setEnabled(reg);
      err.textContent = '';
    })
  );

  $('.pw-eye').onclick = (e) => {
    const shown = form.password.type === 'text';
    form.password.type = shown ? 'password' : 'text';
    e.currentTarget.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    e.currentTarget.classList.toggle('on', !shown);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      if (mode === 'login') {
        await API.post('/api/auth/login', { username: form.username.value, password: form.password.value });
        return enter();
      }
      // Sign up, step 1: check details and email a code.
      pending = {
        displayName: form.displayName.value,
        email: form.email.value.trim(),
        username: form.username.value,
        password: form.password.value,
      };
      const r = await API.post('/api/auth/register/start', pending);
      openCodeView(r.email, r.retryIn);
    } catch (ex) {
      err.textContent = ex.message;
      shake();
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------- Sign-up code ---------- */
  const codeForm = $('#codeForm');
  const resend = $('#resendBtn');
  let stopTimer = null;

  function openCodeView(email, retryIn) {
    $('#codeEmail').textContent = email;
    codeForm.code.value = '';
    $('#codeErr').textContent = '';
    show('#codeView');
    stopTimer?.();
    stopTimer = cooldown(resend, retryIn || 60, 'Resend code');
    setTimeout(() => codeForm.code.focus(), 60);
  }

  codeForm.code.addEventListener('input', () => {
    codeForm.code.value = codeForm.code.value.replace(/\D/g, '').slice(0, 6);
    if (codeForm.code.value.length === 6) codeForm.requestSubmit();
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#codeBtn');
    if (btn.disabled) return;
    $('#codeErr').textContent = '';
    btn.disabled = true;
    try {
      await API.post('/api/auth/register', { ...pending, code: codeForm.code.value });
      enter();
    } catch (ex) {
      $('#codeErr').textContent = ex.message;
      codeForm.code.select();
      shake();
    } finally {
      btn.disabled = false;
    }
  });

  resend.onclick = async () => {
    resend.disabled = true;
    try {
      const r = await API.post('/api/auth/register/start', pending);
      toast('New code sent', 'success');
      stopTimer = cooldown(resend, r.retryIn || 60, 'Resend code');
    } catch (ex) {
      $('#codeErr').textContent = ex.message;
      stopTimer = cooldown(resend, ex.data?.retryIn || 5, 'Resend code');
    }
  };
  $('#backBtn').onclick = () => { stopTimer?.(); show('#mainView'); };

  /* ---------- Forgot password ---------- */
  const ff = $('#forgotForm');
  const fResend = $('#fResendBtn');
  let fStep = 1;
  let fStop = null;

  $('#forgotLink').onclick = () => {
    fStep = 1;
    ff.reset();
    if (form.username.value.includes('@')) ff.email.value = form.username.value.trim();
    $('#fStep2').classList.add('hidden');
    $('#fEmailField').classList.remove('hidden');
    fResend.classList.add('hidden');
    $('#forgotBtn').textContent = 'Send code';
    $('#forgotSub').textContent = "Enter the email on your account and we'll send you a code.";
    $('#forgotErr').textContent = '';
    show('#forgotView');
    setTimeout(() => ff.email.focus(), 60);
  };
  $('#fBackBtn').onclick = () => { fStop?.(); show('#mainView'); };

  async function sendReset() {
    const r = await API.post('/api/auth/password/forgot', { email: ff.email.value });
    fStop?.();
    fStop = cooldown(fResend, r.retryIn || 60, 'Resend code');
    return r;
  }

  ff.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#forgotBtn');
    $('#forgotErr').textContent = '';
    btn.disabled = true;
    try {
      if (fStep === 1) {
        const r = await sendReset();
        fStep = 2;
        $('#fEmailField').classList.add('hidden');
        $('#fStep2').classList.remove('hidden');
        fResend.classList.remove('hidden');
        $('#forgotSub').textContent = `If ${r.email} belongs to an account, a 6-digit code is on its way. Enter it with your new password.`;
        btn.textContent = 'Reset & sign in';
        setTimeout(() => ff.code.focus(), 60);
      } else {
        await API.post('/api/auth/password/reset', { email: ff.email.value, code: ff.code.value, newPassword: ff.newPassword.value });
        toast('Password changed', 'success');
        enter();
      }
    } catch (ex) {
      $('#forgotErr').textContent = ex.message;
      shake();
    } finally {
      btn.disabled = false;
    }
  });
  ff.code.addEventListener('input', () => { ff.code.value = ff.code.value.replace(/\D/g, '').slice(0, 6); });
  fResend.onclick = async () => {
    fResend.disabled = true;
    try { await sendReset(); toast('New code sent', 'success'); }
    catch (ex) { $('#forgotErr').textContent = ex.message; fStop = cooldown(fResend, ex.data?.retryIn || 5, 'Resend code'); }
  };
})();
