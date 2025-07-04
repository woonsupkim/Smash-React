// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 1) Grab your root DOM node
const container = document.getElementById('root');

// 2) Create a root.
const root = ReactDOM.createRoot(container);

// 3) Render your app into it.
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
