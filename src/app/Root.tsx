import { Outlet, useLocation } from 'react-router';
import { LoginPage } from '@/features/auth/LoginPage';
import { SetupFlow } from '@/features/auth/SetupFlow';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { isPublicPath } from '@/features/guide/guide';
import { PublicGuide } from '@/features/guide/PublicGuide';
import { useAuthState } from '@/data/queries';
import { AppShell } from '@/shell/AppShell';
import { LoadError, Skeleton } from '@/ui';

/**
 * The gate every visit passes through. A fresh device gets the provisioning
 * flow, a provisioned one the login, and a signed-in user the app.
 *
 * The URL is left alone while the gate is closed, so signing in lands on the
 * page that was asked for. The guide is the one page open to everyone: it is
 * shown on its own while the gate is closed, and inside the app once signed in.
 */
export function Root() {
  const auth = useAuthState();
  const { pathname } = useLocation();
  const signedIn = auth.isSuccess && !auth.data.setupRequired && auth.data.authenticated;

  if (!signedIn && isPublicPath(pathname)) return <PublicGuide />;

  if (auth.isPending) {
    return (
      <AuthLayout title="Connecting to the device">
        <Skeleton />
      </AuthLayout>
    );
  }
  if (auth.isError) {
    return (
      <AuthLayout title="Cannot reach the device">
        <LoadError error={auth.error} onRetry={() => void auth.refetch()} />
      </AuthLayout>
    );
  }
  if (auth.data.setupRequired) return <SetupFlow />;
  if (!auth.data.authenticated) return <LoginPage />;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
