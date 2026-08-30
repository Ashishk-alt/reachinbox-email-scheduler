import React, { useState, useEffect } from 'react';
import { Sender, SchedulePayload } from '../services/api';
import { X, Upload, CheckCircle2, AlertCircle, Info } from 'lucide-react';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  senders: Sender[];
  onSchedule: (payload: SchedulePayload) => Promise<void>;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  senders,
  onSchedule,
}) => {
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startTime, setStartTime] = useState('');
  const [delay, setDelay] = useState('2'); // default 2 seconds
  const [hourlyLimit, setHourlyLimit] = useState('200'); // default 200 emails
  
  // CSV parse state
  const [parsedValid, setParsedValid] = useState<string[]>([]);
  const [parsedInvalid, setParsedInvalid] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Default start time to current time (local timezone formatted for datetime-local input)
  useEffect(() => {
    const now = new Date();
    // Offset local timezone
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    setStartTime(localISOTime);
  }, [isOpen]);

  // Set default sender when list loads
  useEffect(() => {
    if (senders.length > 0 && !senderId) {
      setSenderId(senders[0].id);
    }
  }, [senders, senderId]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result as string;
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const lines = text.split(/\r?\n/);
      const validSet = new Set<string>();
      const invalidSet = new Set<string>();

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const parts = line.split(',');
        for (let part of parts) {
          part = part.trim();
          if (!part) continue;

          const lower = part.toLowerCase();
          if (['email', 'emails', 'recipient', 'recipients', 'to', 'address'].includes(lower)) {
            continue;
          }

          if (EMAIL_REGEX.test(part)) {
            validSet.add(part.toLowerCase());
          } else {
            // Check if looks like quotes or header columns
            const cleaned = part.replace(/['"“”]/g, '').trim();
            if (cleaned && !cleaned.includes('@') && lines.indexOf(line) === 0) {
              continue;
            }
            invalidSet.add(part);
          }
        }
      }

      setParsedValid(Array.from(validSet));
      setParsedInvalid(Array.from(invalidSet));
      setErrorMsg('');
    };

    reader.onerror = () => {
      setErrorMsg('Failed to read file. Make sure it is a valid text/CSV file.');
    };

    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!senderId) {
      setErrorMsg('Please select a sender email.');
      return;
    }
    if (!subject.trim()) {
      setErrorMsg('Please provide a subject line.');
      return;
    }
    if (!body.trim()) {
      setErrorMsg('Please provide the email body content.');
      return;
    }
    if (parsedValid.length === 0) {
      setErrorMsg('Please upload a CSV or text file containing at least one valid recipient email address.');
      return;
    }
    if (!startTime) {
      setErrorMsg('Please specify a start time.');
      return;
    }

    const delayMs = parseInt(delay, 10) * 1000;
    if (isNaN(delayMs) || delayMs < 0) {
      setErrorMsg('Delay must be a positive number of seconds (or 0).');
      return;
    }

    const limitVal = parseInt(hourlyLimit, 10);
    if (isNaN(limitVal) || limitVal <= 0) {
      setErrorMsg('Hourly rate limit must be a positive integer.');
      return;
    }

    setLoading(true);
    try {
      // Create campaign schedule payload
      const payload: SchedulePayload = {
        senderId,
        subject,
        body,
        recipients: parsedValid,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmails: delayMs,
        hourlyLimit: limitVal,
      };

      await onSchedule(payload);
      
      // Reset form states
      setSubject('');
      setBody('');
      setParsedValid([]);
      setParsedInvalid([]);
      setFileName('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Compose &amp; Schedule Email</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-500 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 p-3.5 text-sm font-medium text-rose-800">
              <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Sender */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sender Email</label>
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName ? `${s.displayName} <${s.email}>` : s.email}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject</label>
            <input
              type="text"
              placeholder="e.g. Welcome to the Software Internship Program!"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Body</label>
            <textarea
              rows={6}
              placeholder="Write your email template here... Supports plain text. Supports \n for newlines."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20 resize-y"
            />
          </div>

          {/* CSV File Upload & Display */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Upload Recipients (CSV / Text)
            </label>
            <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-200 px-6 py-6 hover:border-brand-500 transition-colors">
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8 text-slate-400" />
                <div className="mt-2.5 flex justify-center text-sm text-slate-600">
                  <label className="relative cursor-pointer rounded-md font-semibold text-brand-600 hover:text-brand-700">
                    <span>Upload a file</span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileChange}
                      className="sr-only"
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-slate-400 mt-1">CSV or TXT files containing email addresses</p>
              </div>
            </div>

            {fileName && (
              <div className="mt-3.5 rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-800 truncate max-w-[250px]">{fileName}</span>
                  <span className="text-slate-500">{parsedValid.length + parsedInvalid.length} entries parsed</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex flex-col gap-1 rounded-md bg-emerald-50/60 p-2.5 text-emerald-800 border border-emerald-100/50">
                    <span className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Valid Recipients ({parsedValid.length})
                    </span>
                    <div className="max-h-20 overflow-y-auto mt-1 space-y-0.5 max-w-full font-mono text-[10px] break-all">
                      {parsedValid.slice(0, 50).map((email, idx) => (
                        <div key={idx}>{email}</div>
                      ))}
                      {parsedValid.length > 50 && <div>...and {parsedValid.length - 50} more</div>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 rounded-md bg-rose-50/60 p-2.5 text-rose-800 border border-rose-100/50">
                    <span className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4 text-rose-600" />
                      Invalid / Skipped ({parsedInvalid.length})
                    </span>
                    {parsedInvalid.length > 0 ? (
                      <div className="max-h-20 overflow-y-auto mt-1 space-y-0.5 font-mono text-[10px] break-all">
                        {parsedInvalid.map((item, idx) => (
                          <div key={idx} className="line-through opacity-70">{item}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic mt-1">None</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Config parameters */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Date &amp; Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                Delay (seconds)
                <span className="group relative text-slate-400 cursor-help">
                  <Info className="h-3.5 w-3.5" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-48 rounded bg-slate-800 p-2 text-center text-[10px] font-normal text-white shadow-md z-10">
                    Delay inserted between consecutive email sends.
                  </span>
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                Hourly Limit
                <span className="group relative text-slate-400 cursor-help">
                  <Info className="h-3.5 w-3.5" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-48 rounded bg-slate-800 p-2 text-center text-[10px] font-normal text-white shadow-md z-10">
                    Max emails sent per hour. Excess is rescheduled.
                  </span>
                </span>
              </label>
              <input
                type="number"
                min="1"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-hidden focus:ring-2 focus:ring-brand-500/50 disabled:bg-brand-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Scheduling...' : 'Schedule Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComposeModal;
