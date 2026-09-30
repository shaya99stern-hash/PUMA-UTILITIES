'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type ChipProps = {
  children: ReactNode;
  selected?: boolean;
  icon?: IconProp;
  count?: number | null;
  onClick?: () => void;
  /** Shows a remove (x) button. */
  onRemove?: () => void;
  className?: string;
  title?: string;
};

export function Chip({ children, selected, icon, count, onClick, onRemove, className, title }: ChipProps) {
  const content = (
    <>
      {renderIcon(icon, 14)}
      {children}
      {count != null && <span className="ui-chip__count">{count}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" title={title} className={cx('ui-chip', className)} aria-pressed={!!selected} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <span title={title} className={cx('ui-chip', selected && 'ui-chip--selected', className)}>
      {content}
      {onRemove && (
        <button type="button" className="ui-chip__remove" aria-label="Remove" onClick={onRemove}>
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

export type FilterOption = { value: string; label: ReactNode; count?: number | null; icon?: IconProp };

type FilterChipsBase = {
  options: FilterOption[];
  /** Wrap onto multiple lines instead of horizontal scroll. */
  wrap?: boolean;
  className?: string;
  'aria-label'?: string;
};

export type FilterChipsProps =
  | (FilterChipsBase & { multiple?: false; value: string; onChange: (value: string) => void })
  | (FilterChipsBase & { multiple: true; value: string[]; onChange: (value: string[]) => void });

export function FilterChips(props: FilterChipsProps) {
  const { options, wrap, className } = props;
  const isSelected = (v: string) => (props.multiple ? props.value.includes(v) : props.value === v);
  const toggle = (v: string) => {
    if (props.multiple) {
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else {
      props.onChange(v);
    }
  };
  return (
    <div className={cx('ui-chips', wrap && 'ui-chips--wrap', className)} role="group" aria-label={props['aria-label']}>
      {options.map((opt) => (
        <Chip key={opt.value} icon={opt.icon} count={opt.count} selected={isSelected(opt.value)} onClick={() => toggle(opt.value)}>
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
