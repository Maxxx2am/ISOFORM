import { Component, type ReactNode } from 'react';

import { FatalErrorScreen } from '@/components/FatalErrorScreen';

type Props = { children: ReactNode };
type State = { error: Error | null; info: string | null };

/**
 * Catches any render-time error in the app and shows it on screen instead of
 * a blank/black view. Production release builds don't show Metro's red-box
 * overlay the way Expo Go does, so without this, any startup crash is
 * invisible — it just looks like the app never loaded. Deliberately has no
 * dependency on the theme system or any store, since those are exactly what
 * might be throwing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (this.state.error) {
      return <FatalErrorScreen error={this.state.error} extra={this.state.info} />;
    }
    return this.props.children;
  }
}
