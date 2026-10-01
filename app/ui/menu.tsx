'use client';

import Link from 'next/link';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type MenuActionItem = {
  label: ReactNode;
      icon?: IconProp;
      onSelect?: () => void;
      href?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Right-aligned hint (shortcut, count). */
  hint?: ReactNode;
  separator?: never;
  heading?: never;
};

export type MenuItem =
  | MenuActionItem
  | { separator: true; label?: never; heading?: never }
  | { heading: ReactNode; separator?: never; label?: never };

export type MenuProps = {
  /** The element that opens the menu (usually a Button or IconButton). */
  trigger: ReactElement;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
  'aria-label'?: string;
};

export function Menu({ trigger, items, align = 'end', className, ...aria }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) wrapRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setUp(below < 280 && rect.top > below);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      nodes[(index + delta + nodes.length) % nodes.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: (event: MouseEvent) => {
          (trigger.props as { onClick?: (e: MouseEvent) => void }).onClick?.(event);
          setOpen((v) => !v);
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        },
      })
    : trigger;

  return (
    <span ref={wrapRef} className={cx('ui-menu-wrap', className)}>
      {triggerEl}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={aria['aria-label']}
          className={cx('ui-menu', align === 'start' ? 'ui-menu--start' : 'ui-menu--end', up && 'ui-menu--up')}
          onKeyDown={onKeyDown}
        >
          {items.map((entry, i) => {
            if (entry.separator) return <div key={`sep-${i}`} className="ui-menu__sep" role="separator" />;
            if (entry.heading) return <div key={`h-${i}`} className="ui-menu__label">{entry.heading}</div>;
            const item = entry as MenuActionItem;
            const inner = (
              <>
                {renderIcon(item.icon, 16)}
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="ui-menu__item-hint">{item.hint}</span>}
              </>
            );
            const classes = cx('ui-menu__item', item.danger && 'ui-menu__item--danger');
            if (item.href && !item.disabled) {
              return (
                <Link
                  key={i}
                  href={item.href}
                  role="menuitem"
                  tabIndex={-1}
                  className={classes}
                  onClick={() => {
                    item.onSelect?.();
                    close(false);
                  }}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                className={classes}
                onClick={() => {
                  close();
                  item.onSelect?.();
                }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
