/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'proxy' | 'direct' | 'snapshot';
  readonly VITE_USASPENDING_BASE?: string;
  readonly VITE_FISCALDATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
