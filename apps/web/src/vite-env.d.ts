/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE: boolean;
  readonly VITE_REPOSITORY_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
