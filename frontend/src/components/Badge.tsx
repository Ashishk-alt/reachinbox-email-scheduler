import React from 'react';

interface BadgeProps {
  status: 'scheduled' | 'processing' | 'sent' | 'failed';
}

export const Badge: React.FC<BadgeProps> = ({ status }) => {
  const styles = {
    scheduled: 'bg-amber-50 text-amber-700 border-amber-200',
    processing: 'bg-blue-50 text-blue-700 border-blue-200',
    sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
  };

  const label = {
    scheduled: 'Scheduled',
    processing: 'Processing',
    sent: 'Sent',
    failed: 'Failed',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${styles[status]}`}>
      {label[status]}
    </span>
  );
};

export default Badge;
