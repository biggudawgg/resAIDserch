/** Mark: three lines of notes, the last ending in a highlighted finding. Keep in sync with the favicon in index.html. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="7" fill="var(--logo-tile, #14594c)" />
      <path d="M9 10.5h14M9 16h14M9 21.5h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="21.5" cy="21.5" r="2.7" fill="#e8a838" />
    </svg>
  )
}
