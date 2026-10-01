'use client';

import Link from 'next/link';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type TabItem = {
  value: string;
  label: ReactNode;
  count?: number | null;
  icon?: IconProp;
  /** Render as a link (route-based tabs). */
  href?: string;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange?: (value: string) => void;
  variant?: 'underline' | 'pill';
  className?: string;
  'aria-label'?: string;
};

export function Tabs({ items, value, onChange, variant = 'underline', className, ...aria }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-tab]:not([aria-disabled="true"])') ?? []);
    const index = tabs.findIndex((el) => el === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    if (!tabs[next]?.getAttribute('href')) tabs[next]?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={aria['aria-label']}
      className={cx('ui-tabs', variant === 'pill' && 'ui-tabs--pill', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const inner = (
          <>
            {renderIcon(item.icon, 15)}
            {item.label}
            {item.count != null && <span className="ui-tab__count">{item.count}</span>}
          </>
        );
        if (item.href) {
          return (
            <Link
              key={item.value}
              href={item.href}
              data-tab
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              className="ui-tab"
              onClick={() => onChange?.(item.value)}
            >
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            data-tab
            role="tab"
            aria-selected={selected}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            className="ui-tab"
            onClick={() => onChange?.(item.value)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
