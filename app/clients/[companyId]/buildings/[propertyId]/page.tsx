import PumaWorkspaceApp from '../../../../components/puma-workspace-app';

export default async function BuildingPage({ params }: { params: Promise<{ companyId: string; propertyId: string }> }) {
  const { companyId, propertyId } = await params;
  return <PumaWorkspaceApp view="clients" companyId={companyId} propertyId={propertyId} subview="building" />;
}
