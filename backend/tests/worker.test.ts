import { processEmailJob } from '../src/workers/emailWorker';
import { prisma } from '../src/config/db';
import { redisClient } from '../src/config/redis';
import { sendMail } from '../src/services/emailService';
import { sendSlackNotification } from '../src/services/slackService';
import { enqueueEmail } from '../src/queues/emailQueue';

jest.mock('../src/config/db', () => ({
  prisma: {
    $transaction: jest.fn(),
    emailJob: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../src/config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    expire: jest.fn(),
  },
}));

jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn(),
}));

jest.mock('../src/services/slackService', () => ({
  sendSlackNotification: jest.fn(),
}));

jest.mock('../src/queues/emailQueue', () => ({
  enqueueEmail: jest.fn(),
}));

jest.mock('../src/services/searchService', () => ({
  indexEmailJob: jest.fn(),
}));

describe('Worker Processing Lifecycle Tests', () => {
  const mockJob: any = {
    id: 'bull-job-1',
    data: { emailJobId: 'email-job-123' },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should skip job execution if the email job status is already sent', async () => {
    (prisma.$transaction as jest.Mock).mockResolvedValue({
      skip: true,
      record: { id: 'email-job-123', status: 'sent' },
    });

    await processEmailJob(mockJob);

    expect(prisma.emailJob.update).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('should skip job execution if the email job status is already processing (concurrency/idempotency safety)', async () => {
    (prisma.$transaction as jest.Mock).mockResolvedValue({
      skip: true,
      record: { id: 'email-job-123', status: 'processing' },
    });

    await processEmailJob(mockJob);

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('should reschedule job and trigger Slack notification when sender reaches their hourly rate limit', async () => {
    const mockEmailJobRecord = {
      id: 'email-job-123',
      status: 'scheduled',
      recipient: 'user@example.com',
      subject: 'Hello Intern',
      body: 'Welcome to ReachInbox',
      campaign: {
        id: 'campaign-123',
        hourlyLimit: 10,
        sender: { id: 'sender-1', email: 'sender@example.com' },
        user: {
          id: 'user-1',
          slackConnection: { accessToken: 'slack-token-abc', slackUserId: 'slack-user-xyz' },
        },
      },
    };

    (prisma.$transaction as jest.Mock).mockResolvedValue({
      skip: false,
      record: mockEmailJobRecord,
    });

    // Mock last send and slack notifications
    (redisClient.get as jest.Mock).mockImplementation((key) => {
      if (key.includes('last-send')) return null;
      if (key.includes('slack-notified')) return null;
      return null;
    });

    // Mock incr returning 11 (exceeding hourlyLimit = 10)
    (redisClient.incr as jest.Mock).mockResolvedValue(11);

    await processEmailJob(mockJob);

    // Verify database state reverts back to scheduled
    expect(prisma.emailJob.update).toHaveBeenCalledWith({
      where: { id: 'email-job-123' },
      data: { status: 'scheduled' },
    });

    // Verify rate limit count is decremented back
    expect(redisClient.decr).toHaveBeenCalled();

    // Verify BullMQ rescheduled enqueuing occurred
    expect(enqueueEmail).toHaveBeenCalledWith('email-job-123', expect.any(Number));

    // Verify Slack warning was dispatched
    expect(sendSlackNotification).toHaveBeenCalledWith(
      'slack-token-abc',
      'slack-user-xyz',
      expect.stringContaining('hourly limit')
    );
  });

  it('should send email and mark it as sent in DB when rate limits and delays are respected', async () => {
    const mockEmailJobRecord = {
      id: 'email-job-123',
      status: 'scheduled',
      recipient: 'user@example.com',
      subject: 'Test Subject',
      body: 'Test Body',
      campaign: {
        id: 'campaign-123',
        hourlyLimit: 50,
        sender: { id: 'sender-1', email: 'sender@example.com', displayName: 'Sender' },
        user: { id: 'user-1', slackConnection: null },
      },
    };

    (prisma.$transaction as jest.Mock).mockResolvedValue({
      skip: false,
      record: mockEmailJobRecord,
    });

    (redisClient.get as jest.Mock).mockResolvedValue(null);
    (redisClient.incr as jest.Mock).mockResolvedValue(1); // Under limit
    (sendMail as jest.Mock).mockResolvedValue({
      messageId: 'ethereal-message-123',
      previewUrl: 'https://ethereal.email/message/abc',
    });

    (prisma.emailJob.update as jest.Mock).mockResolvedValue({
      id: 'email-job-123',
      status: 'sent',
      campaign: { senderId: 'sender-1', userId: 'user-1' },
    });

    await processEmailJob(mockJob);

    // Verify sendMail was called
    expect(sendMail).toHaveBeenCalledWith({
      from: '"Sender" <sender@example.com>',
      to: 'user@example.com',
      subject: 'Test Subject',
      body: 'Test Body',
    });

    // Verify database status updated to sent with preview URL
    expect(prisma.emailJob.update).toHaveBeenCalledWith({
      where: { id: 'email-job-123' },
      data: {
        status: 'sent',
        sentAt: expect.any(Date),
        previewUrl: 'https://ethereal.email/message/abc',
      },
      include: { campaign: true },
    });

    // Verify Redis last send key updated
    expect(redisClient.set).toHaveBeenCalledWith('sender:last-send:sender-1', expect.any(String));
  });
});
