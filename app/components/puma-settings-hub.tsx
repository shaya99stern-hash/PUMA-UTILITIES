'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Database, ServerCog, UserRound } from 'lucide-react';

const PROFILE_KEY = 'puma-profile-name';

export default function PumaSettingsHub() {
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    setProfileName(window.localStorage.getItem(PROFILE_KEY)?.trim() ?? '');
  }, []);

  return (
    <div className="pm-settings-list">
      <Link className="pm-settings-hub-row" href="/settings/profile">
        <UserRound size={19} />
        <span>
          <strong>Profile</strong>
          <small>{profileName || 'Display name and personal preferences'}</small>
        </span>
        <ChevronRight size={17} />
      </Link>
      <Link className="pm-settings-hub-row" href="/settings/data-sources">
        <Database size={19} />
        <span>
          <strong>Data Sources</strong>
          <small>Manage research sources</small>
        </span>
        <ChevronRight size={17} />
      </Link>
      <Link className="pm-settings-hub-row" href="/settings/supabase">
        <ServerCog size={19} />
        <span>
          <strong>Supabase</strong>
          <small>Database health, connection test, and recovery</small>
        </span>
        <ChevronRight size={17} />
      </Link>
    </div>
  );
}