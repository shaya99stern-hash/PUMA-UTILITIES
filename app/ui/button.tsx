import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from './spinner';
import { cx, renderIcon, type IconProp } from './util';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon: `<Plus />` or `Plus`. */
  icon?: IconProp;
  /** Trailing icon. */
  iconRight?: IconProp;
  /** Render as a Next.js link. */
  href?: string;
  /** Open href in a new tab (for external links / downloads). */
  external?: boolean;
  /** Full-width button. */
  block?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  href,
  external,
  block,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const classes = cx(
    'ui-btn',
    `ui-btn--${variant}`,
    size === 'sm' && 'ui-btn--sm',
    block && 'ui-btn--block',
    loading && 'ui-btn--loading',
    className,
  );
  const iconSize = size === 'sm' ? 14 : 16;
  const content = (
    <>
      <span className="ui-btn__label">
        {renderIcon(icon, iconSize)}
        {children}
        {renderIcon(iconRight, iconSize)}
      </span>
      {loading && (
        <span className="ui-btn__spin">
          <Spinner size="sm" />
        </span>
      )}
    </>
  );

  if (href && !disabled) {
    const aria = rest['aria-label'] ? { 'aria-label': rest['aria-label'] } : {};
    if (external || /^(https?:|mailto:|tel:)/.test(href) || href.startsWith('/api/')) {
      return (
        <a
          className={classes}
          href={href}
          {...aria}
          title={rest.title}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {content}
        </a>
      );
    }
    return (
      <Link className={classes} href={href} {...aria} title={rest.title}>
        {content}
      </Link>
    );
  }

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconProp;
  /** Accessible label (also used as tooltip). Required. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  size?: 'sm' | 'md';
  href?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ icon, label, variant = 'ghost', size = 'md', href, className, type = 'button', ref, ...rest }: IconButtonProps) {
  const classes = cx('ui-iconbtn', variant !== 'ghost' && `ui-iconbtn--${variant}`, size === 'sm' && 'ui-iconbtn--sm', className);
  const glyph = renderIcon(icon, size === 'sm' ? 16 : 18);
  if (href) {
    return (
      <Link className={classes} href={href} aria-label={label} title={label}>
        {glyph}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={classes} aria-label={label} title={label} {...rest}>
      {glyph}
    </button>
  );
}
