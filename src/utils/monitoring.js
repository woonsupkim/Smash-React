// Centralized error reporting. Without a DSN this stays a console tracker
// (nothing to break, no account required). With REACT_APP_SENTRY_DSN set,
// the Sentry SDK loads as a lazy chunk (never in the main bundle) and every
// uncaught error, unhandled rejection, and report() call flows there too.
//
// Enable: set REACT_APP_SENTRY_DSN in the environment (Vercel project env +
// .env locally) and redeploy. That's the whole switch.

const DSN = process.env.REACT_APP_SENTRY_DSN || '';

let sentry = null; // set once the lazy SDK import resolves

export function report(err, context = {}) {
  // eslint-disable-next-line no-console
  console.error('[monitoring]', err, context);
  if (sentry) {
    try { sentry.captureException(err instanceof Error ? err : new Error(String(err)), { extra: context }); } catch { /* never rethrow from the reporter */ }
  }
}

export function initMonitoring() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => report(e.error || e.message, { kind: 'window.error' }));
  window.addEventListener('unhandledrejection', (e) => report(e.reason, { kind: 'unhandledrejection' }));
  if (DSN) {
    import('@sentry/react')
      .then((Sentry) => {
        Sentry.init({
          dsn: DSN,
          // Light sampling: errors are the point; perf traces are a bonus.
          tracesSampleRate: 0.1,
        });
        sentry = Sentry;
        // eslint-disable-next-line no-console
        console.info('[monitoring] Sentry initialized');
      })
      .catch(() => { /* SDK failed to load; console tracking continues */ });
  }
}
