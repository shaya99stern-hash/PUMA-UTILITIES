import type {
  AccountsPayableItem,
  ActivityNote,
  Company,
  Meter,
  MonitorSettings,
  Parcel,
  Person,
  Property,
  Tariff,
  UsageReading,
  UtilityService,
  Workspace,
} from '../types';

export type WorkspaceImportPlan = {
  companies: Array<{ legacyId: string; payload: Company }>;
  people: Array<{ legacyId: string; companyLegacyIds: string[]; payload: Person }>;
  properties: Array<{ legacyId: string; companyLegacyId: string; payload: Property }>;
  parcels: Array<{ legacyId: string; propertyLegacyId: string; payload: Parcel }>;
  utilities: Array<{ legacyId: string; propertyLegacyId: string; payload: UtilityService }>;
  meters: Array<{ legacyId: string; utilityLegacyId: string; payload: Meter }>;
  readings: Array<{ legacyId: string; meterLegacyId: string; payload: UsageReading }>;
  tariffs: Array<{ legacyId: string; utilityLegacyId: string; payload: Tariff }>;
  activityNotes: Array<{ legacyId: string; payload: ActivityNote }>;
  inboxNotes: Array<{ legacyId: string; payload: ActivityNote }>;
  accountsPayable: Array<{ legacyId: string; payload: AccountsPayableItem }>;
  monitorSettings: MonitorSettings;
};

type EvidenceTagged = { status: string };

const PROTECTED_EVIDENCE_STATUSES = new Set(['user-entered', 'client-authorized']);

export function preserveProtectedEvidence<TExisting extends EvidenceTagged, TIncoming extends EvidenceTagged>(
  existing: TExisting | null | undefined,
  incoming: TIncoming,
): TExisting | TIncoming {
  if (!existing) return incoming;
  const existingIsProtected = PROTECTED_EVIDENCE_STATUSES.has(existing.status);
  const incomingIsProtected = PROTECTED_EVIDENCE_STATUSES.has(incoming.status);
  return existingIsProtected && !incomingIsProtected ? existing : incoming;
}

export function buildWorkspaceImportPlan(workspace: Workspace): WorkspaceImportPlan {
  const people = new Map<string, { legacyId: string; companyLegacyIds: string[]; payload: Person }>();
  const activityNotes = new Map<string, { legacyId: string; payload: ActivityNote }>();

  for (const company of workspace.companies) {
    for (const person of company.people) {
      const existing = people.get(person.id);
      if (existing) {
        if (!existing.companyLegacyIds.includes(company.id)) existing.companyLegacyIds.push(company.id);
      } else {
        people.set(person.id, { legacyId: person.id, companyLegacyIds: [company.id], payload: person });
      }
    }
    for (const note of company.activityNotes ?? []) {
      activityNotes.set(note.id, { legacyId: note.id, payload: note });
    }
  }

  for (const property of workspace.properties) {
    for (const note of property.activityNotes ?? []) {
      activityNotes.set(note.id, { legacyId: note.id, payload: note });
    }
  }

  return {
    companies: workspace.companies.map((company) => ({ legacyId: company.id, payload: company })),
    people: [...people.values()],
    properties: workspace.properties.map((property) => ({ legacyId: property.id, companyLegacyId: property.companyId, payload: property })),
    parcels: workspace.parcels.map((parcel) => ({ legacyId: parcel.id, propertyLegacyId: parcel.propertyId, payload: parcel })),
    utilities: workspace.utilities.map((utility) => ({ legacyId: utility.id, propertyLegacyId: utility.propertyId, payload: utility })),
    meters: workspace.meters.map((meter) => ({ legacyId: meter.id, utilityLegacyId: meter.utilityServiceId, payload: meter })),
    readings: workspace.meters.flatMap((meter) => meter.readings.map((reading) => ({ legacyId: reading.id, meterLegacyId: meter.id, payload: reading }))),
    tariffs: workspace.tariffs.map((tariff) => ({ legacyId: tariff.id, utilityLegacyId: tariff.utilityServiceId, payload: tariff })),
    activityNotes: [...activityNotes.values()],
    inboxNotes: (workspace.inboxNotes ?? []).map((note) => ({ legacyId: note.id, payload: note })),
    accountsPayable: (workspace.accountsPayable ?? []).map((item) => ({ legacyId: item.id, payload: item })),
    monitorSettings: { ...workspace.monitorSettings },
  };
}
