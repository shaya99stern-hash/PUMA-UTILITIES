'use client';

import { useEffect, useState } from 'react';

const PROFILE_KEY = 'puma-profile-name';

export default function PumaProfileSettings() {
  const [savedName, setSavedName] = useState('');
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(PROFILE_KEY)?.trim() ?? '';
    setSavedName(stored);
    setDraft(stored);
  }, []);

  const normalizedDraft = draft.trim();
  const changed = normalizedDraft !== savedName;

  const save = () => {
    if (!changed) return;
    if (normalizedDraft) window.localStorage.setItem(PROFILE_KEY, normalizedDraft);
    else window.localStorage.removeItem(PROFILE_KEY);
    setSavedName(normalizedDraft);
    setDraft(normalizedDraft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  return (
    <section className="pm-profile-settings pm-profile-settings-page">
      <label>
        <span>Display name</span>
        <input
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setSaved(false); }}
          placeholder="Your name"
          autoComplete="name"
        />
      </label>
      <button type="button" onClick={save} disabled={!changed}>{saved ? 'Saved' : 'Save'}</button>
      <small>{savedName ? `Home will greet you as ${savedName}.` : 'Leave blank for a simple “Welcome”.'}</small>
    </section>
  );
}
