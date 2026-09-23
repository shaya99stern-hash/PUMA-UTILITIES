import { ImageResponse } from 'next/og';

export function pumaIcon(request: Request, size: number) {
  const sourceUrl = new URL('/puma-home-icon.jpeg', request.url).toString();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#050607',
        }}
      >
        <img
          src={sourceUrl}
          width={size}
          height={size}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
