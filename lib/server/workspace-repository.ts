import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Workspace } from '../types';
import { buildWorkspaceImportPlan, preserveProtectedEvidence } from './workspace-import';

type DbClient = SupabaseClient<any, any, any>;
type IdRow = { id: string; legacy_id: string | null };
type ExistingRow = Record<string, any> & { legacy_id?: string | null; evidence_status?: string | null };

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function upsertLegacyRows(client: DbClient, table: string, rows: Record<string, unknown>[]): Promise<IdRow[]> {
  if (!rows.length) return [];
  const { data, error } = await client.from(table).upsert(rows, { onConflict: 'workspace_id,legacy_id' }).select('id,legacy_id');
  if (error) throw new Error(`Unable to import ${table}: ${error.message}`);
  return (data ?? []) as IdRow[];
}

async function existingRowsByLegacyId(client: DbClient, table: string, workspaceId: string): Promise<Map<string, ExistingRow>> {
  const { data, error } = await client.from(table).select('*').eq('workspace_id', workspaceId).not('legacy_id', 'is', null);
  if (error) throw new Error(`Unable to inspect existing ${table}: ${error.message}`);
  return new Map((data ?? []).flatMap((row: ExistingRow) => typeof row.legacy_id === 'string' ? [[row.legacy_id, row] as const] : []));
}

function idMap(rows: IdRow[]) {
  return new Map(rows.flatMap((row) => row.legacy_id ? [[row.legacy_id, row.id] as const] : []));
}

function preserveEvidenceValue(existing: any, incoming: any) {
  if (incoming == null) return existing ?? null;
  if (existing == null) return incoming;
  if (typeof existing?.status !== 'string' || typeof incoming?.status !== 'string') return incoming;
  return preserveProtectedEvidence(existing, incoming);
}

function shouldPreserveExistingRow(existing: ExistingRow | undefined, incomingStatus: string) {
  if (!existing) return false;
  const selected = preserveProtectedEvidence(
    { status: typeof existing.evidence_status === 'string' ? existing.evidence_status : 'unknown', value: 'existing' as const },
    { status: incomingStatus, value: 'incoming' as const },
  );
  return selected.value === 'existing';
}

function effectiveEvidenceStatus(existing: ExistingRow | undefined, incomingStatus: string) {
  return shouldPreserveExistingRow(existing, incomingStatus)
    ? String(existing?.evidence_status ?? incomingStatus)
    : incomingStatus;
}

export async function getCanonicalWorkspaceSummary(client: DbClient, workspaceId: string) {
  const [{ data: workspace, error: workspaceError }, companies, properties, people] = await Promise.all([
    client.from('workspaces').select('id,local_import_completed_at').eq('id', workspaceId).single(),
    client.from('companies').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    client.from('properties').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    client.from('people').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
  ]);
  if (workspaceError) throw new Error(`Unable to read workspace status: ${workspaceError.message}`);
  return {
    localImportCompletedAt: workspace.local_import_completed_at as string | null,
    counts: { companies: companies.count ?? 0, properties: properties.count ?? 0, people: people.count ?? 0 },
  };
}

export async function importLegacyWorkspace(client: DbClient, workspaceId: string, workspace: Workspace) {
  const plan = buildWorkspaceImportPlan(workspace);
  const [existingCompanies, existingPeople, existingProperties, existingParcels, existingUtilities, existingReadings, existingTariffs] = await Promise.all([
    existingRowsByLegacyId(client, 'companies', workspaceId),
    existingRowsByLegacyId(client, 'people', workspaceId),
    existingRowsByLegacyId(client, 'properties', workspaceId),
    existingRowsByLegacyId(client, 'parcels', workspaceId),
    existingRowsByLegacyId(client, 'utilities', workspaceId),
    existingRowsByLegacyId(client, 'usage_readings', workspaceId),
    existingRowsByLegacyId(client, 'tariffs', workspaceId),
  ]);

  const companyRows = await upsertLegacyRows(client, 'companies', plan.companies.map(({ legacyId, payload }) => {
    const existing = existingCompanies.get(legacyId);
    return {
      workspace_id: workspaceId,
      legacy_id: legacyId,
      name: payload.name,
      normalized_name: normalize(payload.name),
      stage: payload.stage,
      market: payload.market ?? null,
      website: payload.website ?? null,
      public_email: payload.publicEmail ?? null,
      public_phone: payload.publicPhone ?? null,
      headquarters: preserveEvidenceValue(existing?.headquarters, payload.headquarters),
      portfolio_buildings: preserveEvidenceValue(existing?.portfolio_buildings, payload.portfolioBuildings),
      portfolio_units: preserveEvidenceValue(existing?.portfolio_units, payload.portfolioUnits),
      portfolio: payload.portfolio ?? [],
      prospect_assessment: payload.prospectAssessment ?? null,
      opportunity_intelligence: payload.opportunityIntelligence ?? null,
      research_pathways: payload.researchPathways ?? [],
      next_action: payload.nextAction ?? null,
      notes: payload.notes ?? null,
      installation_status: payload.installationStatus ?? null,
      last_contact_at: payload.lastContactAt ?? null,
      created_at: payload.createdAt,
      updated_at: payload.updatedAt,
    };
  }));
  const companies = idMap(companyRows);

  const personRows = await upsertLegacyRows(client, 'people', plan.people.map(({ legacyId, payload }) => {
    const existing = existingPeople.get(legacyId);
    const preserveExisting = shouldPreserveExistingRow(existing, payload.status);
    return {
      workspace_id: workspaceId,
      legacy_id: legacyId,
      name: preserveExisting ? existing?.name : payload.name,
      normalized_name: normalize(preserveExisting ? existing?.name : payload.name),
      role: preserveExisting ? existing?.role ?? null : payload.role ?? null,
      email: preserveExisting ? existing?.email ?? null : payload.email ?? null,
      phone: preserveExisting ? existing?.phone ?? null : payload.phone ?? null,
      evidence_status: preserveExisting ? existing?.evidence_status ?? payload.status : payload.status,
      provenance: preserveExisting ? existing?.provenance ?? {} : payload.provenanceId ? { provenanceId: payload.provenanceId } : {},
    };
  }));
  const people = idMap(personRows);

  const companyPeople = plan.people.flatMap((entry) => entry.companyLegacyIds.flatMap((companyLegacyId) => {
    const companyId = companies.get(companyLegacyId);
    const personId = people.get(entry.legacyId);
    const evidenceStatus = effectiveEvidenceStatus(existingPeople.get(entry.legacyId), entry.payload.status);
    return companyId && personId ? [{ workspace_id: workspaceId, company_id: companyId, person_id: personId, relationship_type: 'contact', evidence_status: evidenceStatus, provenance: evidenceStatus === entry.payload.status && entry.payload.provenanceId ? { provenanceId: entry.payload.provenanceId } : {} }] : [];
  }));
  if (companyPeople.length) {
    const result = await client.from('company_people').upsert(companyPeople, { onConflict: 'company_id,person_id,relationship_type' });
    if (result.error) throw new Error(`Unable to import company contacts: ${result.error.message}`);
  }

  const propertyRows = await upsertLegacyRows(client, 'properties', plan.properties.map(({ legacyId, payload }) => {
    const existing = existingProperties.get(legacyId);
    const address = preserveEvidenceValue(existing?.address, payload.address);
    return {
      workspace_id: workspaceId,
      legacy_id: legacyId,
      name: payload.name,
      normalized_address: normalize(address?.value),
      state: payload.state,
      address,
      units: preserveEvidenceValue(existing?.units, payload.units ?? null),
      gross_square_feet: preserveEvidenceValue(existing?.gross_square_feet, payload.grossSquareFeet ?? null),
      provenance: payload.provenance,
      created_at: payload.createdAt,
      updated_at: payload.updatedAt,
    };
  }));
  const properties = idMap(propertyRows);

  const companyProperties = plan.properties.flatMap(({ companyLegacyId, legacyId, payload }) => {
    const companyId = companies.get(companyLegacyId);
    const propertyId = properties.get(legacyId);
    const address = preserveEvidenceValue(existingProperties.get(legacyId)?.address, payload.address);
    return companyId && propertyId ? [{ workspace_id: workspaceId, company_id: companyId, property_id: propertyId, relationship_type: 'manager', evidence_status: address?.status ?? payload.address.status, provenance: {} }] : [];
  });
  if (companyProperties.length) {
    const result = await client.from('company_properties').upsert(companyProperties, { onConflict: 'company_id,property_id,relationship_type' });
    if (result.error) throw new Error(`Unable to import company properties: ${result.error.message}`);
  }

  await upsertLegacyRows(client, 'parcels', plan.parcels.flatMap(({ legacyId, propertyLegacyId, payload }) => {
    const propertyId = properties.get(propertyLegacyId);
    if (!propertyId) return [];
    const existing = existingParcels.get(legacyId);
    const preserveExisting = shouldPreserveExistingRow(existing, payload.status);
    return [{
      workspace_id: workspaceId,
      legacy_id: legacyId,
      property_id: propertyId,
      identifier: preserveExisting ? existing?.identifier : payload.identifier,
      jurisdiction: preserveExisting ? existing?.jurisdiction ?? null : payload.jurisdiction ?? null,
      evidence_status: preserveExisting ? existing?.evidence_status ?? payload.status : payload.status,
      provenance: preserveExisting ? existing?.provenance ?? {} : payload.provenanceId ? { provenanceId: payload.provenanceId } : {},
    }];
  }));

  const utilityRows = await upsertLegacyRows(client, 'utilities', plan.utilities.map(({ legacyId, payload }) => {
    const existing = existingUtilities.get(legacyId);
    const preserveExisting = shouldPreserveExistingRow(existing, payload.status);
    const provider = preserveExisting ? String(existing?.provider ?? payload.provider) : payload.provider;
    return {
      workspace_id: workspaceId,
      legacy_id: legacyId,
      provider,
      normalized_provider: normalize(provider),
      service_area: preserveExisting ? existing?.service_area ?? null : payload.serviceArea ?? null,
      capability: preserveExisting ? existing?.capability ?? payload.capability : payload.capability,
      portal: preserveExisting ? existing?.portal ?? payload.portal : payload.portal,
      evidence_status: preserveExisting ? existing?.evidence_status ?? payload.status : payload.status,
      provenance: preserveExisting ? existing?.provenance ?? {} : payload.provenanceId ? { provenanceId: payload.provenanceId } : {},
      ami_program: preserveExisting ? existing?.ami_program ?? null : payload.amiProgram ?? null,
      rate_summary: preserveExisting ? existing?.rate_summary ?? null : payload.rateSummary ?? null,
      benchmark_cost: preserveExisting ? existing?.benchmark_cost ?? null : payload.benchmarkCost ?? null,
    };
  }));
  const utilities = idMap(utilityRows);

  const propertyUtilities = plan.utilities.flatMap(({ legacyId, propertyLegacyId, payload }) => {
    const propertyId = properties.get(propertyLegacyId);
    const utilityId = utilities.get(legacyId);
    const evidenceStatus = effectiveEvidenceStatus(existingUtilities.get(legacyId), payload.status);
    return propertyId && utilityId ? [{ workspace_id: workspaceId, property_id: propertyId, utility_id: utilityId, service_type: 'water', evidence_status: evidenceStatus, provenance: evidenceStatus === payload.status && payload.provenanceId ? { provenanceId: payload.provenanceId } : {} }] : [];
  });
  if (propertyUtilities.length) {
    const result = await client.from('property_utilities').upsert(propertyUtilities, { onConflict: 'property_id,utility_id,service_type' });
    if (result.error) throw new Error(`Unable to import utility links: ${result.error.message}`);
  }

  const meterRows = await upsertLegacyRows(client, 'meters', plan.meters.flatMap(({ legacyId, utilityLegacyId, payload }) => {
    const utilityId = utilities.get(utilityLegacyId);
    return utilityId ? [{ workspace_id: workspaceId, legacy_id: legacyId, utility_id: utilityId, label: payload.label, created_at: payload.createdAt, updated_at: payload.updatedAt }] : [];
  }));
  const meters = idMap(meterRows);

  await upsertLegacyRows(client, 'usage_readings', plan.readings.flatMap(({ legacyId, meterLegacyId, payload }) => {
    const meterId = meters.get(meterLegacyId);
    if (!meterId) return [];
    const existing = existingReadings.get(legacyId);
    const preserveExisting = shouldPreserveExistingRow(existing, payload.status);
    return [{
      workspace_id: workspaceId,
      legacy_id: legacyId,
      meter_id: meterId,
      period_start: preserveExisting ? existing?.period_start ?? null : payload.periodStart ?? null,
      period_end: preserveExisting ? existing?.period_end ?? null : payload.periodEnd ?? null,
      gallons: preserveExisting ? existing?.gallons ?? null : payload.gallons ?? null,
      expected_gallons: preserveExisting ? existing?.expected_gallons ?? null : payload.expectedGallons ?? null,
      cost: preserveExisting ? existing?.cost ?? null : payload.cost ?? null,
      continuous_flow: preserveExisting ? existing?.continuous_flow ?? null : payload.continuousFlow ?? null,
      evidence_status: preserveExisting ? existing?.evidence_status ?? payload.status : payload.status,
      provenance: preserveExisting ? existing?.provenance ?? {} : payload.provenanceId ? { provenanceId: payload.provenanceId } : {},
      note: preserveExisting ? existing?.note ?? null : payload.note ?? null,
    }];
  }));

  await upsertLegacyRows(client, 'tariffs', plan.tariffs.flatMap(({ legacyId, utilityLegacyId, payload }) => {
    const utilityId = utilities.get(utilityLegacyId);
    if (!utilityId) return [];
    const existing = existingTariffs.get(legacyId);
    const preserveExisting = shouldPreserveExistingRow(existing, payload.status);
    return [{
      workspace_id: workspaceId,
      legacy_id: legacyId,
      utility_id: utilityId,
      label: preserveExisting ? existing?.label ?? payload.label : payload.label,
      effective_from: preserveExisting ? existing?.effective_from ?? null : payload.effectiveFrom ?? null,
      effective_to: preserveExisting ? existing?.effective_to ?? null : payload.effectiveTo ?? null,
      customer_class: preserveExisting ? existing?.customer_class ?? null : payload.customerClass ?? null,
      freshness: preserveExisting ? existing?.freshness ?? null : payload.freshness ?? null,
      source_url: preserveExisting ? existing?.source_url ?? null : payload.sourceUrl ?? null,
      retrieved_at: preserveExisting ? existing?.retrieved_at ?? null : payload.retrievedAt ?? null,
      published_text: preserveExisting ? existing?.published_text ?? null : payload.publishedText ?? null,
      evidence_status: preserveExisting ? existing?.evidence_status ?? payload.status : payload.status,
      provenance: preserveExisting ? existing?.provenance ?? {} : payload.provenanceId ? { provenanceId: payload.provenanceId } : {},
      note: preserveExisting ? existing?.note ?? null : payload.note ?? null,
    }];
  }));

  const notes = [...plan.activityNotes, ...plan.inboxNotes].flatMap(({ legacyId, payload }) => {
    const companyId = payload.companyId ? companies.get(payload.companyId) : undefined;
    const propertyId = payload.propertyId ? properties.get(payload.propertyId) : undefined;
    return [{ workspace_id: workspaceId, legacy_id: legacyId, company_id: companyId ?? null, property_id: propertyId ?? null, text: payload.text, source: payload.source, created_at: payload.createdAt, updated_at: payload.createdAt }];
  });
  await upsertLegacyRows(client, 'activity_notes', notes);

  const payableRows = plan.accountsPayable.flatMap(({ legacyId, payload }) => {
    const companyId = companies.get(payload.companyId);
    if (!companyId) return [];
    return [{ workspace_id: workspaceId, legacy_id: legacyId, company_id: companyId, property_id: payload.propertyId ? properties.get(payload.propertyId) ?? null : null, description: payload.description, amount: payload.amount, currency: payload.currency, status: payload.status, due_date: payload.dueDate ?? null, paid_at: payload.paidAt ?? null, note: payload.note ?? null, created_at: payload.createdAt, updated_at: payload.updatedAt }];
  });
  await upsertLegacyRows(client, 'accounts_payable', payableRows);

  const monitorResult = await client.from('monitor_settings').upsert({ workspace_id: workspaceId, spend_threshold: plan.monitorSettings.spendThreshold ?? null, variance_threshold_percent: plan.monitorSettings.varianceThresholdPercent ?? null }, { onConflict: 'workspace_id' });
  if (monitorResult.error) throw new Error(`Unable to import monitor settings: ${monitorResult.error.message}`);

  const importedAt = new Date().toISOString();
  const workspaceUpdate = await client.from('workspaces').update({ local_import_completed_at: importedAt }).eq('id', workspaceId);
  if (workspaceUpdate.error) throw new Error(`Unable to finalize workspace import: ${workspaceUpdate.error.message}`);

  return {
    importedAt,
    counts: {
      companies: plan.companies.length,
      people: plan.people.length,
      properties: plan.properties.length,
      parcels: plan.parcels.length,
      utilities: plan.utilities.length,
      meters: plan.meters.length,
      readings: plan.readings.length,
      tariffs: plan.tariffs.length,
      notes: notes.length,
      accountsPayable: plan.accountsPayable.length,
    },
  };
}
