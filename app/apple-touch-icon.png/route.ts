import chunk0 from '@/lib/pwa-icon/chunk0';
import chunkA from '@/lib/pwa-icon/chunkA';
import chunk1 from '@/lib/pwa-icon/chunk1';
import chunk2 from '@/lib/pwa-icon/chunk2';
import chunk3 from '@/lib/pwa-icon/chunk3';
import chunkZ from '@/lib/pwa-icon/chunkZ';

export const runtime = 'nodejs';

export function GET() {
  const bytes = Buffer.from([chunk0, chunkA, chunk1, chunk2, chunk3, chunkZ].join(''), 'base64');

  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
