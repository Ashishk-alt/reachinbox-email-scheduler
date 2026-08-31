import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let transporter: nodemailer.Transporter | null = null;

/**
 * Create and reuse a single Nodemailer transporter.
 *
 * In production, ETHEREAL_USER and ETHEREAL_PASSWORD
 * should be configured in Render environment variables.
 *
 * If they are not provided, a single Ethereal test account
 * is created and reused for the lifetime of this process.
 */
export async function getTransporter(): Promise<nodemailer.Transporter> {
  // Reuse existing transporter
  if (transporter) {
    return transporter;
  }

  let user = env.ETHEREAL_USER;
  let pass = env.ETHEREAL_PASSWORD;

  // ---------------------------------------------------------
  // Create Ethereal test account only if credentials are missing
  // ---------------------------------------------------------

  if (!user || !pass) {
    logger.warn(
      'ETHEREAL_USER / ETHEREAL_PASSWORD not configured. Creating one Ethereal test account.'
    );

    try {
      const testAccount = await nodemailer.createTestAccount();

      user = testAccount.user;
      pass = testAccount.pass;

      logger.info(
        `Ethereal test account created: ${user}`
      );
    } catch (err: any) {
      logger.error(
        'Failed to create Ethereal test account',
        err
      );

      throw err;
    }
  } else {
    logger.info(
      `Using configured Ethereal SMTP account: ${user}`
    );
  }

  // ---------------------------------------------------------
  // Create transporter
  // ---------------------------------------------------------

  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user,
      pass,
    },
  });

  // ---------------------------------------------------------
  // Verify SMTP connection
  // ---------------------------------------------------------

  try {
    await transporter.verify();

    logger.info(
      '✔ SMTP transporter verified successfully.'
    );
  } catch (err: any) {
    logger.error(
      '❌ SMTP transporter verification failed',
      err
    );

    transporter = null;
    throw err;
  }

  return transporter;
}

/**
 * Send an email.
 */
export async function sendMail(options: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const mailTransporter = await getTransporter();

  try {
    const info = await mailTransporter.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: options.body.replace(/\n/g, '<br/>'),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    logger.info(
      `Email sent successfully. Message ID: ${info.messageId}`
    );

    if (previewUrl) {
      logger.info(
        `Ethereal preview URL: ${previewUrl}`
      );
    }

    return {
      messageId: info.messageId,
      previewUrl: previewUrl || undefined,
    };
  } catch (err: any) {
    logger.error(
      `Failed to send email to ${options.to}`,
      err
    );

    throw err;
  }
}