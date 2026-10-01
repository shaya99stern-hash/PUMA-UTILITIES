'use client';

import { ChevronDown } from 'lucide-react';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** Icon shown inside the field on the left. */
  leading?: IconProp;
  /** Element shown inside the field on the right (e.g. a unit or IconButton). */
  trailing?: ReactNode;
  invalid?: boolean;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLInputElement>;
};

export function Input({ leading, trailing, invalid, size = 'md', className, ref, ...rest }: InputProps) {
  const input = (
    <input
      ref={ref}
      className={cx('ui-input', size === 'sm' && 'ui-input--sm', !leading && !trailing && className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cx('ui-input-wrap', leading && 'ui-input-wrap--lead', trailing && 'ui-input-wrap--trail', className)}>
      {leading && <span className="ui-input-wrap__lead">{renderIcon(leading, 16)}</span>}
      {input}
      {trailing && <span className="ui-input-wrap__trail">{trailing}</span>}
    </div>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: Ref<HTMLTextAreaElement> };

export function Textarea({ invalid, className, ref, ...rest }: TextareaProps) {
  return <textarea ref={ref} className={cx('ui-textarea', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  options?: ReadonlyArray<SelectOption | string>;
  /** Adds a first empty option with this label. */
  placeholder?: string;
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
};

export function Select({ options, placeholder, invalid, className, children, ref, ...rest }: SelectProps) {
  return (
    <div className={cx('ui-select-wrap', className)}>
      <select ref={ref} className="ui-select" aria-invalid={invalid || undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((opt) => {
          const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
          return (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          );
        })}
        {children}
      </select>
      <ChevronDown className="ui-select-wrap__chev" aria-hidden />
    </div>
  );
}

export type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** id of the control; generated and injected into a single child control when omitted. */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  const autoId = useId();
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const childId = (only?.props.id as string | undefined) ?? htmlFor ?? autoId;
  const hintId = `${childId}-hint`;
  const errorId = `${childId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = only
    ? cloneElement(only, {
        id: childId,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(required && only.props.required === undefined ? { required: true } : {}),
      })
    : children;
  return (
    <div className={cx('ui-field', className)}>
      {label && (
        <label className="ui-field__label" htmlFor={childId}>
          {label}
          {required && <span className="ui-field__req" aria-hidden>*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
