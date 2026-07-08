// Lightweight toast notifications — replaces SweetAlert's screen-hijacking
// popups for transient notices. Module-level emitter so any code can call
// toast() without prop-drilling; <ToastHost/> renders once in App.
import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import './Toast.css';

let listeners = [];
let nextId = 1;

/**
 * Show a toast. type: 'success' | 'error' | 'warning' | 'info'
 * toast('Imported 8 players', 'success')
 * toast({ title: 'Import failed', message: err.message, type: 'error', duration: 6000 })
 */
export function toast(arg, type = 'info') {
  const t = typeof arg === 'string' ? { message: arg, type } : arg;
  const item = { id: nextId++, type: t.type || 'info', title: t.title || null, message: t.message || '', duration: t.duration ?? 4500 };
  listeners.forEach((fn) => fn(item));
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onToast = (item) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, item.duration);
    };
    listeners.push(onToast);
    return () => { listeners = listeners.filter((l) => l !== onToast); };
  }, []);

  return (
    <div className="toast-host" aria-live="polite">
      {items.map((item) => {
        const Icon = ICONS[item.type] || Info;
        return (
          <div className={`app-toast app-toast--${item.type}`} key={item.id} role="status">
            <Icon size={17} className="app-toast-icon" />
            <div className="app-toast-body">
              {item.title && <div className="app-toast-title">{item.title}</div>}
              <div className="app-toast-message">{item.message}</div>
            </div>
            <button
              className="app-toast-close"
              aria-label="Dismiss"
              onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
