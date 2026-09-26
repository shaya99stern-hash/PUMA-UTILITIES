import Link from 'next/link';
import PumaLoginForm from '../components/puma-login-form';

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100dvh', background: '#08090a', color: '#f4f4f2', padding: 'max(30px, env(safe-area-inset-top)) 18px 40px', fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>
      <div style={{ width: 'min(460px, 100%)', margin: '0 auto' }}>
        <Link href="/" style={{ color: '#aaa', textDecoration: 'none', fontSize: 13 }}>← Back to Puma</Link>
        <div style={{ marginTop: 44, marginBottom: 28 }}>
          <div style={{ color: '#777', fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase' }}>Puma Utilities</div>
          <h1 style={{ margin: '9px 0 8px', fontSize: 34, lineHeight: 1.05 }}>Sign in with email</h1>
          <p style={{ margin: 0, color: '#8c9195', fontSize: 14, lineHeight: 1.55 }}>Use the same Puma workspace on another phone or computer. Sign-in is optional on your current device.</p>
        </div>
        <PumaLoginForm />
      </div>
    </main>
  );
}
