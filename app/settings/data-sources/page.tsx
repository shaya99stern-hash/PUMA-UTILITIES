import PumaDataSourcesSettings from '../../components/puma-data-sources-settings';
import PumaSettingsShell from '../../components/puma-settings-shell';

export default function DataSourcesSettingsPage() {
  return (
    <PumaSettingsShell title="Data Sources" subtitle="See what Puma can use and keep your own references together." backHref="/settings">
      <PumaDataSourcesSettings />
    </PumaSettingsShell>
  );
}
