import PumaAppShell from '../../components/puma-app-shell';
import PumaProfileSettings from '../../components/puma-profile-settings';
import PumaSettingsPage from '../../components/puma-settings-page';

export default function ProfileSettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Profile">
      <PumaSettingsPage title="Profile" backHref="/settings">
        <PumaProfileSettings />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}
