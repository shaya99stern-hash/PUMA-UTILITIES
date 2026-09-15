const SOCRATA = 'https://data.cityofnewyork.us/resource';
const REGISTRATIONS = 'tesw-yqqr';
const CONTACTS = 'feu5-w2e2';

export interface HpdRegistration {
  registrationId: string;
  buildingId?: string;
  bin?: string;
  boroughId: string;
  block: string;
  lot: string;
  lastRegistrationDate?: string;
  registrationEndDate?: string;
}

export interface HpdRegistrationContact {
  id?: string;
  registrationId: string;
  type?: string;
  firstName?: string;
  lastName?: string;
  corporationName?: string;
  businessAddress?: string;
  businessPhone?: string;
}

export interface HpdOwnershipResult {
  registration?: HpdRegistration;
  contacts: HpdRegistrationContact[];
  sourceUrls: string[];
}

export async function lookupHpdOwnershipByBbl(
  boroughId: string | number,
  block: string | number,
  lot: string | number,
  signal?: AbortSignal,
): Promise<HpdOwnershipResult> {
  const boro = String(boroughId).trim();
  const normalizedBlock = String(block).trim();
  const normalizedLot = String(lot).trim();
  if (!/^\d$/.test(boro) || !/^\d+(?:\.\d+)?$/.test(normalizedBlock) || !/^\d+(?:\.\d+)?$/.test(normalizedLot)) {
    throw new Error('HPD lookup requires numeric borough, block and lot values.');
  }

  const registrationsUrl = new URL(`${SOCRATA}/${REGISTRATIONS}.json`);
  registrationsUrl.searchParams.set('$where', `boroid='${boro}' AND block='${normalizedBlock}' AND lot='${normalizedLot}'`);
  registrationsUrl.searchParams.set('$order', 'lastregistrationdate DESC');
  registrationsUrl.searchParams.set('$limit', '10');

  const registrationRows = await fetchJson<Array<Record<string, string>>>(registrationsUrl, signal);
  const row = registrationRows[0];
  if (!row?.registrationid) return { contacts: [], sourceUrls: [registrationsUrl.toString()] };

  const registration: HpdRegistration = {
    registrationId: row.registrationid,
    buildingId: row.buildingid,
    bin: row.bin,
    boroughId: row.boroid ?? boro,
    block: row.block ?? normalizedBlock,
    lot: row.lot ?? normalizedLot,
    lastRegistrationDate: row.lastregistrationdate,
    registrationEndDate: row.registrationenddate,
  };

  const contactsUrl = new URL(`${SOCRATA}/${CONTACTS}.json`);
  contactsUrl.searchParams.set('$where', `registrationid='${escapeSocrata(row.registrationid)}'`);
  contactsUrl.searchParams.set('$limit', '100');
  const contactRows = await fetchJson<Array<Record<string, string>>>(contactsUrl, signal);
  const contacts = contactRows.map((contact): HpdRegistrationContact => ({
    id: contact.registrationcontactid,
    registrationId: contact.registrationid,
    type: contact.type,
    firstName: contact.firstname,
    lastName: contact.lastname,
    corporationName: contact.corporationname,
    businessAddress: joinAddress(contact),
    businessPhone: contact.businessphone,
  }));

  return { registration, contacts, sourceUrls: [registrationsUrl.toString(), contactsUrl.toString()] };
}

async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PumaUtilitiesResearch/1.0' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`NYC HPD source returned ${response.status}.`);
  return response.json() as Promise<T>;
}

function escapeSocrata(value: string): string {
  return value.replace(/'/g, "''");
}

function joinAddress(contact: Record<string, string>): string | undefined {
  const parts = [
    contact.businesshousenumber,
    contact.businessstreetname,
    contact.businessapartment,
    contact.businesscity,
    contact.businessstate,
    contact.businesszip,
  ].map((part) => part?.trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}
