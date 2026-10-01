import { redirect } from 'next/navigation';

export default function LegacySupabaseSettings() {
  redirect('/settings/data-sources');
}
