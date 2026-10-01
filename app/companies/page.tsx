import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompaniesList } from './companies-list';

export const metadata: Metadata = { title: 'Companies' };

export default function CompaniesPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <CompaniesList />
    </Suspense>
  );
}
