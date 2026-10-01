'use client';

import '@/app/settings/email/email.css';

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-row">
      <input type="checkbox" className="ui-check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-row__text">
        <span>{label}</span>
        {hint && <span className="check-row__hint">{hint}</span>}
      </span>
    </label>
  );
}
