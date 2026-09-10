import type {
  Company,
  EvidenceStatus,
  Meter,
  OpportunityScore,
  ScoreFactor,
  UtilityService,
  Workspace,
} from './types';

const isVerified = (status: EvidenceStatus) =>
  status === 'verified-public' || status === 'client-authorized';

const scoreFactor = (
  factor: Omit<ScoreFactor, 'state'> & { points?: number },
): ScoreFactor => ({
  ...factor,
  state: factor.points === undefined ? 'unknown' : 'evidenced',
});

function companyProperties(company: Company, workspace: Workspace) {
  return workspace.properties.filter((property) => property.companyId === company.id);
}

function companyUtilities(company: Company, workspace: Workspace): UtilityService[] {
  const propertyIds = new Set(companyProperties(company, workspace).map((property) => property.id));
  return workspace.utilities.filter((utility) => propertyIds.has(utility.propertyId));
}

function companyMeters(company: Company, workspace: Workspace): Meter[] {
  const utilityIds = new Set(companyUtilities(company, workspace).map((utility) => utility.id));
  return workspace.meters.filter((meter) => utilityIds.has(meter.utilityServiceId));
}

function portfolioFactor(company: Company): ScoreFactor {
  const buildings = company.portfolioBuildings;
  if (buildings.value === undefined || !isVerified(buildings.status)) {
    return scoreFactor({
      id: 'portfolio',
      label: 'Portfolio fit',
      maxPoints: 20,
      detail: 'Needs a sourced building count; unknown is not scored as zero.',
    });
  }

  const points = buildings.value >= 12 && buildings.value <= 250
    ? 20
    : buildings.value >= 6 && buildings.value < 12
      ? 8
      : buildings.value > 250
        ? 4
        : 0;

  return scoreFactor({
    id: 'portfolio',
    label: 'Portfolio fit',
    maxPoints: 20,
    points,
    detail: buildings.value >= 12 && buildings.value <= 250
      ? `${buildings.value} sourced buildings fits the regional multifamily target.`
      : buildings.value > 250
        ? `${buildings.value} sourced buildings needs a regional-fit review.`
        : `${buildings.value} sourced buildings is below the preferred 12-building target.`,
  });
}

function dataAvailabilityFactor(company: Company, workspace: Workspace): ScoreFactor {
  const properties = companyProperties(company, workspace);
  // A company website can support a portfolio statement, but it is not itself
  // property-level water/utility evidence. Keep this factor unknown until a
  // source is tied to a resolved property or an authorized reading exists.
  const hasPublicPropertyEvidence = properties
    .flatMap((property) => property.provenance)
    .some((source) => source.status === 'verified-public');
  const hasAuthorizedReading = companyMeters(company, workspace)
    .flatMap((meter) => meter.readings)
    .some((reading) => reading.status === 'client-authorized');

  if (!hasPublicPropertyEvidence && !hasAuthorizedReading) {
    return scoreFactor({
      id: 'data-availability',
      label: 'Data availability',
      maxPoints: 20,
      detail: 'Needs a traceable property-level public record or client-authorized reading.',
    });
  }

  return scoreFactor({
    id: 'data-availability',
    label: 'Data availability',
    maxPoints: 20,
    points: hasAuthorizedReading ? 20 : 15,
    detail: hasAuthorizedReading
      ? 'Client-authorized usage is present.'
      : 'Traceable property-level public research is present; usage is not authorized yet.',
  });
}

function meterPortalFactor(company: Company, workspace: Workspace): ScoreFactor {
  const utilities = companyUtilities(company, workspace)
    .filter((utility) => isVerified(utility.status))
    .filter((utility) => utility.capability !== 'unknown' || utility.portal !== 'unknown');

  if (utilities.length === 0) {
    return scoreFactor({
      id: 'meter-portal',
      label: 'Meter & portal opportunity',
      maxPoints: 20,
      detail: 'Needs a sourced meter or portal capability. Missing evidence is not a lack-of-visibility finding.',
    });
  }

  const strongest = utilities.reduce((best, utility) => {
    const value = utility.portal === 'not-visible' || utility.capability === 'newly-installed'
      ? 20
      : utility.portal === 'public-portal'
        ? 15
        : utility.capability === 'smart-meter'
          ? 10
          : 5;
    return Math.max(best, value);
  }, 0);

  return scoreFactor({
    id: 'meter-portal',
    label: 'Meter & portal opportunity',
    maxPoints: 20,
    points: strongest,
    detail: strongest === 20
      ? 'A sourced meter/portal visibility opportunity is recorded.'
      : 'A sourced meter or portal capability is recorded; validate the buyer path.',
  });
}

function suspectedExcessFactor(company: Company, workspace: Workspace): ScoreFactor {
  const readings = companyMeters(company, workspace)
    .flatMap((meter) => meter.readings)
    .filter((reading) => isVerified(reading.status))
    .filter((reading) => reading.gallons !== undefined && reading.expectedGallons !== undefined && reading.expectedGallons > 0);

  if (readings.length === 0) {
    return scoreFactor({
      id: 'suspected-excess',
      label: 'Suspected excess use',
      maxPoints: 25,
      detail: 'Needs a sourced actual-use and expected-use comparison.',
    });
  }

  const highestRatio = Math.max(...readings.map((reading) => (reading.gallons ?? 0) / (reading.expectedGallons ?? 1)));
  const points = highestRatio >= 1.25 ? 25 : highestRatio >= 1.1 ? 15 : 0;
  const percent = Math.round((highestRatio - 1) * 100);
  return scoreFactor({
    id: 'suspected-excess',
    label: 'Suspected excess use',
    maxPoints: 25,
    points,
    detail: percent > 0
      ? `Authorized or public comparison is ${percent}% above its stated expected use.`
      : 'Sourced comparison does not show use above its stated expected baseline.',
  });
}

function decisionMakerFactor(company: Company): ScoreFactor {
  const people = company.people.filter((person) => isVerified(person.status));
  if (people.length === 0) {
    return scoreFactor({
      id: 'decision-maker',
      label: 'Decision-maker access',
      maxPoints: 15,
      detail: 'Needs a traceable person or operating contact.',
    });
  }

  const reachable = people.some((person) => Boolean(person.email || person.phone));
  return scoreFactor({
    id: 'decision-maker',
    label: 'Decision-maker access',
    maxPoints: 15,
    points: reachable ? 15 : 8,
    detail: reachable
      ? 'A sourced contact method is recorded.'
      : 'A sourced decision-maker or operating contact is recorded; a contact method is still needed.',
  });
}

/**
 * Deterministic and evidence-gated. A partial score is deliberately never
 * shown as a lead score, because it would make unknown facts look like zero.
 */
export function scoreCompany(company: Company, workspace: Workspace): OpportunityScore {
  const factors = [
    portfolioFactor(company),
    dataAvailabilityFactor(company, workspace),
    meterPortalFactor(company, workspace),
    suspectedExcessFactor(company, workspace),
    decisionMakerFactor(company),
  ];
  const evidenced = factors.filter((factor) => factor.state === 'evidenced').length;
  const total = evidenced === factors.length
    ? factors.reduce((sum, factor) => sum + (factor.points ?? 0), 0)
    : undefined;

  return {
    factors,
    total,
    completeness: evidenced / factors.length,
  };
}

export function scoreBand(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 75) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}
