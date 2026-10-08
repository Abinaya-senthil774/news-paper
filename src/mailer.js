// Outgoing email. Three ways to send, picked automatically from .env:
//   1. BREVO_API_KEY set  -> Brevo's HTTPS API (works on hosts that block SMTP ports, e.g. Render free)
//   2. SMTP_HOST/USER/PASS -> any SMTP server (Gmail App Password, Brevo SMTP, Mailgun, …)
//   3. nothing set         -> emails are printed in the server log (handy for local development)
const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, BREVO_API_KEY } = process.env;

const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const mode = BREVO_API_KEY ? 'brevo' : smtpReady ? 'smtp' : 'console';

const transport = mode === 'smtp'
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 15000,
    })
  : null;

const FROM = MAIL_FROM || (SMTP_USER ? `dʌmi News <${SMTP_USER}>` : 'dʌmi News <no-reply@localhost>');

// "Name <addr@x.com>" -> { name, email }
function parseFrom(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() };
}

console.log(
  mode === 'brevo' ? `✉ Email: sending through the Brevo API as ${FROM}`
  : mode === 'smtp' ? `✉ Email: sending through SMTP ${SMTP_HOST} as ${FROM}`
  : 'ℹ Email: not configured, so emails (and sign-up codes) are printed here in the log instead of sent.'
);

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A small newspaper-styled email. All arguments are plain text; they are escaped here.
function layout({ kicker, headline, body, cta, url, code, footer }) {
  const button = cta && url
    ? `<tr><td style="padding:22px 28px 26px"><a href="${escHtml(url)}" style="display:inline-block;background:#7a4519;color:#fff8ec;text-decoration:none;font:bold 15px Arial,sans-serif;padding:12px 22px;border-radius:999px">${escHtml(cta)}</a></td></tr>`
    : '';
  const codeBox = code
    ? `<tr><td style="padding:20px 28px 8px"><div style="display:inline-block;font:bold 34px 'Courier New',monospace;letter-spacing:10px;background:#fffdf7;border:2px dashed #a8682f;padding:12px 20px 12px 30px;color:#1a1a1a">${escHtml(code)}</div></td></tr>
       <tr><td style="padding:6px 28px 24px;font:13px Arial,sans-serif;color:#7a6f5c">This code works for 10 minutes. If you didn't ask for it, you can ignore this email.</td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#efe6d2;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#f7f3e8;border:1px solid #d8cfba" cellspacing="0" cellpadding="0">
      <tr><td style="padding:22px 28px 6px;text-align:center;font-family:'Old English Text MT',Georgia,serif;font-size:34px">dʌmi News</td></tr>
      <tr><td style="padding:0 28px"><div style="border-top:3px double #1a1a1a"></div></td></tr>
      <tr><td style="padding:14px 28px 0;font:bold 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#a8682f">${escHtml(kicker)}</td></tr>
      <tr><td style="padding:6px 28px 0;font-size:26px;line-height:1.2;font-weight:bold">${escHtml(headline)}</td></tr>
      <tr><td style="padding:12px 28px 0;font-size:16px;line-height:1.55">${escHtml(body)}</td></tr>
      ${codeBox}${button}
      <tr><td style="padding:12px 28px 18px;border-top:1px solid #d8cfba;font:12px Arial,sans-serif;color:#7a6f5c">${escHtml(footer || 'You can turn these emails off any time under Account on your shelf.')}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendViaBrevo({ to, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(FROM), to: [{ email: to }], subject, htmlContent: html, textContent: text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${detail.slice(0, 300)}`);
  }
}

async function sendMail({ to, subject, html, text }) {
  if (!to) return;
  if (mode === 'brevo') return sendViaBrevo({ to, subject, html, text });
  if (mode === 'smtp') return transport.sendMail({ from: FROM, to, subject, html, text });
  console.log(`\n✉ [not sent: email isn't configured] to=${to}\n  subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
}

// Fire-and-forget: never let a slow or failing mail server break an API request.
function sendLater(msg) {
  sendMail(msg).catch((err) => console.error('Email failed:', err.message));
}

module.exports = { sendMail, sendLater, layout, mode, FROM };
