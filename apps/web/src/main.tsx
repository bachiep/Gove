import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Root element was not found');

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { hasError: boolean };

class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Gove UI runtime error', { error, errorInfo });
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-error-shell" role="alert">
          <div className="runtime-error-card">
            <p className="eyebrow">Gove</p>
            <h1>Ứng dụng cần được tải lại.</h1>
            <p>
              Một phần giao diện vừa gặp sự cố. Trạng thái chuyến và dữ liệu máy
              chủ vẫn được lưu độc lập; hãy thử tải lại trước khi tiếp tục.
            </p>
            <button
              className="primary-link"
              type="button"
              onClick={this.reload}
            >
              Tải lại ứng dụng
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
