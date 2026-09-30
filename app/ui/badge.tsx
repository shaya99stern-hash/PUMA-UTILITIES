import type { ReactNode } from 'react';
import { stageMeta } from './stages';
import { cx, renderIcon, type IconProp } from './util';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

export type BadgeProps = {
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
  icon?: IconProp;
  outline?: boolean;
  square?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
};

export function Badge({ tone = 'neutral', dot, icon, outline, square, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx('ui-badge', tone !== 'neutral' && `ui-badge--${tone}`, outline && 'ui-badge--outline', square && 'ui-badge--square', className)}
    >
      {dot && <span className="ui-badge__dot" aria-hidden />}
      {renderIcon(icon, 12)}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function StageBadge({ stage, className }: { stage: string | null | undefined; className?: string }) {
  const meta = stageMeta(stage);
  return (
    <span className={cx('ui-stage', className)} title={meta.description}>
      <span className="ui-stage__dot" style={{ background: meta.color }} aria-hidden />
      {meta.label}
    </span>
  );
}

/** Tone for a 0-100 lead score. */
export function scoreTone(score: number | null | undefined): 'hot' | 'good' | 'fair' | 'low' | 'none' {
  if (score == null || Number.isNaN(score)) return 'none';
  if (score >= 80) return 'hot';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'low';
}

export function ScorePill({ score, className, title }: { score: number | null | undefined; className?: string; title?: string }) {
  const tone = scoreTone(score);
  const value = score == null || Number.isNaN(score) ? '—' : Math.round(score);
  return (
    <span className={cx('ui-score', tone !== 'none' && `ui-score--${tone}`, className)} title={title ?? (tone === 'none' ? 'Not scored' : `Score ${value} / 100`)}>
      {value}
    </span>
  );
}

const AVATAR_HUES = [18, 32, 200, 215, 262, 280, 160, 142, 350, 45];

export function initials(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter((w) => !/^(llc|inc|corp|co|the|and|of|lp|ltd)$/i.test(w));
  const list = words.length ? words : clean.split(/\s+/);
  const first = list[0]?.[0] ?? '';
  const second = list.length > 1 ? list[list.length - 1][0] : list[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export type AvatarProps = {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Rounded square (use for companies). */
  square?: boolean;
  className?: string;
};

export function Avatar({ name, src, size = 'md', square, className }: AvatarProps) {
  const hue = hueFor(name ?? '?');
  return (
    <span
      className={cx('ui-avatar', size !== 'md' && `ui-avatar--${size}`, square && 'ui-avatar--square', className)}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 32% 30%), hsl(${hue} 30% 20%))`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 40% 60% / 0.18)`,
        color: `hsl(${hue} 60% 88%)`,
      }}
      aria-hidden={!name}
      title={name ?? undefined}
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}
