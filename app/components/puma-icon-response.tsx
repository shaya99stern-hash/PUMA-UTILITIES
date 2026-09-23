import { ImageResponse } from 'next/og';

export function pumaIcon(_request: Request, size: number) {
  const source = new URL('/puma-home-icon.jpeg', _request.url).toString();

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
          src={source}
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
