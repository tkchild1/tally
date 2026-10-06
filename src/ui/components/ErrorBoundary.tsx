import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/** Catches render and query errors in a page. The message is generic: error text can contain transaction data. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card card-error" role="alert">
        <h2>Something went wrong on this page</h2>
        <p>Your data is still saved on this device. Try again, or reload the app.</p>
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </section>
    );
  }
}
