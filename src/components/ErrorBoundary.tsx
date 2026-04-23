import { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-8 flex flex-col items-center justify-center gap-4 text-center animate-fade-in">
          <div className="p-3 rounded-2xl bg-danger/10">
            <AlertCircle className="w-8 h-8 text-danger" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-txt-primary mb-1">
              {this.props.fallbackTitle || 'Etwas ist schiefgelaufen'}
            </h3>
            <p className="text-xs text-txt-muted max-w-xs">
              {this.state.error?.message || 'Ein unerwarteter Fehler ist aufgetreten.'}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
