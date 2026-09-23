import PumaWorkspaceApp from './components/puma-workspace-app';
import PumaHomeDashboard from './components/puma-home-dashboard';

export default function HomePage() {
  return (
    <>
      <PumaWorkspaceApp view="home" />
      <PumaHomeDashboard />
    </>
  );
}
