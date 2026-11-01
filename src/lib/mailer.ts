import nodemailer, { type Transporter } from "nodemailer";

type Mail = {
  to: string;
  subject: string;
  text: string;
};

let transporter: Transporter | null = null;

function smtpTransport(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const configured = [host, user, password].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) {
    const missing = [
      !host && "SMTP_HOST",
      !user && "SMTP_USER",
      !password && "SMTP_PASSWORD",
    ].filter(Boolean);
    throw new Error(`SMTP is partially configured; missing ${missing.join(", ")}`);
  }

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
      auth: { user, pass: password },
    });
  }
  return transporter;
}

export async function sendEmail(mail: Mail): Promise<void> {
  const transport = smtpTransport();
  if (!transport) return;

  await transport.sendMail({
    from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}
