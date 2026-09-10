import { NextResponse } from 'next/server';
import { scoreBand, scoreCompany } from '@/lib/scoring';
import { createReleaseOneWorkspace, RELEASE_RETRIEVED_AT, WORKSPACE_RELEASE } from '@/lib/seed';

/**
 * A safe, static public-research summary. Browser workspace records are local
 * only and are deliberately not exposed through this route handler.
 */
export function GET() {
  const workspace = createReleaseOneWorkspace();
  const companies = workspace.companies
    .map((company) => {
      const score = scoreCompany(company, workspace);
      const sources = company.provenance
        .filter((source) => source.status === 'verified-public')
        .map((source) => ({ label: source.label, url: source.reference, retrievedAt: source.retrievedAt }));
      const portfolio = (company.portfolio ?? []).map((metric) => ({
        statement: metric.statement ?? `${metric.value}${metric.qualifier === 'at-least' ? '+' : ''} ${metric.label}`,
        label: metric.label,
        status: metric.status,
      }));

      return {
        id: company.id,
        name: company.name,
        stage: company.stage,
        market: company.market,
        researchTarget: true,
        clientAuthorizedMonitoring: false,
        portfolio,
        publicSources: sources,
        score: score.total === undefined ? null : score.total,
        scoreBand: score.total === undefined ? null : scoreBand(score.total),
        researchCompleteness: {
          sourcedFactors: score.factors.filter((factor) => factor.state === 'evidenced').length,
          totalFactors: score.factors.length,
          missingEvidence: score.factors.filter((factor) => factor.state === 'unknown').map((factor) => factor.label),
        },
        nextAction: company.nextAction,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return NextResponse.json({
    generatedAt: RELEASE_RETRIEVED_AT,
    workspaceRelease: WORKSPACE_RELEASE,
    scope: 'Static public research seeds only; local browser workspace and client-authorized records are never returned.',
    companies,
    // Kept for callers of the legacy endpoint name. These are research targets,
    // not prospects with asserted water problems or active client accounts.
    prospects: companies,
  });
}
