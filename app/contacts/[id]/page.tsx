import type { Metadata } from 'next';
import { ContactRecord } from './record';

export const metadata: Metadata = { title: 'Contact' };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactRecord id={id} />;
}
