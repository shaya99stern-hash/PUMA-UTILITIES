import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="pm-recovery">
      <section className="pm-recovery-card">
        <h1>Page not found</h1>
        <p>The page may have moved. Return to the Puma workspace or open Companies.</p>
        <div className="pm-recovery-actions">
          <Link href="/">Home</Link>
          <Link href="/clients">Companies</Link>
        </div>
      </section>
    </main>
  );
}
