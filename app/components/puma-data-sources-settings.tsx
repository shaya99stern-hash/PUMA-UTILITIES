'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

const CUSTOM_SOURCES_KEY = 'puma-custom-sources-v1';

type Capability = {
  webDiscoveryConfigured?: boolean;
  webDiscoveryBackend?: string;
  browserEnrichmentConfigured?: boolean;
  officialLeadershipSources?: string[];
  officialPropertySources?: string[];
  structuredFirstParty?: string[];
};

type CustomSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

type SourceRow = {
  id: string;
  name: string;
  status: 'Active' | 'Unavailable' | 'Checking';
  detail?: string;
};

function readCustomSources(): CustomSource[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_SOURCES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CustomSource => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<CustomSource>;
      return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.url === 'string' && typeof candidate.enabled === 'boolean';
    });
  } catch {
    return [];
  }
}

export default function PumaDataSourcesSettings() {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [customSources, setCustomSources] = useState<CustomSource[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCustomSources(readCustomSources());
    fetch('/api/research/run', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Source check failed.')))
      .then((payload: Capability) => setCapability(payload))
      .catch(() => setCapability({ webDiscoveryConfigured: false, browserEnrichmentConfigured: false }));
  }, []);

  const builtInSources = useMemo<SourceRow[]>(() => {
    const checking = capability === null;
    const leadership = capability?.officialLeadershipSources ?? [];
    const property = capability?.officialPropertySources ?? [];
    const structured = capability?.structuredFirstParty ?? [];
    return [
      {
        id: 'public-web',
        name: 'Public web discovery',
        status: checking ? 'Checking' : capability?.webDiscoveryConfigured ? 'Active' : 'Unavailable',
        detail: capability?.webDiscoveryBackend === 'searxng' ? 'Search service' : 'Public web',
      },
      {
        id: 'official-leadership',
        name: 'Official leadership records',
        status: checking ? 'Checking' : leadership.length > 0 ? 'Active' : 'Unavailable',
        detail: leadership.includes('sec-edgar') ? 'SEC EDGAR' : undefined,
      },
      {
        id: 'official-property',
        name: 'Official property records',
        status: checking ? 'Checking' : property.length > 0 ? 'Active' : 'Unavailable',
        detail: property.length ? `${property.length} connected sources` : undefined,
      },
      {
        id: 'company-websites',
        name: 'Company websites',
        status: checking ? 'Checking' : structured.length > 0 ? 'Active' : 'Unavailable',
        detail: structured.length ? 'First-party structured data' : undefined,
      },
      {
        id: 'browser-enrichment',
        name: 'Public directory enrichment',
        status: checking ? 'Checking' : capability?.browserEnrichmentConfigured ? 'Active' : 'Unavailable',
      },
    ];
  }, [capability]);

  const persistCustomSources = (next: CustomSource[]) => {
    setCustomSources(next);
    window.localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(next));
  };

  const addSource = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const cleanName = name.trim();
    const cleanUrl = url.trim();
    if (!cleanName || !cleanUrl) {
      setError('Enter a name and URL.');
      return;
    }
    try {
      const parsed = new URL(cleanUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Invalid protocol');
      const next: CustomSource = {
        id: `custom-${Date.now()}`,
        name: cleanName,
        url: parsed.toString(),
        enabled: true,
      };
      persistCustomSources([...customSources, next]);
      setName('');
      setUrl('');
      setAdding(false);
    } catch {
      setError('Enter a valid public web URL.');
    }
  };

  const toggleSource = (id: string) => {
    persistCustomSources(customSources.map((source) => source.id === id ? { ...source, enabled: !source.enabled } : source));
  };

  const removeSource = (id: string) => {
    persistCustomSources(customSources.filter((source) => source.id !== id));
  };

  return (
    <div className="pm-source-settings">
      <div className="pm-source-list" aria-label="Built-in data sources">
        {builtInSources.map((source) => (
          <div className="pm-source-row" key={source.id}>
            <span>
              <strong>{source.name}</strong>
              {source.detail && <small>{source.detail}</small>}
            </span>
            <em className={`pm-source-status ${source.status.toLowerCase()}`}>{source.status}</em>
          </div>
        ))}
      </div>

      {customSources.length > 0 && (
        <div className="pm-source-list pm-custom-source-list" aria-label="Custom data sources">
          {customSources.map((source) => (
            <div className="pm-source-row" key={source.id}>
              <span>
                <strong>{source.name}</strong>
                <small>{source.url}</small>
              </span>
              <div className="pm-source-actions">
                <button type="button" className={`pm-source-toggle ${source.enabled ? 'active' : ''}`} onClick={() => toggleSource(source.id)} aria-pressed={source.enabled}>{source.enabled ? 'On' : 'Off'}</button>
                <button type="button" className="pm-source-remove" onClick={() => removeSource(source.id)} aria-label={`Remove ${source.name}`}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form className="pm-add-source" onSubmit={addSource}>
          <label><span>Source name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Source name" autoFocus /></label>
          <label><span>URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" inputMode="url" /></label>
          {error && <p className="pm-source-error">{error}</p>}
          <div className="pm-add-source-actions"><button type="button" onClick={() => { setAdding(false); setError(''); }}>Cancel</button><button type="submit">Save Source</button></div>
          <small>Custom source references are saved on this device.</small>
        </form>
      ) : (
        <button className="pm-add-source-button" type="button" onClick={() => setAdding(true)}>Add Source</button>
      )}
    </div>
  );
}
