import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { env } from './config/env';
import { errorMiddleware } from './middleware/errorMiddleware';

import authRoutes from './routes/authRoutes';
import emailRoutes from './routes/emailRoutes';
import slackRoutes from './routes/slackRoutes';
import healthRoutes from './routes/healthRoutes';
import adminRoutes from './routes/adminRoutes';

import { logger } from './utils/logger';

const app = express();

/* =========================================================
   CORS
========================================================= */

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* =========================================================
   BODY PARSERS
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* =========================================================
   REQUEST LOGGER
========================================================= */

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

/* =========================================================
   GOOGLE SEARCH CONSOLE VERIFICATION
========================================================= */

app.get('/googlef94a625929feeb5b.html', (req, res) => {
  res
    .type('text/html')
    .send('google-site-verification: googlef94a625929feeb5b.html');
});

/* =========================================================
   ROBOTS.TXT
========================================================= */

app.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(
      `User-agent: *
Allow: /

Sitemap: https://reachinbox-email-scheduler-yd4h.onrender.com/sitemap.xml`
    );
});

/* =========================================================
   SITEMAP.XML
========================================================= */

app.get('/sitemap.xml', (req, res) => {
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://reachinbox-email-scheduler-yd4h.onrender.com/</loc>
  </url>
  <url>
    <loc>https://reachinbox-email-scheduler-yd4h.onrender.com/robots.txt</loc>
  </url>
</urlset>`);
});

/* =========================================================
   ADMIN QUEUE DASHBOARD
========================================================= */

app.use('/admin', adminRoutes);

/* =========================================================
   APPLICATION API ROUTES
========================================================= */

app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/health', healthRoutes);

/* =========================================================
   CENTRALIZED ERROR HANDLER
========================================================= */

app.use(errorMiddleware as any);

/* =========================================================
   EXPORT APP
========================================================= */

export default app;
export { app };
