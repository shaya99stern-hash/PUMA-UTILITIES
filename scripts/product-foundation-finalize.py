from pathlib import Path
import re


def sub_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return updated

# Remove the Data Sources disclosure from Find Leads while retaining capability state
# because capability still controls whether discovery can actually run.
research_path = Path('app/components/puma-research-panel.tsx')
research = research_path.read_text()
research = sub_once(
    research,
    r'\n\s*\{capability && <details className="pm-research-advanced pm-research-sources">.*?</details>\}',
    '',
    'Find Leads Data Sources disclosure',
    re.S,
)
research_path.write_text(research)

# Retire shell-only CSS from the workspace inline content stylesheet.
workspace_path = Path('app/components/puma-workspace-app-v4.tsx')
workspace = workspace_path.read_text()
for selector in [
    r'\.pm-shell',
    r'\.pm-appbar',
    r'\.pm-brand',
    r'\.pm-brand > span:last-child',
    r'\.pm-brand strong',
    r'\.pm-brand small',
    r'\.pm-content',
    r'\.pm-bottom-nav',
    r'\.pm-bottom-nav a',
    r'\.pm-bottom-nav a\.active',
    r'\.pm-drawer-scrim',
    r'\.pm-drawer-scrim\.open',
    r'\.pm-drawer',
    r'\.pm-drawer\.open',
    r'\.pm-drawer-head',
    r'\.pm-drawer-nav',
    r'\.pm-drawer-nav a,\.pm-profile-row',
    r'\.pm-drawer-nav a:active,\.pm-profile-row:active',
    r'\.pm-profile-row',
    r'\.pm-profile-row > span',
    r'\.pm-profile-row strong',
    r'\.pm-profile-row small',
]:
    workspace = re.sub(rf'\n{selector}\s*\{{[^}}]*\}}', '', workspace)
workspace = workspace.replace('.pm-icon-button,.pm-mic {', '.pm-mic {')
workspace_path.write_text(workspace)

# Update legacy V6 tests to validate the shared shell rather than retired selectors.
v6_path = Path('tests/product-quality-v6.test.ts')
v6 = v6_path.read_text()
v6 = v6.replace(
    "const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');\n",
    "const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');\nconst appShell = readFileSync('app/components/puma-app-shell.tsx', 'utf8');\nconst appShellCss = readFileSync('app/puma-app-shell.css', 'utf8');\n",
    1,
)
v6 = sub_once(
    v6,
    r"test\('desktop has persistent navigation while mobile exposes four primary tabs', \(\) => \{.*?\n\}\);",
    """test('desktop has persistent navigation while mobile exposes four primary tabs', () => {
  assert.match(appShell, /pu-sidebar/);
  assert.match(appShell, /pu-mobile-nav/);
  assert.match(appShell, /aria-label=\"Desktop navigation\"/);
  assert.match(appShell, /aria-label=\"Primary navigation\"/);
  for (const label of ['Home', 'Companies', 'Find Leads', 'Monitor']) {
    assert.match(appShell, new RegExp(label));
  }
});""",
    'V6 navigation test',
    re.S,
)
v6 = sub_once(
    v6,
    r"test\('responsive CSS turns desktop into a wide workspace and keeps compact mobile navigation', \(\) => \{.*?\n\}\);",
    """test('responsive CSS keeps content wide while AppShell owns desktop and mobile navigation', () => {
  const css = readFileSync('app/puma-responsive-v6.css', 'utf8');
  assert.match(appShellCss, /@media\s*\(min-width:\s*900px\)/);
  assert.match(appShellCss, /\.pu-sidebar[\s\S]*display:\s*flex/);
  assert.match(appShellCss, /\.pu-mobile-nav,[\s\S]*\.pu-mobile-settings[\s\S]*display:\s*none/);
  assert.match(css, /\.pm-page[\s\S]*max-width:\s*1400px/);
  assert.match(css, /\.pm-check[\s\S]*(?:width|min-width):\s*44px/);
  assert.match(css, /\.pm-check[\s\S]*(?:height|min-height):\s*44px/);
});""",
    'V6 responsive shell test',
    re.S,
)
v6_path.write_text(v6)

# Update V7 visual assertions to the shared AppShell selectors.
v7_path = Path('tests/product-intelligence-v7.test.ts')
v7 = v7_path.read_text()
v7 = v7.replace(
    "const responsive = readFileSync('app/puma-responsive-v6.css', 'utf8');\n",
    "const responsive = readFileSync('app/puma-responsive-v6.css', 'utf8');\nconst appShellCss = readFileSync('app/puma-app-shell.css', 'utf8');\n",
    1,
)
v7 = sub_once(
    v7,
    r"test\('desktop sidebar and mobile active navigation use the same black surface without boxed icon tiles', \(\) => \{.*?\n\}\);",
    """test('desktop sidebar and mobile active navigation use the same black surface without boxed icon tiles', () => {
  assert.match(appShellCss, /\.pu-sidebar[\s\S]*background:\s*var\(--pm-bg\)/);
  const activeNavBlock = appShellCss.match(/\.pu-mobile-nav a\.active[\s\S]*?\}/)?.[0] ?? '';
  assert.doesNotMatch(activeNavBlock, /background:\s*#(?:fff|ffffff|101214)/i);
  const brand = readFileSync('app/puma-brand.css', 'utf8');
  assert.doesNotMatch(brand, /background:\s*#(?:fff|ffffff|101214)/i);
});""",
    'V7 shared-surface test',
    re.S,
)
v7 = sub_once(
    v7,
    r"test\('mobile primary navigation labels remain legible', \(\) => \{.*?\n\}\);",
    """test('mobile primary navigation labels remain legible', () => {
  const match = appShellCss.match(/\.pu-mobile-nav a\s*\{[\s\S]*?font-size:\s*([\d.]+)px/);
  assert.ok(match);
  assert.ok(Number(match?.[1]) >= 10);
});""",
    'V7 mobile label test',
    re.S,
)
v7_path.write_text(v7)
