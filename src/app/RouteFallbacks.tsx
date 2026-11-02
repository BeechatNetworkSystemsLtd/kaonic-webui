import { Link, useRouteError } from 'react-router';
import { errorMessage } from '@/api';
import { Page } from '@/shell/Page';
import { Button, EmptyState, Notice } from '@/ui';

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <EmptyState title="There is nothing at this address.">
        <Link to="/">Go to the mesh</Link>
      </EmptyState>
    </Page>
  );
}

/** Shown when a page crashes or its code fails to load. */
export function RouteError() {
  const error = useRouteError();
  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <Notice tone="danger">
        <strong>This page stopped working.</strong>
        <span>{errorMessage(error)}</span>
        <Button size="small" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Notice>
    </div>
  );
}
