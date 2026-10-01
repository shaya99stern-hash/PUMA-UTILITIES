import type { Metadata } from 'next';
import { PayablesView } from './payables-view';

export const metadata: Metadata = { title: 'Accounts payable' };

export default function AccountsPayablePage() {
  return <PayablesView />;
}
