/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `hub` or `mock`; see `api/index.ts`. */
  readonly VITE_API?: 'hub' | 'mock';
  /** A hub for the dev server to proxy `/api` to, e.g. `https://192.168.10.1`. */
  readonly VITE_HUB_URL?: string;
}
