/**
 * Logo AeroSense: perahu Sungai Musi yang memancarkan gelombang radar.
 * Titik merah = "ping" deteksi; garis hijau = arus sungai.
 */
export function AeroSenseMark({ className = "h-9 w-9", tile = true }: { className?: string; tile?: boolean }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Logo AeroSense">
      {tile && <rect width="512" height="512" rx="116" fill="#0E1A1C" stroke="rgb(236 228 211 / .14)" strokeWidth="6" />}
      <g fill="none" stroke="#E3A93B" strokeLinecap="round" strokeWidth="26">
        <path d="M104 292a152 152 0 0 1 304 0" opacity=".28" />
        <path d="M150 292a106 106 0 0 1 212 0" opacity=".55" />
        <path d="M196 292a60 60 0 0 1 120 0" />
      </g>
      <path d="M256 292 350 172" stroke="#E3A93B" strokeWidth="14" strokeLinecap="round" />
      <circle cx="321" cy="208" r="21" fill="#E5483A" />
      <path d="M72 300c78 68 290 68 368 0-20 46-110 72-184 72S92 346 72 300Z" fill="#E3A93B" />
      <path d="M150 414q26-16 52 0t52 0 52 0 52 0" fill="none" stroke="#3FB9A0" strokeWidth="12" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}

export function AeroSenseWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold tracking-tight ${className}`}>
      Aero<span className="text-gold">Sense</span>
    </span>
  );
}
