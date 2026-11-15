/** AETHON brand mark (inline SVG) + optional wordmark. */
export function AethonMark({ size = 36, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="AETHON"
      className={className}
    >
      {/* A-shaped chevron */}
      <path d="M24 5 L41 42 H33.5 L24 20.5 L14.5 42 H7 Z" fill="#E6EAF4" />
      {/* small ember inside the A */}
      <path
        d="M24 40 C19.6 40 18.2 35.8 20.4 32.6 C20.9 34.4 22.2 35 22.2 35 C21.8 31.6 23.2 29 25.2 27.6 C25.2 30.4 28 31.4 28 35.4 C28 38 26.4 40 24 40 Z"
        fill="#F2803A"
      />
      {/* orbit ring */}
      <ellipse
        cx="24"
        cy="28"
        rx="21"
        ry="6.2"
        transform="rotate(-22 24 28)"
        fill="none"
        stroke="#5EC6D9"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="46 20"
      />
      {/* single spark */}
      <path d="M39 7 L40 10 L43 11 L40 12 L39 15 L38 12 L35 11 L38 10 Z" fill="#A79BFA" />
    </svg>
  );
}

export default function AethonLogo({ size = 36, showWordmark = true, subtitle }) {
  return (
    <div className="flex items-center gap-3">
      <AethonMark size={size} />
      {showWordmark && (
        <div className="leading-tight">
          <h1
            className="block m-0 font-bold text-[17px] text-slate-100"
            style={{ letterSpacing: '0.28em' }}
          >
            AETHON
          </h1>
          {subtitle && (
            <span className="hidden sm:block text-[11px] text-slate-400 mt-0.5">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
