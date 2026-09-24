import PumaCrmWorkspace from '../../../../components/puma-crm-workspace';

export default async function BuildingPage({ params }: { params: Promise<{ companyId: string; propertyId: string }> }) {
  const { companyId, propertyId } = await params;
  return <PumaCrmWorkspace companyId={companyId} propertyId={propertyId} subview="building" />;
}
