import React from 'react';

/** Small provider mark for an integration label; it is not an endorsement badge. */
export default function NvidiaBadge({ compact = false }) {
  return (
    <span className={`nvidia-badge ${compact ? 'compact' : ''}`} title="AI model access through NVIDIA NIM">
      <svg className="nvidia-eye" viewBox="0 0 32 24" role="img" aria-label="NVIDIA-inspired eye mark">
        <path d="M2.5 12.2C6.1 6.1 11.4 3.7 17.6 4.9c3.8.7 7.4 2.9 11.3 6.8-3.2 4.4-7.8 7.1-13 7.1-4.7 0-9.2-2-13.4-6.6Z" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
        <path d="M7.2 11.9c2.5-3.6 6.1-5.1 9.8-4.2 2.4.6 4.7 2.1 6.7 4.2-2.5 3.1-5 4.6-7.8 4.6-3.2 0-6.1-1.5-8.7-4.6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="16" cy="11.9" r="3" fill="currentColor" />
      </svg>
      <span className="nvidia-word">NVIDIA</span>
      {!compact && <span className="nvidia-caption">AI FOR TUPP</span>}
    </span>
  );
}
