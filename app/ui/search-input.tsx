'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import { cx } from './util';

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'size'> & {
  value: string;
  onChange: (value: string) => void;
  /** Debounce onChange by N ms (the input itself stays responsive). */
  debounce?: number;
  onSubmit?: (value: string) => void;
  /** Keyboard hint shown on the right when empty, e.g. "/" or "⌘K". */
  shortcut?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

export function SearchInput({ value, onChange, debounce = 0, onSubmit, shortcut, className, placeholder = 'Search', ref, onKeyDown, ...rest }: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const emit = (next: string) => {
    setLocal(next);
    if (!debounce) return onChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), debounce);
  };

  return (
    <form
      role="search"
      className={cx('ui-search', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        onChange(local);
        onSubmit?.(local);
      }}
    >
      <Search className="ui-search__icon" aria-hidden />
      <input
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
        }}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="ui-search__input"
        placeholder={placeholder}
        aria-label={rest['aria-label'] ?? placeholder}
        value={local}
        onChange={(e) => emit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && local) {
            e.stopPropagation();
            emit('');
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
      <span className="ui-search__right">
        {local ? (
          <button
            type="button"
            className="ui-search__clear"
            aria-label="Clear search"
            onClick={() => {
              emit('');
              innerRef.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        ) : shortcut ? (
          <kbd className="ui-kbd hide-mobile">{shortcut}</kbd>
        ) : null}
      </span>
    </form>
  );
}
