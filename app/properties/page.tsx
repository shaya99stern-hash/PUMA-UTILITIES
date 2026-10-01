import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PropertiesList } from './properties-list';

export const metadata: Metadata = { title: 'Properties' };

export default function PropertiesPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <PropertiesList />
    </Suspense>
  );
}
