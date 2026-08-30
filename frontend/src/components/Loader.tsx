import React from 'react';

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export const Loader: React.FC<LoaderProps> = ({ size = 'md', label }) => {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-3',
    lg: 'h-12 w-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-2 py-6">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-brand-500 border-t-transparent`}
        role="status"
        aria-label="loading"
      />
      {label && <p className="text-sm font-medium text-slate-500">{label}</p>}
    </div>
  );
};

export default Loader;
