// Centralized error reporting hook. Today it captures uncaught errors and
// unhandled promise rejections to the console; it is the single place to wire
// a hosted error tracker (Sentry, etc.) when a DSN is available, so the rest
// of the app never imports the vendor SDK directly.
//
// To enable Sentry later:
//   1. npm install @sentry/react
//   2. set REACT_APP_SENTRY_DSN in the environment
//   3. replace the body of report() with Sentry.captureException(err)
//      and initialize Sentry inside initMonitoring().
//
// Left as a no-op tracker until then, so there is nothing to break and no
// account/key required to ship.

const DSN = process.env.REACT_APP_SENTRY_DSN || '';

export function report(err, context = {}) {
  // eslint-disable-next-line no-console
  console.error('[monitoring]', err, context);
  // When wired: if (DSN) Sentry.captureException(err, { extra: context });
}

export function initMonitoring() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => report(e.error || e.message, { kind: 'window.error' }));
  window.addEventListener('unhandledrejection', (e) => report(e.reason, { kind: 'unhandledrejection' }));
  if (DSN) {
    // eslint-disable-next-line no-console
    console.info('[monitoring] DSN configured; ready to initialize a hosted tracker.');
  }
}
