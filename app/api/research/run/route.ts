import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Retired v1 research endpoint; use /api/research/jobs. */
const gone = () => json({ error: 'This endpoint was replaced by /api/research/jobs.' }, 410);
export const GET = gone;
export const POST = gone;
