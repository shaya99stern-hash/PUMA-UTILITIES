import { createElement, isValidElement, type ComponentType, type ReactNode } from 'react';

/** Tiny className joiner. */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ');
}

/** An icon can be passed as an element (`<Plus />`) or as a component (`Plus`). */
export type IconProp = ReactNode | ComponentType<{ size?: number | string; strokeWidth?: number; 'aria-hidden'?: boolean }>;

export function renderIcon(icon: IconProp | undefined, size?: number): ReactNode {
  if (icon == null || icon === false) return null;
  if (isValidElement(icon)) return icon;
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon)) {
    return createElement(icon as ComponentType<{ size?: number; 'aria-hidden'?: boolean }>, { size, 'aria-hidden': true });
  }
  return icon as ReactNode;
}
