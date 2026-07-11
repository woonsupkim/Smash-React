import React from 'react';
import { report } from '../utils/monitoring';
import Button from './ui/Button';
import './ErrorBoundary.css';

/**
 * App-level error boundary: a render error in any page shows a friendly,
 * on-brand fallback with a reload action instead of a blank white screen, and
 * routes the error to the monitoring hook (Sentry-ready).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    report(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <div className="error-boundary-title">Something went wrong</div>
          <p className="error-boundary-body">
            An unexpected error interrupted this page. Your data is safe. Reloading usually fixes it.
          </p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </div>
    );
  }
}
