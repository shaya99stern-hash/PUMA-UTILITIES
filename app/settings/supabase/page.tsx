import PumaAppShell from '../../components/puma-app-shell';
import PumaSettingsPage from '../../components/puma-settings-page';
import PumaSupabaseHealth from '../../components/puma-supabase-health';
import PumaWorkspaceMigration from '../../components/puma-workspace-migration';

export default function SupabaseSettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Supabase">
      <PumaSettingsPage title="Supabase">
        <PumaSupabaseHealth />
        <PumaWorkspaceMigration />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}