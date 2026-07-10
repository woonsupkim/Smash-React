// A compact dropdown for choosing the prediction engine, shared by the H2H
// and Brackets pages. Shows the active engine with its one-line description,
// and a menu of all engines (label + tag + description). Individual engines
// can be disabled with a reason (e.g. Hot Streak when recent data is thin).
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { ENGINES } from '../../engines';
import './EngineSelector.css';

export default function EngineSelector({ engine, setEngine, disabled = {}, align = 'center', recommended = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = ENGINES.find((e) => e.id === engine) || ENGINES[0];

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className={`engine-selector align-${align}`} ref={ref}>
      <div className="engine-selector-label">Prediction engine</div>
      <button type="button" className="engine-selector-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="engine-selector-current">{active.label}</span>
        {recommended === active.id
          ? <span className="engine-selector-tag rec">Recommended</span>
          : <span className="engine-selector-tag">{active.tag}</span>}
        <ChevronDown size={15} className={`engine-selector-chev${open ? ' up' : ''}`} />
      </button>

      {open && (
        <div className="engine-selector-menu" role="listbox">
          {ENGINES.map((e) => {
            const dis = disabled[e.id];
            return (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={engine === e.id}
                title={dis || e.desc}
                className={`engine-selector-item${engine === e.id ? ' active' : ''}${dis ? ' disabled' : ''}`}
                onClick={() => { if (dis) return; setEngine(e.id); setOpen(false); }}
              >
                <div className="engine-selector-item-head">
                  <span className="engine-selector-item-label">
                    {e.label}
                    {recommended === e.id && <span className="engine-selector-rec-badge">Recommended</span>}
                  </span>
                  {engine === e.id && <Check size={14} />}
                </div>
                <div className="engine-selector-item-desc">{dis || e.desc}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
