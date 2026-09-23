import PumaSettingsHub from '../components/puma-settings-hub';
import PumaSettingsShell from '../components/puma-settings-shell';

export default function SettingsPage() {
  return (
    <PumaSettingsShell title="Settings" subtitle="Keep Puma simple and personal.">
      <PumaSettingsHub />
    </PumaSettingsShell>
  );
}
