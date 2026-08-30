import axios from 'axios';
const API_BASE_URL = 'https://reachinbox-email-scheduler-yd4h.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Crucial to pass JWT cookie back and forth
});

export interface Sender {
  id: string;
  email: string;
  displayName: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  senders: Sender[];
}

export interface EmailJob {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: 'scheduled' | 'processing' | 'sent' | 'failed';
  attempts: number;
  errorMessage: string | null;
  previewUrl: string | null;
  createdAt: string;
  campaign?: {
    sender: {
      email: string;
    };
  };
}

export interface PaginatedResult<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SlackStatus {
  connected: boolean;
  connection: {
    connectedAt: string;
    slackUserId: string | null;
  } | null;
}

// Authentication API calls
export async function getProfile(): Promise<UserProfile> {
  const response = await api.get<{ success: boolean; data: UserProfile }>('/auth/me');
  return response.data.data;
}

export async function logoutUser(): Promise<void> {
  await api.post('/auth/logout');
}

// Email scheduling API calls
export interface SchedulePayload {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
}

export async function scheduleEmails(payload: SchedulePayload) {
  const response = await api.post<{ success: boolean; message: string; data: any }>('/emails/schedule', payload);
  return response.data;
}

export async function fetchScheduledEmails(page = 1, limit = 10): Promise<PaginatedResult<EmailJob>> {
  const response = await api.get<PaginatedResult<EmailJob>>(`/emails/scheduled?page=${page}&limit=${limit}`);
  return response.data;
}

export async function fetchSentEmails(page = 1, limit = 10): Promise<PaginatedResult<EmailJob>> {
  const response = await api.get<PaginatedResult<EmailJob>>(`/emails/sent?page=${page}&limit=${limit}`);
  return response.data;
}

export async function searchEmails(query: string): Promise<EmailJob[]> {
  const response = await api.get<{ success: boolean; data: EmailJob[] }>(`/emails/search?q=${encodeURIComponent(query)}`);
  return response.data.data;
}

// Slack Connection API calls
export async function fetchSlackStatus(): Promise<SlackStatus> {
  const response = await api.get<{ success: boolean; data: SlackStatus }>('/slack/status');
  return response.data.data;
}

export async function disconnectSlack(): Promise<void> {
  await api.post('/slack/disconnect');
}

export default api;
