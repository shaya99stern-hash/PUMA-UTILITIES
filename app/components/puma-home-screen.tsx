import Link from 'next/link';

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

type PumaHomeScreenProps = {
  now: Date | null;
  profileName: string;
  followUpsToday: number;
  prospects: number;
  alerts: number;
};

export default function PumaHomeScreen({ now, profileName, followUpsToday, prospects, alerts }: PumaHomeScreenProps) {
  return (
    <div className="pm-page pm-home">
      <section className="pm-welcome">
        <div className="pm-date-line">{now ? `${formatLongDate(now)} · ${formatClock(now)}` : 'Today'}</div>
        <h1>{profileName ? `Welcome, ${profileName}` : 'Welcome'}</h1>
      </section>
      <section className="pm-home-today" aria-label="Today at a glance">
        <div className="pm-home-section-head"><strong>Today at a glance</strong></div>
        <div className="pm-home-metrics">
          <Link href="/clients" aria-label={`${followUpsToday} follow-ups today`}><strong>{followUpsToday}</strong><span>Follow-ups</span></Link>
          <Link href="/clients" aria-label={`${prospects} prospects`}><strong>{prospects}</strong><span>Prospects</span></Link>
          <Link href="/monitor" aria-label={`${alerts} monitor alerts`}><strong>{alerts}</strong><span>Alerts</span></Link>
        </div>
      </section>
    </div>
  );
}
