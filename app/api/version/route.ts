export const dynamic = 'force-dynamic';
export const revalidate = 0;

function deploymentId() {
  return process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'development';
}

export function GET() {
  return Response.json(
    { deploymentId: deploymentId() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
