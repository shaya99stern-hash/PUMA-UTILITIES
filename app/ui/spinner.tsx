import { cx } from './util';

export function Spinner({ size = 'md', className, label = 'Loading' }: { size?: 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={cx('ui-spinner', size !== 'md' && `ui-spinner--${size}`, className)} />;
}
