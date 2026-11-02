import { createBrowserRouter, type RouteObject } from 'react-router';
import { PAGES } from './pages';
import { Root } from './Root';
import { NotFoundPage, RouteError } from './RouteFallbacks';

const pageRoutes: RouteObject[] = PAGES.map((page) => ({
  ...(page.path === '' ? { index: true } : { path: page.path }),
  lazy: async () => ({ Component: (await page.load()).default }),
}));

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    errorElement: <RouteError />,
    // Shown for the moment it takes to load the first page's code.
    HydrateFallback: () => null,
    children: [
      ...pageRoutes,
      {
        path: 'nodes/:nodeId',
        lazy: async () => ({ Component: (await import('@/features/nodes/NodePage')).default }),
      },
      {
        path: 'plugins/:pluginId',
        lazy: async () => ({ Component: (await import('@/plugins/PluginPage')).default }),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
