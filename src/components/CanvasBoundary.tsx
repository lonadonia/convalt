import { Component, type ReactNode } from 'react';
import { ui } from '../state/store';

/**
 * Catches failures to load or start the 3D chunk (no WebGL context, chunk request failed…) and
 * switches the page to the static document layout, which keeps every explanation and link.
 */
export class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[convalt] 3D view failed to start', error);
    ui.set({ webgl: false, status: 'error' });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
