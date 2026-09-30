'use client';

import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './button';
import { useIsClient, useOverlayBehavior, usePresence } from './overlay';
import { cx } from './util';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Prevent closing by clicking the scrim (e.g. while saving). */
  dismissible?: boolean;
  className?: string;
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, className }: ModalProps) {
  const client = useIsClient();
  const { mounted, closing } = usePresence(open, 160);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useOverlayBehavior(open && mounted, panelRef, () => {
    if (dismissible) onClose();
  });

  if (!client || !mounted) return null;

  return createPortal(
    <div className="ui-overlay ui-overlay--modal" data-state={closing ? 'closing' : 'open'}>
      <div className="ui-scrim" onClick={dismissible ? onClose : undefined} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('ui-modal', size !== 'md' && `ui-modal--${size}`, className)}
      >
        {(title || description) && (
          <div className="ui-modal__header">
            <div className="ui-modal__titles">
              {title && (
                <h2 className="ui-modal__title" id={titleId}>
                  {title}
                </h2>
              )}
              {description && (
                <p className="ui-modal__desc" id={descId}>
                  {description}
                </p>
              )}
            </div>
            {dismissible && <IconButton icon={X} label="Close" onClick={onClose} />}
          </div>
        )}
        {children !== undefined && <div className="ui-modal__body">{children}</div>}
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
