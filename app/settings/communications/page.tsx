import PumaAppShell from '../../components/puma-app-shell';
import PumaCommunicationsSettings from '../../components/puma-communications-settings';
import PumaSettingsPage from '../../components/puma-settings-page';

export default function CommunicationsSettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Communications">
      <PumaSettingsPage title="Communications" backHref="/settings">
        <PumaCommunicationsSettings />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}
