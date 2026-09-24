import type { Company, Person, PipelineStage, Property, Workspace } from './types';
import { createId, nowIso } from './workspace';

export type CompanyRecordInput = {
  name: string;
  market?: string;
  website?: string;
  publicEmail?: string;
  publicPhone?: string;
  nextAction?: string;
};

export type CompanyRecordPatch = Partial<CompanyRecordInput> & {
  stage?: PipelineStage;
  followUpAt?: string;
};

export type ContactInput = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
};

export type BuildingInput = {
  name: string;
  address?: string;
  state: string;
  units?: number;
};

export type BuildingPatch = Omit<Partial<BuildingInput>, 'units' | 'address'> & {
  units?: number | null;
  address?: string | null;
};

function clean(value?: string | null) {
  const next = value?.trim();
  return next || undefined;
}

function stamp(workspace: Workspace, updatedAt: string): Workspace {
  return { ...workspace, updatedAt };
}

export function addCompany(workspace: Workspace, input: CompanyRecordInput, now = nowIso()): Workspace {
  const name = clean(input.name);
  if (!name) return workspace;
  const company: Company = {
    id: createId('company'),
    name,
    stage: 'Target',
    market: clean(input.market),
    headquarters: { status: 'unknown' },
    portfolioBuildings: { status: 'unknown' },
    portfolioUnits: { status: 'unknown' },
    people: [],
    provenance: [],
    website: clean(input.website),
    publicEmail: clean(input.publicEmail),
    publicPhone: clean(input.publicPhone),
    nextAction: clean(input.nextAction),
    createdAt: now,
    updatedAt: now,
  };
  return stamp({ ...workspace, companies: [...workspace.companies, company] }, now);
}

export function updateCompanyRecord(workspace: Workspace, companyId: string, patch: CompanyRecordPatch, now = nowIso()): Workspace {
  let changed = false;
  const companies = workspace.companies.map((company) => {
    if (company.id !== companyId) return company;
    changed = true;
    return {
      ...company,
      ...(patch.name !== undefined ? { name: clean(patch.name) ?? company.name } : {}),
      ...(patch.market !== undefined ? { market: clean(patch.market) } : {}),
      ...(patch.website !== undefined ? { website: clean(patch.website) } : {}),
      ...(patch.publicEmail !== undefined ? { publicEmail: clean(patch.publicEmail) } : {}),
      ...(patch.publicPhone !== undefined ? { publicPhone: clean(patch.publicPhone) } : {}),
      ...(patch.nextAction !== undefined ? { nextAction: clean(patch.nextAction) } : {}),
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.followUpAt !== undefined ? { followUpAt: clean(patch.followUpAt) } : {}),
      updatedAt: now,
    } as Company;
  });
  return changed ? stamp({ ...workspace, companies }, now) : workspace;
}

export function addContact(workspace: Workspace, companyId: string, input: ContactInput, now = nowIso()): Workspace {
  const name = clean(input.name);
  if (!name) return workspace;
  let changed = false;
  const person: Person = {
    id: createId('person'),
    name,
    role: clean(input.role),
    email: clean(input.email),
    phone: clean(input.phone),
    status: 'user-entered',
  };
  const companies = workspace.companies.map((company) => {
    if (company.id !== companyId) return company;
    changed = true;
    return { ...company, people: [...company.people, person], updatedAt: now };
  });
  return changed ? stamp({ ...workspace, companies }, now) : workspace;
}

export function updateContact(workspace: Workspace, companyId: string, personId: string, patch: Partial<ContactInput>, now = nowIso()): Workspace {
  let changed = false;
  const companies = workspace.companies.map((company) => {
    if (company.id !== companyId) return company;
    const people = company.people.map((person) => {
      if (person.id !== personId) return person;
      changed = true;
      return {
        ...person,
        ...(patch.name !== undefined ? { name: clean(patch.name) ?? person.name } : {}),
        ...(patch.role !== undefined ? { role: clean(patch.role) } : {}),
        ...(patch.email !== undefined ? { email: clean(patch.email) } : {}),
        ...(patch.phone !== undefined ? { phone: clean(patch.phone) } : {}),
        status: 'user-entered' as const,
      };
    });
    return changed ? { ...company, people, updatedAt: now } : company;
  });
  return changed ? stamp({ ...workspace, companies }, now) : workspace;
}

export function addBuilding(workspace: Workspace, companyId: string, input: BuildingInput, now = nowIso()): Workspace {
  if (!workspace.companies.some((company) => company.id === companyId)) return workspace;
  const name = clean(input.name);
  const state = clean(input.state);
  if (!name || !state) return workspace;
  const address = clean(input.address);
  const property: Property = {
    id: createId('property'),
    companyId,
    name,
    address: address ? { value: address, status: 'user-entered', updatedAt: now } : { status: 'unknown' },
    units: typeof input.units === 'number' && Number.isFinite(input.units) && input.units >= 0
      ? { value: input.units, status: 'user-entered', updatedAt: now }
      : undefined,
    state,
    parcelIds: [],
    provenance: [],
    createdAt: now,
    updatedAt: now,
  };
  return stamp({ ...workspace, properties: [...workspace.properties, property] }, now);
}

export function updateBuilding(workspace: Workspace, companyId: string, propertyId: string, patch: BuildingPatch, now = nowIso()): Workspace {
  let changed = false;
  const properties = workspace.properties.map((property) => {
    if (property.id !== propertyId || property.companyId !== companyId) return property;
    changed = true;
    const nextAddress = patch.address !== undefined
      ? (clean(patch.address) ? { value: clean(patch.address), status: 'user-entered' as const, updatedAt: now } : { status: 'unknown' as const })
      : property.address;
    const nextUnits = patch.units !== undefined
      ? (typeof patch.units === 'number' && Number.isFinite(patch.units) && patch.units >= 0
        ? { value: patch.units, status: 'user-entered' as const, updatedAt: now }
        : undefined)
      : property.units;
    return {
      ...property,
      ...(patch.name !== undefined ? { name: clean(patch.name) ?? property.name } : {}),
      ...(patch.state !== undefined ? { state: clean(patch.state) ?? property.state } : {}),
      address: nextAddress,
      units: nextUnits,
      updatedAt: now,
    };
  });
  return changed ? stamp({ ...workspace, properties }, now) : workspace;
}

export function logCompanyCall(workspace: Workspace, companyId: string, now = nowIso()): Workspace {
  let changed = false;
  const companies = workspace.companies.map((company) => {
    if (company.id !== companyId) return company;
    changed = true;
    const stage = company.stage === 'Target' || company.stage === 'Research' ? 'Outreach' : company.stage;
    return {
      ...company,
      stage,
      lastContactAt: now,
      activityNotes: [
        ...(company.activityNotes ?? []),
        { id: createId('activity'), text: 'Call logged', createdAt: now, source: 'typed' as const, companyId },
      ],
      updatedAt: now,
    };
  });
  return changed ? stamp({ ...workspace, companies }, now) : workspace;
}

export function editActivityNote(workspace: Workspace, companyId: string, noteId: string, text: string, now = nowIso()): Workspace {
  const cleaned = clean(text);
  if (!cleaned) return workspace;
  let changed = false;
  const companies = workspace.companies.map((company) => {
    if (company.id !== companyId) return company;
    const notes = (company.activityNotes ?? []).map((note) => {
      if (note.id !== noteId) return note;
      changed = true;
      return { ...note, text: cleaned };
    });
    return changed ? { ...company, activityNotes: notes, updatedAt: now } : company;
  });
  return changed ? stamp({ ...workspace, companies }, now) : workspace;
}
