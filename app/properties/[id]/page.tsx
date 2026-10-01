import type { Metadata } from 'next';
import { PropertyRecord } from './record';

export const metadata: Metadata = { title: 'Property' };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PropertyRecord id={id} />;
}
