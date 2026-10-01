import type { CSSProperties } from 'react';
import { cx } from './util';

export type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  /** Render N text lines (last one shorter). */
  lines?: number;
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({ width, height = 14, radius, lines, className, style }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className={cx('ui-skel-lines', className)} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ui-skel" style={{ height, width: i === lines - 1 ? '62%' : '100%', borderRadius: radius }} />
        ))}
      </div>
    );
  }
  return <span aria-hidden className={cx('ui-skel', className)} style={{ width: width ?? '100%', height, borderRadius: radius, ...style }} />;
}
