/// <reference types="vite/client" />

declare global {
  interface Window {
    __CPIPOS_LICENSE_RUNTIME__?: any;
    __CPIPOS_CONTROL_STATE__?: any;
    __CPIPOS_CLOUD_BACKUP__?: any;
  }
}

export {};
