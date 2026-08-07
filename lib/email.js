const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      'SMTP settings are not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) - escalation emails will not be sent.'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

async function sendEscalationEmail({ conversationId, customerEmail, message }) {
  const t = getTransporter();
  if (!t) return;

  const supportEmail = process.env.SUPPORT_EMAIL || 'orders@gemawards.com';

  await t.sendMail({
    from: process.env.SMTP_FROM || supportEmail,
    to: supportEmail,
    subject: `Chat escalation (outside business hours) - Conversation ${conversationId}`,
    text: [
      'A customer chat was escalated outside business hours.',
      '',
      `Customer email: ${customerEmail || '(not provided)'}`,
      `Conversation ID: ${conversationId}`,
      '',
      'Message:',
      message,
      '',
      'View the full transcript in the Gem Awards AI plugin (Live Chats page).',
    ].join('\n'),
  });
}

module.exports = { sendEscalationEmail };
