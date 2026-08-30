import React, { useState } from 'react';
import { EmailJob } from '../services/api';
import Badge from './Badge';
import { Mail, Calendar, Eye, AlertCircle, ChevronDown, ChevronUp, AlertOctagon } from 'lucide-react';

interface EmailsTableProps {
  jobs: EmailJob[];
  type: 'scheduled' | 'sent';
  loading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
  } | null;
}

export const EmailsTable: React.FC<EmailsTableProps> = ({
  jobs,
  type,
  loading,
  pagination,
}) => {
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedJobId(expandedJobId === id ? null : id);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  if (loading) {
    return (
      <div className="w-full rounded-xl bg-white border border-slate-100 overflow-hidden">
        <div className="min-w-full divide-y divide-slate-100 animate-pulse">
          <div className="bg-slate-50/70 h-11" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 px-6 py-4 flex items-center justify-between">
              <div className="flex gap-4 items-center">
                <div className="rounded-full bg-slate-200 h-8 w-8" />
                <div className="flex flex-col gap-2">
                  <div className="h-4 bg-slate-200 rounded w-48" />
                  <div className="h-3 bg-slate-200 rounded w-24" />
                </div>
              </div>
              <div className="h-6 bg-slate-200 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-white border border-slate-100 py-12 px-4 text-center">
        <div className="rounded-full bg-slate-50 p-4 border border-slate-100 text-slate-400">
          <Mail className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-slate-900">No emails found</h3>
        <p className="mt-1.5 text-xs text-slate-500 max-w-sm">
          {type === 'scheduled'
            ? 'There are no emails scheduled, processing, or failed at this time.'
            : 'You have not sent any emails successfully yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl bg-white border border-slate-100 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left text-sm text-slate-700">
          <thead className="bg-slate-50/70 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-6 py-3.5">Recipient</th>
              <th className="px-6 py-3.5">Subject</th>
              <th className="px-6 py-3.5">{type === 'scheduled' ? 'Scheduled Send Time' : 'Sent Time'}</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const isExpanded = expandedJobId === job.id;
              return (
                <React.Fragment key={job.id}>
                  <tr className={`hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-slate-50/30' : ''}`}>
                    <td className="px-6 py-4.5 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="rounded-full bg-slate-100 p-1.5 text-slate-500">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col">
                          <span>{job.recipient}</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            via {job.campaign?.sender?.email || 'System'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4.5 truncate max-w-xs">{job.subject}</td>
                    <td className="px-6 py-4.5 text-slate-500 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        <span>{formatDate(type === 'scheduled' ? job.scheduledAt : job.sentAt || '')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <Badge status={job.status} />
                    </td>
                    <td className="px-6 py-4.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {type === 'sent' && job.previewUrl && (
                          <a
                            href={job.previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Preview Send
                          </a>
                        )}

                        {job.status === 'failed' && (
                          <button
                            onClick={() => toggleExpand(job.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
                          >
                            <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                            Logs
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        )}

                        {job.status === 'scheduled' && (
                          <span className="text-xs text-slate-400 italic font-medium">Queued</span>
                        )}

                        {job.status === 'processing' && (
                          <span className="text-xs text-blue-600 animate-pulse font-semibold">Active...</span>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expandable error logs */}
                  {isExpanded && job.status === 'failed' && (
                    <tr>
                      <td colSpan={5} className="bg-rose-50/20 px-6 py-4 border-l-4 border-rose-500">
                        <div className="flex gap-2">
                          <AlertOctagon className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <h4 className="text-sm font-semibold text-rose-800">Job Error Delivery Logs</h4>
                            <p className="text-xs text-slate-600 bg-white border border-slate-100 rounded-lg p-3 font-mono">
                              {job.errorMessage || 'No error details recorded. Check server worker console.'}
                            </p>
                            <div className="flex gap-4 text-[10px] text-slate-500 mt-2">
                              <span>Total Send Attempts: <b>{job.attempts}</b></span>
                              <span>Campaign ID: <span className="font-mono">{job.campaignId}</span></span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/30 px-6 py-3.5 text-slate-500 text-xs">
          <span>
            Showing page <b>{pagination.page}</b> of <b>{pagination.totalPages}</b> (Total {pagination.total} jobs)
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailsTable;
