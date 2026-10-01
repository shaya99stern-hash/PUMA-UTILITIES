import type { Metadata } from 'next';
import { CompanyRecord } from './record';

export const metadata: Metadata = { title: 'Company' };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyRecord id={id} />;
}
