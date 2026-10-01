'use client';

import { X } from 'lucide-react';
import { useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './button';
import { useIsClient, useOverlayBehavior, usePresence } from './overlay';
import { cx } from './util';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky footer (buttons). */
  footer?: ReactNode;
  /** Drawer width on desktop. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Remove body padding. */
  flush?: boolean;
  /** Take (almost) the full height on phones. */
  full?: boolean;
  className?: string;
  'aria-label'?: string;
};

/** Bottom sheet on phones, right-hand drawer on desktop. */
export function Sheet({ open, onClose, title, description, children, footer, size = 'md', flush, full, className, ...aria }: SheetProps) {
  const client = useIsClient();
  const { mounted, closing } = usePresence(open, 220);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  useOverlayBehavior(open && mounted, panelRef, onClose);

  if (!client || !mounted) return null;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (window.innerWidth >= 768 || e.pointerType === 'mouse') return;
    drag.current = { startY: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    panelRef.current.style.transform = `translateY(${drag.current.dy}px)`;
    panelRef.current.style.transition = 'none';
  };
  const onPointerUp = () => {
    if (!drag.current || !panelRef.current) return;
    const { dy } = drag.current;
    drag.current = null;
    panelRef.current.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    if (dy > 90) {
      onClose();
    } else {
      panelRef.current.style.transform = '';
    }
  };

  return createPortal(
    <div className="ui-overlay" data-state={closing ? 'closing' : 'open'}>
      <div className="ui-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={title ? undefined : aria['aria-label']}
        tabIndex={-1}
        className={cx('ui-sheet', size !== 'md' && `ui-sheet--${size}`, full && 'ui-sheet--full', className)}
      >
        <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ touchAction: 'none' }}>
          <div className="ui-sheet__handle" aria-hidden />
          {(title || description) && (
            <div className="ui-sheet__header">
              <div className="ui-sheet__titles">
                {title && (
                  <h2 className="ui-sheet__title" id={titleId}>
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="ui-sheet__desc" id={descId}>
                    {description}
                  </p>
                )}
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>
          )}
        </div>
        <div className={cx('ui-sheet__body', flush && 'ui-sheet__body--flush')}>{children}</div>
        {footer && <div className="ui-sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
