import chunk0 from '@/lib/puma-logo/chunk0';
import chunk1 from '@/lib/puma-logo/chunk1';
import chunk2 from '@/lib/puma-logo/chunk2';
import chunk3 from '@/lib/puma-logo/chunk3';
import chunk4 from '@/lib/puma-logo/chunk4';
import chunk5 from '@/lib/puma-logo/chunk5';

export const runtime = 'nodejs';

export function GET() {
  const bytes = Buffer.from([chunk0, chunk1, chunk2, chunk3, chunk4, chunk5].join(''), 'base64');

  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
