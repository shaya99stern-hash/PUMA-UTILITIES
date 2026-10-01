import type { ReactNode } from 'react';
import { cx } from './util';

export type ProgressBarProps = {
  /** 0-100. Omit for an indeterminate bar. */
  value?: number | null;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  label?: ReactNode;
  /** Right-side label; defaults to the percentage when a label is set. */
  valueLabel?: ReactNode;
  className?: string;
};

export function ProgressBar({ value, tone = 'default', size = 'md', label, valueLabel, className }: ProgressBarProps) {
  const indeterminate = value == null;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx('ui-progress', tone !== 'default' && `ui-progress--${tone}`, size === 'sm' && 'ui-progress--sm', indeterminate && 'ui-progress--indeterminate', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      {(label || valueLabel) && (
        <div className="ui-progress__top">
          <span className="truncate">{label}</span>
          <span className="num">{valueLabel ?? (indeterminate ? '' : `${Math.round(pct)}%`)}</span>
        </div>
      )}
      <div className="ui-progress__track">
        <div className="ui-progress__bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
