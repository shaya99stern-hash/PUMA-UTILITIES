import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContactsList } from './contacts-list';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <ContactsList />
    </Suspense>
  );
}
