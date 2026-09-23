import PumaAppShell from '../components/puma-app-shell';
import PumaSettingsHub from '../components/puma-settings-hub';
import PumaSettingsPage from '../components/puma-settings-page';

export default function SettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Settings">
      <PumaSettingsPage title="Settings">
        <PumaSettingsHub />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}
