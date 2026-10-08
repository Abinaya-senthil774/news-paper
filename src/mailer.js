// Email sending over SMTP (works with Gmail app passwords, Brevo, Resend, Mailgun, …).
// If SMTP isn't configured, emails are printed to the console instead, so
// local development keeps working without any setup.
const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
const configured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transport = configured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const FROM = MAIL_FROM || (SMTP_USER ? `dʌmi News <${SMTP_USER}>` : 'dʌmi News <no-reply@localhost>');

if (!configured) console.log('ℹ SMTP not configured: emails will be logged to the console instead of sent.');

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A small newspaper-styled email. All arguments are plain text; they are escaped here.
function layout({ kicker, headline, body, cta, url, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#efe6d2;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#f7f3e8;border:1px solid #d8cfba" cellspacing="0" cellpadding="0">
      <tr><td style="padding:22px 28px 6px;text-align:center;font-family:'Old English Text MT',Georgia,serif;font-size:34px">dʌmi News</td></tr>
      <tr><td style="padding:0 28px"><div style="border-top:3px double #1a1a1a"></div></td></tr>
      <tr><td style="padding:14px 28px 0;font:bold 11px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#a8682f">${escHtml(kicker)}</td></tr>
      <tr><td style="padding:6px 28px 0;font-size:26px;line-height:1.2;font-weight:bold">${escHtml(headline)}</td></tr>
      <tr><td style="padding:12px 28px 0;font-size:16px;line-height:1.55">${escHtml(body)}</td></tr>
      <tr><td style="padding:22px 28px 26px"><a href="${escHtml(url)}" style="display:inline-block;background:#7a4519;color:#fff8ec;text-decoration:none;font:bold 15px Arial,sans-serif;padding:12px 22px;border-radius:999px">${escHtml(cta)}</a></td></tr>
      <tr><td style="padding:12px 28px 18px;border-top:1px solid #d8cfba;font:12px Arial,sans-serif;color:#7a6f5c">${escHtml(footer || 'You can turn these emails off any time under Account on your shelf.')}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendMail({ to, subject, html, text }) {
  if (!to) return;
  if (!transport) {
    console.log(`✉ [email not sent: SMTP not configured] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: FROM, to, subject, html, text });
}

// Fire-and-forget: never let a slow or failing mail server break an API request.
function sendLater(msg) {
  sendMail(msg).catch((err) => console.error('Email failed:', err.message));
}

module.exports = { sendMail, sendLater, layout, configured };
