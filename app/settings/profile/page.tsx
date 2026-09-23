import PumaProfileSettings from '../../components/puma-profile-settings';
import PumaSettingsShell from '../../components/puma-settings-shell';

export default function ProfileSettingsPage() {
  return (
    <PumaSettingsShell title="Profile" subtitle="Personalize how Puma greets you." backHref="/settings">
      <PumaProfileSettings />
    </PumaSettingsShell>
  );
}
