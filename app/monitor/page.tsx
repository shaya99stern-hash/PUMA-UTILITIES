import type { Metadata } from 'next';
import { MonitorView } from './monitor-view';

export const metadata: Metadata = { title: 'Monitor' };

export default function MonitorPage() {
  return <MonitorView />;
}
