import request from 'supertest';
import { app } from '../src/app';
import { parseEmails } from '../src/utils/csvParser';
import { prisma } from '../src/config/db';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env';

// Mock prisma and BullMQ queues
jest.mock('../src/config/db', () => ({
  prisma: {
    sender: {
      findFirst: jest.fn(),
    },
    emailCampaign: {
      create: jest.fn(),
    },
    emailJob: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../src/queues/emailQueue', () => ({
  emailQueue: { name: 'email-queue' },
  enqueueEmail: jest.fn().mockResolvedValue({ id: 'bull-job-123' }),
}));

jest.mock('../src/routes/adminRoutes', () => {
  const express = require('express');
  const router = express.Router();
  // Attach default property to support both ESM interop and raw CommonJS require
  const mockExport = router;
  (mockExport as any).default = router;
  return mockExport;
});

describe('Scheduler Tests', () => {
  describe('CSV Parser Utility', () => {
    it('should correctly parse valid emails from CSV contents', () => {
      const csv = `
        email, name, role
        john@example.com, John, Intern
        alice@example.com, Alice, Manager
        invalid-email, Bob, Designer
      `;
      const result = parseEmails(csv);
      expect(result.valid).toEqual(['john@example.com', 'alice@example.com']);
      expect(result.invalid).toEqual(['invalid-email']);
      expect(result.totalCount).toBe(3);
    });

    it('should filter out duplicate emails and normalize casing', () => {
      const csv = `
        JOHN@EXAMPLE.COM
        john@example.com
        ALICE@example.com
      `;
      const result = parseEmails(csv);
      expect(result.valid).toEqual(['john@example.com', 'alice@example.com']);
    });
  });

  describe('Schedule API Endpoint Validation', () => {
    let mockToken: string;

    beforeAll(() => {
      mockToken = jwt.sign(
        { id: 'user-123', email: 'intern@reachinbox.com', name: 'Test Intern' },
        env.JWT_SECRET
      );
    });

    it('should block requests if not authenticated', async () => {
      const res = await request(app)
        .post('/api/emails/schedule')
        .send({
          senderId: 'd9b73ae0-1234-5678-abcd-ef1234567890',
          subject: 'Hello',
          body: 'Test content',
          recipients: ['user@example.com'],
          startTime: new Date().toISOString(),
          delayBetweenEmails: 1000,
          hourlyLimit: 50,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should validate inputs and reject malformed schemas', async () => {
      const res = await request(app)
        .post('/api/emails/schedule')
        .set('Cookie', [`token=${mockToken}`])
        .send({
          senderId: 'not-a-uuid', // Invalid UUID
          subject: '', // Missing subject
          body: 'Hello',
          recipients: [], // Missing recipients
          startTime: 'invalid-date',
          delayBetweenEmails: -10, // Invalid delay
          hourlyLimit: 0, // Invalid limit
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('should verify sender ownership and schedule jobs', async () => {
      // Mock sender search
      (prisma.sender.findFirst as jest.Mock).mockResolvedValue({
        id: 'sender-123',
        userId: 'user-123',
        email: 'intern@reachinbox.com',
      });

      // Mock campaign insertion
      const mockCampaign = { id: 'campaign-123' };
      (prisma.emailCampaign.create as jest.Mock).mockResolvedValue(mockCampaign);

      const mockJobs = [
        { id: 'job-1', recipient: 'user@example.com', scheduledAt: new Date() },
      ];
      (prisma.emailJob.findMany as jest.Mock).mockResolvedValue(mockJobs);

      const res = await request(app)
        .post('/api/emails/schedule')
        .set('Cookie', [`token=${mockToken}`])
        .send({
          senderId: 'd9b73ae0-1234-5678-abcd-ef1234567890',
          subject: 'Hello',
          body: 'Content',
          recipients: ['user@example.com'],
          startTime: new Date(Date.now() + 5000).toISOString(),
          delayBetweenEmails: 1000,
          hourlyLimit: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipientCount).toBe(1);
    });
  });
});
