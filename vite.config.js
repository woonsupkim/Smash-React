// Vite build + vitest config (replaced create-react-app in July 2026).
// Conventions preserved from the CRA era so nothing else had to move:
//   - dev server on port 3000 (preview tooling + launch.json expect it)
//   - production output in build/ (tracked in git; Vercel reads vercel.json)
//   - process.env.PUBLIC_URL/REACT_APP_* still work via `define` below
//   - JSX inside .js files (the whole src tree predates the .jsx convention)
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// CRA auto-loaded .env into process.env; Vite does not do that for config
// code, so read .env here (shell env still wins) - otherwise the local-dev
// REACT_APP_* instructions in supabase/SETUP.md silently do nothing.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return ({
  plugins: [react()],
  server: { port: 3000 },
  preview: { port: 3000 },
  build: { outDir: 'build' },
  esbuild: {
    loader: 'jsx',
    include: /\.js$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
  define: {
    'process.env.PUBLIC_URL': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.REACT_APP_SUPABASE_URL || ''),
    'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.REACT_APP_SUPABASE_ANON_KEY || ''),
    'process.env.REACT_APP_SENTRY_DSN': JSON.stringify(env.REACT_APP_SENTRY_DSN || ''),
    'process.env.REACT_APP_VAPID_PUBLIC_KEY': JSON.stringify(env.REACT_APP_VAPID_PUBLIC_KEY || ''),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
  });
});
