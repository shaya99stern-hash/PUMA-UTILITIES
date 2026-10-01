'use client';

import './rich-editor.css';

import { Bold, Italic, Link2, List, ListOrdered, RemoveFormatting } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MERGE_TAGS } from '@/lib/email/merge';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Show the merge-tag chips ({{first_name}} ...). */
  mergeTags?: boolean;
  minHeight?: number;
  autoFocus?: boolean;
  label?: string;
  compact?: boolean;
  footer?: ReactNode;
};

/**
 * Small rich-text editor on contentEditable: bold, italic, link, lists and a merge-tag inserter.
 * Output is plain HTML that the server sanitizes again before sending.
 */
export function RichEditor({ value, onChange, placeholder = 'Write your message…', mergeTags, minHeight = 160, autoFocus, label, compact, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [empty, setEmpty] = useState(!value);

  // Push external changes (template loaded, draft reset) into the editor without fighting the caret.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current || el.innerHTML !== value) {
      if (document.activeElement !== el || value !== lastEmitted.current) {
        el.innerHTML = value;
        lastEmitted.current = value;
        setEmpty(!el.textContent?.trim() && !/<(img|hr)/i.test(value));
      }
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === '<br>' ? '' : el.innerHTML;
    lastEmitted.current = html;
    setEmpty(!el.textContent?.trim() && !/<(img|hr)/i.test(html));
    onChange(html);
  }, [onChange]);

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreRange = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const run = (command: string, arg?: string) => {
    restoreRange();
    document.execCommand(command, false, arg);
    emit();
    saveRange();
  };

  const insertText = (text: string) => {
    restoreRange();
    document.execCommand('insertText', false, text);
    emit();
    saveRange();
  };

  const tool = (icon: ReactNode, title: string, onClick: () => void, active = false) => (
    <button
      type="button"
      className={`rte__btn${active ? ' is-active' : ''}`}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className={`rte${compact ? ' rte--compact' : ''}`}>
      {label && <span className="rte__label">{label}</span>}
      <div className="rte__box">
        <div className="rte__toolbar" role="toolbar" aria-label="Formatting">
          {tool(<Bold size={15} />, 'Bold', () => run('bold'))}
          {tool(<Italic size={15} />, 'Italic', () => run('italic'))}
          {tool(<Link2 size={15} />, 'Add link', () => {
            saveRange();
            setLinkUrl('https://');
            setLinkOpen((v) => !v);
          })}
          {tool(<List size={15} />, 'Bulleted list', () => run('insertUnorderedList'))}
          {tool(<ListOrdered size={15} />, 'Numbered list', () => run('insertOrderedList'))}
          {tool(<RemoveFormatting size={15} />, 'Clear formatting', () => run('removeFormat'))}
        </div>
        {linkOpen && (
          <form
            className="rte__link"
            onSubmit={(e) => {
              e.preventDefault();
              const url = linkUrl.trim();
              if (/^(https?:\/\/|mailto:)/i.test(url) && url.length > 8) run('createLink', url);
              setLinkOpen(false);
            }}
          >
            <input
              className="ui-input ui-input--sm"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Link address"
              autoFocus
            />
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
              <span className="ui-btn__label">Add</span>
            </button>
          </form>
        )}
        <div className="rte__surface" style={{ minHeight }}>
          {empty && <span className="rte__placeholder">{placeholder}</span>}
          <div
            ref={ref}
            className="rte__editable"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={label ?? 'Message'}
            style={{ minHeight }}
            onInput={emit}
            onBlur={() => {
              saveRange();
              emit();
            }}
            onKeyUp={saveRange}
            onMouseUp={saveRange}
            onTouchEnd={saveRange}
            onPaste={(e) => {
              // Paste as plain text: pasted email/web styles are what break layouts.
              e.preventDefault();
              const text = e.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text);
            }}
          />
        </div>
        {mergeTags && (
          <div className="rte__tags" aria-label="Insert merge tag">
            <span className="rte__tags-label">Insert</span>
            <div className="rte__tags-scroll">
              {MERGE_TAGS.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  className="rte__tag"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertText(`{{${t.tag}${t.tag === 'first_name' ? '|there' : ''}}}`)}
                  title={`Inserts {{${t.tag}}} (e.g. ${t.example})`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
