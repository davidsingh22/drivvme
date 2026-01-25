import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  children: React.ReactNode;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error?: unknown;
};

/**
 * Route-level error boundary to prevent full-app blank screens.
 * Note: React error boundaries only catch render/lifecycle errors (not async).
 */
export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Keep this as a console error so we can see it in logs.
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary] Caught error", error, info);
  }

  private reset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message =
      this.state.error instanceof Error
        ? this.state.error.message
        : typeof this.state.error === "string"
          ? this.state.error
          : "Unexpected error";

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card className="w-full max-w-xl p-6">
          <h1 className="text-xl font-semibold">
            {this.props.title ?? "Something went wrong"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit a runtime error. You can safely reload and continue.
          </p>
          <div className="mt-4 rounded-md bg-muted p-3 text-xs font-mono overflow-auto">
            {message}
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Button onClick={this.reset} className="sm:w-auto">
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="sm:w-auto"
            >
              Reload page
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
