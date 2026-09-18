"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface FallbackProps {
  error: Error | null;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  onReset?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary capturou uma exceção:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  public resetError = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
    });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({
          error: this.state.error,
          resetError: this.resetError,
        });
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex-1 w-full h-full min-h-[300px] flex flex-col items-center justify-center p-6 text-center bg-black text-white selection:bg-zinc-800">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-black/50">
            <AlertTriangle className="w-8 h-8 stroke-[1.8]" />
          </div>

          <h2 className="text-lg font-bold tracking-tight text-white mb-1.5">
            Ops! Algo deu errado
          </h2>

          <p className="text-xs text-zinc-400 max-w-xs leading-relaxed mb-6">
            Ocorreu uma falha inesperada ao carregar esta área. Tente recarregar para continuar navegando.
          </p>

          {this.state.error && process.env.NODE_ENV === "development" && (
            <div className="mb-6 max-w-xs w-full p-3 rounded-lg bg-zinc-950 border border-red-900/30 text-left overflow-auto max-h-28 text-[11px] font-mono text-red-300">
              {this.state.error.message}
            </div>
          )}

          <button
            type="button"
            onClick={this.resetError}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-xs tracking-wide flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer shadow-md"
          >
            <RotateCcw className="w-3.5 h-3.5 stroke-[2.2]" />
            Tentar novamente
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
