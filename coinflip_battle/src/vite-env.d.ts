/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_PRIVATE_KEY: string;
  readonly VITE_PACKAGE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
