import React, { useState, useEffect } from 'react';
import {
  UserProfile,
  SlackStatus,
  EmailJob,
  getProfile,
  logoutUser,
  fetchSlackStatus,
  disconnectSlack,
  fetchScheduledEmails,
  fetchSentEmails,
  scheduleEmails,
  searchEmails,
  SchedulePayload,
} from './services/api';
import ComposeModal from './components/ComposeModal';
import EmailsTable from './components/EmailsTable';
import Loader from './components/Loader';
import {
  Mail,
  Send,
  Calendar,
  LogOut,
  Slack,
  Plus,
  Search,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');

  const [scheduledJobs, setScheduledJobs] = useState<EmailJob[]>([]);
  const [sentJobs, setSentJobs] = useState<EmailJob[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EmailJob[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [scheduledPage, setScheduledPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [sentTotal, setSentTotal] = useState(0);
  const [scheduledPages, setScheduledPages] = useState(1);
  const [sentPages, setSentPages] = useState(1);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showToast = (
    message: string,
    type: 'success' | 'error' = 'success'
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Check authentication
  useEffect(() => {
    const initAuth = async () => {
      try {
        const profile = await getProfile();
        setUser(profile);

        const slack = await fetchSlackStatus();
        setSlackStatus(slack);
      } catch (err) {
        setUser(null);
      } finally {
        setLoadingProfile(false);
      }
    };

    initAuth();
  }, []);

  // Handle OAuth callback messages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('slack') === 'connected') {
      showToast('Slack successfully connected!', 'success');

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );

      fetchSlackStatus().then(setSlackStatus);
    } else if (params.get('slack') === 'failed') {
      showToast('Slack connection aborted or failed.', 'error');

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
    }

    if (params.get('error') === 'oauth_failed') {
      showToast(
        'Google login failed. Please check the Google OAuth configuration.',
        'error'
      );

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
    }
  }, []);

  // Fetch emails
  useEffect(() => {
    if (!user) return;

    setSearchQuery('');
    setSearchResults(null);

    const loadEmails = async (showLoader = true) => {
      if (showLoader) {
        setLoadingEmails(true);
      }

      try {
        if (activeTab === 'scheduled') {
          const res = await fetchScheduledEmails(scheduledPage, 10);

          setScheduledJobs(res.data);
          setScheduledTotal(res.pagination.total);
          setScheduledPages(res.pagination.totalPages);
        } else {
          const res = await fetchSentEmails(sentPage, 10);

          setSentJobs(res.data);
          setSentTotal(res.pagination.total);
          setSentPages(res.pagination.totalPages);
        }
      } catch (err) {
        if (showLoader) {
          showToast('Failed to load email jobs', 'error');
        }
      } finally {
        if (showLoader) {
          setLoadingEmails(false);
        }
      }
    };

    loadEmails();

    const refreshTimer = window.setInterval(() => {
      loadEmails(false);
    }, 3000);

    return () => window.clearInterval(refreshTimer);
  }, [user, activeTab, scheduledPage, sentPage]);

  // Google login
  const handleGoogleLogin = () => {
    window.location.href = `${BACKEND_URL}/auth/google`;
  };

  // Logout
  const handleLogout = async () => {
    try {
      await logoutUser();

      setUser(null);
      setSlackStatus(null);

      showToast('Logged out successfully');
    } catch (err) {
      showToast('Logout failed', 'error');
    }
  };

  // Slack connect
  const handleConnectSlack = () => {
    window.location.href = `${BACKEND_URL}/slack/connect`;
  };

  // Slack disconnect
  const handleDisconnectSlack = async () => {
    if (
      !window.confirm(
        'Are you sure you want to disconnect Slack? You will stop receiving sender rate limit warnings.'
      )
    ) {
      return;
    }

    try {
      await disconnectSlack();

      setSlackStatus({
        connected: false,
        connection: null,
      });

      showToast('Slack disconnected successfully');
    } catch (err) {
      showToast('Failed to disconnect Slack', 'error');
    }
  };

  // Schedule campaign
  const handleScheduleCampaign = async (payload: SchedulePayload) => {
    try {
      await scheduleEmails(payload);

      showToast('Campaign scheduled successfully');

      setScheduledPage(1);

      const res = await fetchScheduledEmails(1, 10);

      setScheduledJobs(res.data);
      setScheduledTotal(res.pagination.total);
      setScheduledPages(res.pagination.totalPages);
    } catch (err) {
      showToast('Failed to schedule campaign', 'error');
      throw err;
    }
  };

  // Search
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);

    try {
      const results = await searchEmails(searchQuery);
      setSearchResults(results);
    } catch (err) {
      showToast(
        'Search indexing service failed or unavailable',
        'error'
      );
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  // Refresh
  const triggerRefresh = async () => {
    setLoadingEmails(true);

    try {
      if (activeTab === 'scheduled') {
        const res = await fetchScheduledEmails(scheduledPage, 10);

        setScheduledJobs(res.data);
        setScheduledTotal(res.pagination.total);
        setScheduledPages(res.pagination.totalPages);
      } else {
        const res = await fetchSentEmails(sentPage, 10);

        setSentJobs(res.data);
        setSentTotal(res.pagination.total);
        setSentPages(res.pagination.totalPages);
      }

      showToast('Data refreshed');
    } catch (err) {
      showToast('Refresh failed', 'error');
    } finally {
      setLoadingEmails(false);
    }
  };

  // Loading
  if (loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader
          size="lg"
          label="Loading ReachInbox Scheduler..."
        />
      </div>
    );
  }

  // Login page
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-slate-50">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center text-brand-600">
            <Mail className="h-12 w-12" />
          </div>

          <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900 tracking-tight">
            ReachInbox
          </h2>

          <p className="mt-2 text-center text-sm text-slate-500 font-medium">
            Full-Stack Email Job Scheduler
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow-xl border border-slate-100 rounded-xl sm:px-10 text-center">
            <h3 className="text-md font-semibold text-slate-800 mb-6">
              Sign in to your Workspace
            </h3>

            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-lg shadow-xs bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors cursor-pointer"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                width="24"
                height="24"
              >
                <g transform="matrix(1, 0, 0, 1, 0, 0)">
                  <path
                    d="M21.35,11.1H12v2.7h5.38C16.88,15.69,14.8,17,12,17c-3.18,0-5.7-2.31-5.7-5.5s2.52-5.5,5.7-5.5c1.69,0,3,0.61,4,1.48l2.1-2.1C16.48,3.79,14.43,3,12,3c-4.97,0-9,4.03-9,9s4.03,9,9,9c4.54,0,8.55-3.3,8.55-9C20.55,11.69,20.43,11.39,21.35,11.1Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M3.55,14.85l2.67-1.92A5.44,5.44,0,0,1,6.3,12c0-.3.05-.59.15-.9L3.78,9.15A8.99,8.99,0,0,0,3,12,8.99,8.99,0,0,0,3.55,14.85Z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12,6.3c1.69,0,3,.61,4,1.48l2.1-2.1C16.48,3.79,14.43,3,12,3c-4.97,0-9,4.03-9,9,0,.3,0,.6,0.05,0.9L6.42,11.1A5.46,5.46,0,0,1,12,6.3Z"
                    fill="#EA4335"
                  />
                  <path
                    d="M12,17.7A5.46,5.46,0,0,1,6.42,12.9L3.75,14.82A8.99,8.99,0,0,0,12,21c2.4,0,4.45-.79,6.08-2.15l-2.18-1.7A5.42,5.42,0,0,1,12,17.7Z"
                    fill="#34A853"
                  />
                </g>
              </svg>

              <span>Continue with Google</span>
            </button>

            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-2 items-center text-[10px] text-slate-400">
              <span>Evaluating Intern Code Project</span>
              <span>
                ReachInbox Email Scheduler &bull; 2026
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 pb-12">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-xl transition-all animate-bounce bg-white border-slate-100 max-w-sm">
          {toast.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          )}

          <span className="text-sm font-semibold text-slate-800">
            {toast.message}
          </span>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2 text-brand-600 font-extrabold text-lg tracking-tight">
              <Mail className="h-6 w-6" />
              <span>ReachInbox</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5 border-r border-slate-200 pr-4">
                {user.avatar ? (
                  <img
                    className="h-9 w-9 rounded-full border border-slate-100 object-cover"
                    src={user.avatar}
                    alt={user.name}
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center font-bold text-sm uppercase">
                    {user.name.slice(0, 2)}
                  </div>
                )}

                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-sm font-bold text-slate-800 leading-tight">
                    {user.name}
                  </span>

                  <span className="text-xs text-slate-400 font-medium leading-none">
                    {user.email}
                  </span>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-8 flex-1 w-full space-y-6">
        {/* Slack */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex gap-3">
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2 text-indigo-700 shrink-0">
              <Slack className="h-6 w-6" />
            </div>

            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                Slack Rate Limit Warnings

                {slackStatus?.connected ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 uppercase">
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 border border-slate-200 uppercase">
                    Disconnected
                  </span>
                )}
              </h3>

              <p className="text-xs text-slate-500 max-w-xl font-medium">
                Connect your Slack workspace. We will ping you instantly via
                Slack DM when your email senders breach their hourly rate
                limit cap.
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex justify-end shrink-0">
            {slackStatus?.connected ? (
              <button
                onClick={handleDisconnectSlack}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/50 hover:bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition-colors cursor-pointer"
              >
                Disconnect Slack
              </button>
            ) : (
              <button
                onClick={handleConnectSlack}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
              >
                <Slack className="h-4.5 w-4.5" />
                Connect Slack
              </button>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-5">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('scheduled')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                activeTab === 'scheduled'
                  ? 'bg-brand-50 border-brand-200 text-brand-600 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Calendar className="h-4 w-4" />
              <span>Scheduled Emails</span>

              {scheduledTotal > 0 && (
                <span className="ml-1 rounded-full bg-brand-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-600">
                  {scheduledTotal}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('sent')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                activeTab === 'sent'
                  ? 'bg-brand-50 border-brand-200 text-brand-600 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Send className="h-4 w-4" />
              <span>Sent Emails</span>

              {sentTotal > 0 && (
                <span className="ml-1 rounded-full bg-brand-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-600">
                  {sentTotal}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <form
              onSubmit={handleSearchSubmit}
              className="relative flex items-center"
            >
              <input
                type="text"
                placeholder="Search recipient, subject..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-64 rounded-lg border border-slate-200 bg-white pl-9 pr-8 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
              />

              <Search className="absolute left-3.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />

              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  &times;
                </button>
              )}
            </form>

            <button
              onClick={triggerRefresh}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-600 transition-colors"
              title="Refresh lists"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <button
              onClick={() => setIsComposeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-4.5 py-2.5 text-xs font-bold text-white shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <Plus className="h-4.5 w-4.5" />
              Compose New Email
            </button>
          </div>
        </div>

        {/* Search results */}
        {searchResults !== null && (
          <div className="flex items-center justify-between rounded-lg bg-brand-50/50 border border-brand-100 px-4.5 py-3 text-xs text-brand-800 font-medium">
            <span>
              Search Results in <b>{activeTab}</b> database matching "
              <b>{searchQuery}</b>" (Found {searchResults.length} records)
            </span>

            <button
              onClick={clearSearch}
              className="font-bold underline hover:text-brand-900"
            >
              Clear Search
            </button>
          </div>
        )}

        {/* Emails */}
        <EmailsTable
          jobs={
            searchResults !== null
              ? searchResults
              : activeTab === 'scheduled'
              ? scheduledJobs
              : sentJobs
          }
          type={activeTab}
          loading={loadingEmails || isSearching}
          pagination={
            searchResults !== null
              ? null
              : activeTab === 'scheduled'
              ? {
                  page: scheduledPage,
                  totalPages: scheduledPages,
                  total: scheduledTotal,
                  onPageChange: setScheduledPage,
                }
              : {
                  page: sentPage,
                  totalPages: sentPages,
                  total: sentTotal,
                  onPageChange: setSentPage,
                }
          }
        />
      </main>

      {/* Compose */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        senders={user.senders}
        onSchedule={handleScheduleCampaign}
      />
    </div>
  );
};

export default App;
