/** Veritas logo mark — shield + check, emerald on zinc. */
export function VeritasLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" className="fill-emerald-500/10" stroke="url(#vg)" strokeWidth="1.5" />
      <path
        d="M16 6.5 L24 9.5 V15.5 C24 21 20.5 24.5 16 26 C11.5 24.5 8 21 8 15.5 V9.5 Z"
        className="fill-emerald-500/15"
        stroke="#34d399"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12.2 15.8 L15 18.6 L20 12.6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#34d399" stopOpacity="0.9" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0.35" />
        </linearGradient>
      </defs>
    </svg>
  );
}
