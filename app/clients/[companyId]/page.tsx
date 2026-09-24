import PumaCrmWorkspace from '../../components/puma-crm-workspace';

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PumaCrmWorkspace companyId={companyId} />;
}
