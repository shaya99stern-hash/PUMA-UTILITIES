import { ImageResponse } from 'next/og';

/** App icon: orange puma line-art on a near-black tile (safe zone kept for maskable icons). */
export function pumaIcon(_request: Request, size: number) {
  const glyph = Math.round(size * 0.66);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #1d1d21 0%, #0b0b0c 100%)',
        }}
      >
        <svg width={glyph} height={Math.round((glyph * 220) / 336)} viewBox="66 104 336 220" fill="none">
          <path d="M108 250 C148 212 194 180 242 160 L248 176 C202 192 160 218 108 250 Z" fill="#FF7A45" />
          <path d="M76 298 C122 250 168 228 206 232 C244 236 270 264 290 308 C262 280 238 262 206 258 C168 254 128 270 76 298 Z" fill="#FF7A45" />
          <path
            d="M246 170 C236 158 230 144 234 132 C248 128 262 136 272 148 C296 156 322 170 344 184 C360 194 372 204 382 216 C384 224 378 232 370 236 C364 244 358 256 348 268 C340 276 330 274 322 266 C300 256 280 246 268 232 C262 222 262 212 266 204"
            stroke="#FF7A45"
            strokeWidth={12}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M312 188 C324 190 336 197 344 208 C330 208 318 201 312 188 Z" fill="#FF7A45" />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    },
  );
}
