/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Base URL of the Implenix booking API (Render), e.g. https://api.implenix.net */
  readonly PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
