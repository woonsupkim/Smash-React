// Dark-themed modal matching the app's surfaces — replaces SweetAlert for
// anything needing input or confirmation. Thin wrapper over react-bootstrap
// Modal so focus trapping/escape/backdrop behavior comes free.
import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import './AppModal.css';

export default function AppModal({
  show,
  onHide,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  confirmDisabled = false,
  showFooter = true,
}) {
  return (
    <Modal show={show} onHide={onHide} centered contentClassName="app-modal" backdropClassName="app-modal-backdrop">
      {title && (
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title className="app-modal-title">{title}</Modal.Title>
        </Modal.Header>
      )}
      <Modal.Body>{children}</Modal.Body>
      {showFooter && (
        <Modal.Footer>
          <Button variant="outline-light" size="sm" className="app-modal-cancel" onClick={onHide}>
            {cancelText}
          </Button>
          <Button size="sm" className="app-modal-confirm" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmText}
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
}
