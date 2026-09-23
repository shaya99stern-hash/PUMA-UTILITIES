from pathlib import Path
import re

path = Path('app/components/puma-workspace-app-v4.tsx')
source = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)


for old in [
    '  Activity,\n',
    '  Building2,\n',
    '  Settings,\n',
    '  SlidersHorizontal,\n',
    '  UserRound,\n',
]:
    replace_once(old, '', f'remove icon {old.strip()}')

replace_once(
    "import { mergeResearchRunIntoWorkspace } from '@/lib/research/workspace-projection';\n",
    "import { mergeResearchRunIntoWorkspace } from '@/lib/research/workspace-projection';\nimport type { PumaShellRouteId } from '@/lib/puma-navigation';\nimport PumaAppShell from './puma-app-shell';\nimport PumaHomeScreen from './puma-home-screen';\n",
    'shared shell imports',
)

source, count = re.subn(
    r"\nfunction formatClock\(date: Date\) \{.*?\n\}\n\nfunction formatLongDate\(date: Date\) \{.*?\n\}\n",
    '\n',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'date formatter removal: expected 1, found {count}')

source, count = re.subn(
    r"\nfunction BrandMark\(\{ size = 28 \}: \{ size\?: number \}\) \{.*?\n\}\n\nfunction VoiceReviewSheet",
    '\nfunction VoiceReviewSheet',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'BrandMark removal: expected 1, found {count}')

replace_once(
    "  const activeCompanies = allCompanies.filter((company) => companyLifecycle(company.stage) === 'Active Clients');\n",
    "  const prospects = allCompanies.filter((company) => companyLifecycle(company.stage) === 'Prospects').length;\n",
    'prospect metric',
)

source, count = re.subn(
    r"\n  const upcomingCompanies = \[\.\.\.allCompanies\].*?\n  const voiceDestination =",
    '\n  const voiceDestination =',
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'legacy Home collections removal: expected 1, found {count}')

replace_once(
    '  if (!workspace) return <main className="pm-shell"><div className="pm-loading">Loading Puma…</div><style>{styles}</style></main>;\n\n',
    '',
    'hydration early return',
)

source, count = re.subn(
    r"  const renderHome = \(\) => \{.*?\n  \};\n\n  const renderCompanies = \(\) => \(",
    "  const renderHome = () => (\n    <PumaHomeScreen\n      now={now}\n      profileName={profileName}\n      followUpsToday={followUpsToday}\n      prospects={prospects}\n      alerts={alerts.length}\n    />\n  );\n\n  const renderCompanies = () => (",
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'canonical Home replacement: expected 1, found {count}')

replace_once(
    '    if (!company) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong></div></div>;',
    '    if (!company) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong><Link href="/clients">Back to Companies</Link></div></div>;',
    'company recovery',
)
replace_once(
    '    if (!selectedCompany) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong></div></div>;',
    '    if (!selectedCompany) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong><Link href="/clients">Back to Companies</Link></div></div>;',
    'building-list recovery',
)
replace_once(
    '    if (!selectedCompany || !selectedProperty) return <div className="pm-page"><div className="pm-empty"><strong>Building not found.</strong></div></div>;',
    "    if (!selectedCompany || !selectedProperty) {\n      const recoveryHref = selectedCompany ? buildingListPath(selectedCompany.id) : '/clients';\n      const recoveryLabel = selectedCompany ? 'Back to Buildings' : 'Back to Companies';\n      return <div className=\"pm-page\"><div className=\"pm-empty\"><strong>Building not found.</strong><Link href={recoveryHref}>{recoveryLabel}</Link></div></div>;\n    }",
    'building recovery',
)

# These renderers only execute after workspace hydration.
source = source.replace('companyProperties(company, workspace)', 'companyProperties(company, workspace!)')
source = source.replace('companyProperties(selectedCompany, workspace)', 'companyProperties(selectedCompany, workspace!)')
source = source.replace('propertyUtilities(selectedProperty, workspace)', 'propertyUtilities(selectedProperty, workspace!)')
source = source.replace('workspace.parcels.filter', 'workspace!.parcels.filter')
source = source.replace('workspace.properties.find', 'workspace!.properties.find')
source = source.replace('mergeResearchRunIntoWorkspace(workspace, result)', 'mergeResearchRunIntoWorkspace(workspace!, result)')
source = source.replace('const items = workspace.accountsPayable ?? [];', 'const items = workspace!.accountsPayable ?? [];')

replace_once(
    "  let content = renderHome();\n  if (view === 'clients' && subview === 'buildings') content = renderBuildings();\n  else if (view === 'clients' && subview === 'building') content = renderBuilding();\n  else if (view === 'clients' && companyId) content = renderCompany();\n  else if (view === 'clients') content = renderCompanies();\n  else if (view === 'monitor') content = renderMonitor();\n  else if (view === 'engine') content = renderEngine();\n  else if (view === 'accounts-payable') content = renderAccountsPayable();\n  else if (view === 'settings') content = renderSettings();",
    "  let content = workspace ? renderHome() : <div className=\"pm-loading\">Loading Puma…</div>;\n  if (workspace) {\n    if (view === 'clients' && subview === 'buildings') content = renderBuildings();\n    else if (view === 'clients' && subview === 'building') content = renderBuilding();\n    else if (view === 'clients' && companyId) content = renderCompany();\n    else if (view === 'clients') content = renderCompanies();\n    else if (view === 'monitor') content = renderMonitor();\n    else if (view === 'engine') content = renderEngine();\n    else if (view === 'accounts-payable') content = renderAccountsPayable();\n    else if (view === 'settings') content = renderSettings();\n  }",
    'hydration-aware content routing',
)

old_shell = re.compile(
    r"  return \(\n    <main className=\"pm-shell\">.*?\n      <VoiceReviewSheet",
    re.S,
)
replacement = """  const shellRoute = view as PumaShellRouteId;

  return (
    <>
      <PumaAppShell
        currentRoute={shellRoute}
        pageLabel={pageLabel}
        headerAction={workspace ? <button type=\"button\" className={`pm-mic ${voicePhase === 'recording' ? 'recording' : ''}`} aria-label=\"Record voice note\" onClick={() => void toggleVoice()}><Mic size={20} /></button> : undefined}
      >
        {content}
      </PumaAppShell>

      <VoiceReviewSheet"""
source, count = old_shell.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f'shared shell replacement: expected 1, found {count}')

replace_once(
    '      <style>{styles}</style>\n    </main>\n  );',
    '      <style>{styles}</style>\n    </>\n  );',
    'fragment close',
)

path.write_text(source)

Path('app/page.tsx').write_text("""import PumaWorkspaceApp from './components/puma-workspace-app';

export default function HomePage() {
  return <PumaWorkspaceApp view=\"home\" />;
}
""")

css_path = Path('app/puma-polish-v12.css')
css = css_path.read_text()
css = css.replace(
    '  .pm-home-dashboard {\n    max-width: 640px;\n  }',
    '  .pm-home-today {\n    max-width: 640px;\n  }',
)
css_path.write_text(css)
