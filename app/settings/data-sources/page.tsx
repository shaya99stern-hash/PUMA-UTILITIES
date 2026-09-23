import PumaDataSourcesSettings from '../../components/puma-data-sources-settings';
import PumaSettingsShell from '../../components/puma-settings-shell';

export default function DataSourcesSettingsPage() {
  return (
    <PumaSettingsShell title="Data Sources" backHref="/settings">
      <PumaDataSourcesSettings />
    </PumaSettingsShell>
  );
}
