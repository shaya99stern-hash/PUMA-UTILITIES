/** Puma Utilities brand mark: orange puma line-art on a dark rounded tile. */
export function PumaGlyph({ size = 24, color = '#FF7A45', bold = true }: { size?: number; color?: string; bold?: boolean }) {
  return (
    <svg width={size} height={(size * 220) / 336} viewBox="66 104 336 220" fill="none" aria-hidden focusable="false">
      <g fill={color}>
        <path d="M108 250 C148 212 194 180 242 160 L248 176 C202 192 160 218 108 250 Z" />
        <path d="M76 298 C122 250 168 228 206 232 C244 236 270 264 290 308 C262 280 238 262 206 258 C168 254 128 270 76 298 Z" />
      </g>
      <path
        d="M246 170 C236 158 230 144 234 132 C248 128 262 136 272 148 C296 156 322 170 344 184 C360 194 372 204 382 216 C384 224 378 232 370 236 C364 244 358 256 348 268 C340 276 330 274 322 266 C300 256 280 246 268 232 C262 222 262 212 266 204"
        stroke={color}
        strokeWidth={bold ? 15 : 10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M312 188 C324 190 336 197 344 208 C330 208 318 201 312 188 Z" fill={color} />
    </svg>
  );
}

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
      aria-hidden
    >
      <PumaGlyph size={Math.round(size * 0.8)} bold={size < 48} />
    </span>
  );
}
