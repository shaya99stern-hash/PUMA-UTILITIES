import PumaProfileSettings from '../../components/puma-profile-settings';
import PumaSettingsShell from '../../components/puma-settings-shell';

export default function ProfileSettingsPage() {
  return (
    <PumaSettingsShell title="Profile" backHref="/settings">
      <PumaProfileSettings />
    </PumaSettingsShell>
  );
}
