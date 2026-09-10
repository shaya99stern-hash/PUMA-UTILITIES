export function companyPath(companyId: string) {
  return `/clients/${encodeURIComponent(companyId)}`;
}

export function buildingListPath(companyId: string) {
  return `${companyPath(companyId)}/buildings`;
}

export function buildingDetailPath(companyId: string, propertyId: string) {
  return `${buildingListPath(companyId)}/${encodeURIComponent(propertyId)}`;
}
