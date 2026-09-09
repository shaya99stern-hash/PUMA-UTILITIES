import { NextResponse } from 'next/server';
import { PROSPECTS } from '@/lib/data';
import { scoreBand, scoreBreakdown } from '@/lib/scoring';

export function GET() {
  const prospects = PROSPECTS.map((prospect) => {
    const score = scoreBreakdown(prospect);
    return { ...prospect, opportunityScore: score.total, scoreBand: scoreBand(score.total), scoreBreakdown: score };
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);

  return NextResponse.json({ generatedAt: new Date().toISOString(), prospects });
}
