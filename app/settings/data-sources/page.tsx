import PumaAppShell from '../../components/puma-app-shell';
import PumaDataSourcesSettings from '../../components/puma-data-sources-settings';
import PumaSettingsPage from '../../components/puma-settings-page';

export default function DataSourcesSettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Data Sources">
      <PumaSettingsPage title="Data Sources" backHref="/settings">
        <PumaDataSourcesSettings />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}
