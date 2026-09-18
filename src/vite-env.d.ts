/// <reference types="vite/client" />

declare global {
  interface Window {
    __CPIPOS_LICENSE_RUNTIME__?: {
      mode?: "trial" | "licensed" | "locked" | "error";
      token?: string;
      deviceCode?: string;
      trialEndsAt?: string;
      daysRemaining?: number;
      payload?: {
        licenseId?: string;
        plan?: string;
        customer?: string;
        issuedAt?: string;
        notBefore?: string;
        expiresAt?: string | null;
        maxDevices?: number;
        deviceCount?: number;
        features?: string[];
      };
    };
  }
}

export {};
