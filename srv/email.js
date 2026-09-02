const nodemailer = require('nodemailer');

const isDev = !process.env.SMTP_HOST;

async function sendEmail({ to, subject, body }) {
  if (isDev) {
    console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${body}\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'uisp-noreply@example.com',
    to,
    subject,
    text: body,
  });
}

module.exports = { sendEmail };

