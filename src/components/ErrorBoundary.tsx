import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div className="error-box" role="alert">
        Vynlo couldn’t display this view. Reload the page to try again. Your saved data is
        unchanged.
      </div>
    ) : (
      this.props.children
    );
  }
}
