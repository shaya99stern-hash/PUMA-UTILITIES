'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { cx } from './util';

export type KeyValueItem = {
  label: ReactNode;
  value: ReactNode;
  /** Make the value a link (internal or external). */
  href?: string;
  /** Show a copy button; pass a string to copy something other than the rendered value. */
  copy?: boolean | string;
  hidden?: boolean;
};

export type KeyValueProps = {
  items: KeyValueItem[];
  /** rows: label left / value right with dividers. compact: no dividers. stacked: label above value. */
  variant?: 'rows' | 'compact' | 'stacked';
  className?: string;
};

function isEmpty(value: ReactNode) {
  return value === null || value === undefined || value === '' || value === false;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ui-kv__copy"
      aria-label="Copy"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard may be unavailable */
        }
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
    </button>
  );
}

export function KeyValue({ items, variant = 'rows', className }: KeyValueProps) {
  return (
    <dl className={cx('ui-kv', variant !== 'rows' && `ui-kv--${variant}`, className)}>
      {items
        .filter((item) => !item.hidden)
        .map((item, i) => {
          const empty = isEmpty(item.value);
          const external = item.href && /^(https?:|mailto:|tel:)/.test(item.href);
          const value = empty ? (
            '—'
          ) : item.href ? (
            external ? (
              <a href={item.href} target={item.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
                {item.value}
              </a>
            ) : (
              <Link href={item.href}>{item.value}</Link>
            )
          ) : (
            item.value
          );
          const copyText = typeof item.copy === 'string' ? item.copy : typeof item.value === 'string' || typeof item.value === 'number' ? String(item.value) : null;
          return (
            <div key={i} className="ui-kv__row">
              <dt className="ui-kv__label">{item.label}</dt>
              <dd className={cx('ui-kv__value', empty && 'ui-kv__value--empty')}>
                <span className="grow" style={{ overflowWrap: 'anywhere' }}>{value}</span>
                {item.copy && !empty && copyText && <CopyButton text={copyText} />}
              </dd>
            </div>
          );
        })}
    </dl>
  );
}
