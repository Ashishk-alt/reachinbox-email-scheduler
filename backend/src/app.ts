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

// Configure CORS for local frontend communications
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true, // Allow cookies to be sent along with cross-origin requests
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Standard request parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request logger middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Admin Queue Dashboard Route (Bull Board)
app.use('/admin', adminRoutes);

// Application API Routes
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/health', healthRoutes);

// Centralized error handler
app.use(errorMiddleware as any);

export default app;
export { app };
