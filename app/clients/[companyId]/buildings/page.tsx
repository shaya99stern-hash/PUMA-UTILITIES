import PumaWorkspaceApp from '../../../components/puma-workspace-app';

export default async function BuildingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PumaWorkspaceApp view="clients" companyId={companyId} subview="buildings" />;
}
