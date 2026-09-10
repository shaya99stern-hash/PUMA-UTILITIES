import type {
  ActivityNote,
  Company,
  Property,
  UtilityService,
  Workspace,
} from './types';

export type PortfolioFitStatus = 'ideal' | 'too-small' | 'corporate-scale' | 'unknown';

export type PortfolioFit = {
  status: PortfolioFitStatus;
  count?: number;
  basis?: 'buildings' | 'properties' | 'locations' | 'communities';
};

const DEFAULT_MIN_PORTFOLIO = 12;
const DEFAULT_MAX_PORTFOLIO = 250;

function usablePortfolioCount(company: Company): PortfolioFit {
  if (
    company.portfolioBuildings.status !== 'unknown'
    && typeof company.portfolioBuildings.value === 'number'
  ) {
    return {
      status: 'ideal',
      count: company.portfolioBuildings.value,
      basis: 'buildings',
    };
  }

  const candidate = company.portfolio?.find((metric) =>
    ['buildings', 'properties', 'locations', 'communities'].includes(metric.label)
    && metric.status !== 'unknown',
  );

  if (!candidate) return { status: 'unknown' };
  return {
    status: 'ideal',
    count: candidate.value,
    basis: candidate.label as PortfolioFit['basis'],
  };
}

export function classifyPortfolioFit(
  company: Company,
  options: { min?: number; max?: number } = {},
): PortfolioFit {
  const min = options.min ?? DEFAULT_MIN_PORTFOLIO;
  const max = options.max ?? DEFAULT_MAX_PORTFOLIO;
  const measured = usablePortfolioCount(company);

  if (measured.count === undefined) return { status: 'unknown' };
  if (measured.count < min) return { ...measured, status: 'too-small' };
  if (measured.count > max) return { ...measured, status: 'corporate-scale' };
  return { ...measured, status: 'ideal' };
}

export function summarizeMeterCoverage(
  properties: Property[],
  utilities: UtilityService[],
): {
  properties: number;
  smartReady: number;
  manual: number;
  unknown: number;
  smartReadyPercentOfKnown?: number;
} {
  const byProperty = new Map<string, UtilityService[]>();
  for (const utility of utilities) {
    const existing = byProperty.get(utility.propertyId) ?? [];
    existing.push(utility);
    byProperty.set(utility.propertyId, existing);
  }

  let smartReady = 0;
  let manual = 0;
  let unknown = 0;

  for (const property of properties) {
    const propertyUtilities = byProperty.get(property.id) ?? [];
    if (propertyUtilities.some((utility) => utility.capability === 'smart-meter' || utility.capability === 'newly-installed')) {
      smartReady += 1;
      continue;
    }
    if (propertyUtilities.some((utility) => utility.capability === 'manual-read')) {
      manual += 1;
      continue;
    }
    unknown += 1;
  }

  const known = smartReady + manual;
  return {
    properties: properties.length,
    smartReady,
    manual,
    unknown,
    smartReadyPercentOfKnown: known > 0 ? Math.round((smartReady / known) * 100) : undefined,
  };
}

export function addActivityNote(
  workspace: Workspace,
  input: {
    text: string;
    source: ActivityNote['source'];
    companyId?: string;
    propertyId?: string;
    now?: string;
  },
): Workspace {
  const text = input.text.trim();
  if (!text) return workspace;

  const createdAt = input.now ?? new Date().toISOString();
  const note: ActivityNote = {
    id: `note_${createdAt.replace(/[^0-9]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt,
    source: input.source,
    companyId: input.companyId,
    propertyId: input.propertyId,
  };

  let matchedCompany = false;
  const companies = workspace.companies.map((company) => {
    if (!input.companyId || company.id !== input.companyId) return company;
    matchedCompany = true;
    return {
      ...company,
      activityNotes: [...(company.activityNotes ?? []), note],
      updatedAt: createdAt,
    };
  });

  let matchedProperty = false;
  const properties = workspace.properties.map((property) => {
    if (!input.propertyId || property.id !== input.propertyId) return property;
    matchedProperty = true;
    return {
      ...property,
      activityNotes: [...(property.activityNotes ?? []), note],
      updatedAt: createdAt,
    };
  });

  const shouldInbox = (!input.companyId && !input.propertyId)
    || (input.companyId !== undefined && !matchedCompany)
    || (input.propertyId !== undefined && !matchedProperty);

  return {
    ...workspace,
    companies,
    properties,
    inboxNotes: shouldInbox ? [...(workspace.inboxNotes ?? []), note] : workspace.inboxNotes ?? [],
    updatedAt: createdAt,
  };
}
