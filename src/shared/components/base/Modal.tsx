import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface ModalProps {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, description, isOpen, onClose, children, footer }: ModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar modal">
            <i className="fa-solid fa-xmark" aria-hidden />
          </Button>
        </div>
        <div className="mt-4 space-y-3">{children}</div>
        <div className="mt-6 flex justify-end gap-3">
          {footer ?? (
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
