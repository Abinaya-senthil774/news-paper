// Send one test email using the settings in .env.
//   npm run test-mail -- you@example.com
require('dotenv').config();
const { sendMail, layout, mode, FROM } = require('../src/mailer');

const to = process.argv[2];
if (!to) {
  console.log('Usage: npm run test-mail -- you@example.com');
  process.exit(1);
}

(async () => {
  console.log(`Sending a test email to ${to} (mode: ${mode}, from: ${FROM})…`);
  try {
    await sendMail({
      to,
      subject: '☕ dʌmi News test email',
      text: 'If you can read this, email sending works. 123456 is what a sign-up code looks like.',
      html: layout({
        kicker: 'Test edition',
        headline: 'Email sending works!',
        body: 'If you can read this, your dʌmi News server can send sign-up codes and notifications.',
        code: '123456',
        footer: 'This is a test email sent from scripts/test-mail.js.',
      }),
    });
    if (mode === 'console') {
      console.log('\n⚠ Email is not configured, so nothing was really sent. Add SMTP_* or BREVO_API_KEY to .env.');
    } else {
      console.log('\n✓ Sent. Check the inbox (and the spam folder) of', to);
    }
  } catch (err) {
    console.error('\n✗ Sending failed:', err.message);
    if (/Invalid login|535|Username and Password not accepted/i.test(err.message)) {
      console.error('  → For Gmail, SMTP_PASS must be a 16-character App Password, not your normal password.');
    } else if (/ETIMEDOUT|ECONNREFUSED|ENETUNREACH|Greeting never received/i.test(err.message)) {
      console.error('  → The SMTP port is blocked on this network or host. Try SMTP_PORT=465, or use BREVO_API_KEY instead.');
    } else if (/Brevo API 401/.test(err.message)) {
      console.error('  → BREVO_API_KEY is wrong. Create an API key under Brevo → SMTP & API → API Keys.');
    } else if (/Brevo API 400/.test(err.message)) {
      console.error('  → Check that the MAIL_FROM address is a verified sender in Brevo → Senders.');
    }
    process.exit(1);
  }
})();
