import React from 'react';
import ReactDOM from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// PWA installability. Production only - a service worker fighting webpack's
// dev server causes phantom-stale-code debugging sessions.
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`).catch(() => {});
  });
}