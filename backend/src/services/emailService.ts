import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let transporter: nodemailer.Transporter | null = null;

export async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  let user = env.ETHEREAL_USER;
  let pass = env.ETHEREAL_PASSWORD;

  if (!user || !pass) {
    logger.info('No Ethereal credentials provided in .env. Creating auto test account...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      user = testAccount.user;
      pass = testAccount.pass;
      logger.info(`✔ Generated Ethereal Test Credentials: USERNAME=${user}, PASSWORD=${pass}`);
    } catch (err: any) {
      logger.error('Failed to create Ethereal test account automatically', err);
      throw err;
    }
  }

  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

export async function sendMail(options: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const mailTransporter = await getTransporter();
  const info = await mailTransporter.sendMail({
    from: options.from,
    to: options.to,
    subject: options.subject,
    text: options.body,
    html: options.body.replace(/\n/g, '<br/>'),
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  return {
    messageId: info.messageId,
    previewUrl: previewUrl || undefined,
  };
}
