export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <defs>
        <linearGradient id="hs-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7474f2" />
          <stop offset="1" stopColor="#4a3ec4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#hs-logo-gradient)" />
      <circle cx="14.5" cy="14.5" r="6.25" fill="none" stroke="#fff" strokeWidth="2.5" />
      <path d="M19.3 19.3 24 24" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12.1 14.6l1.7 1.7 3.1-3.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
