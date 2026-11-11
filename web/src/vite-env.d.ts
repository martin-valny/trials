/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the diligence agent API. Absent or empty: the site runs offline (recorded runs only). */
  readonly VITE_DILIGENCE_URL?: string;
}
