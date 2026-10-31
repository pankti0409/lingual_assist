import { Component, type ErrorInfo, type ReactNode } from "react";
import { type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { EmptyStateArt, UnavailableArt } from "@/art/Scenes";
import { Button, ButtonLink } from "@/components/Button";
import { useDocumentTitle } from "@/lib/dom";

export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading__dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span>Loading page…</span>
    </div>
  );
}

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <section className="page state-page" aria-labelledby="nf-title">
      <EmptyStateArt className="state-page__art" />
      <h1 id="nf-title" className="display-2">This page isn’t here.</h1>
      <p className="lede">The link may be out of date. Nothing about your session has changed.</p>
      <div className="actions">
        <ButtonLink to="/" variant="primary" icon={<ArrowLeft size={20} />}>Back to home</ButtonLink>
        <ButtonLink to="/conversation" variant="secondary">Open the conversation</ButtonLink>
      </div>
    </section>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  useDocumentTitle("Something went wrong");
  return <ErrorView message={error instanceof Error ? error.message : "Unknown error"} onRetry={reset} />;
}

function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="page state-page" aria-labelledby="err-title" role="alert">
      <UnavailableArt className="state-page__art" />
      <h1 id="err-title" className="display-2">Something went wrong on this screen.</h1>
      <p className="lede">Your confirmed messages were not changed. Nothing was spoken.</p>
      <p className="muted">Details: {message}</p>
      <div className="actions">
        {onRetry && <Button icon={<RefreshCw size={20} />} onClick={onRetry}>Try again</Button>}
        <ButtonLink to="/" variant="secondary">Back to home</ButtonLink>
      </div>
    </section>
  );
}

/** Top-level boundary for errors outside the router (providers, shell). */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page state-page" role="alert">
        <h1 className="display-2">Lingual Assist stopped working on this screen.</h1>
        <p className="lede">Nothing was spoken. Reload the page to continue.</p>
        <button type="button" className="btn btn--primary btn--md" onClick={() => location.reload()}>
          <span className="btn__label">Reload</span>
        </button>
      </main>
    );
  }
}
