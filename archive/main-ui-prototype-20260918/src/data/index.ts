import type { AppSettings } from "../domain/types";
import type { PosRepository } from "./repository";
import { BrowserRepository } from "./browserRepository";

function booleanSetting(value: unknown) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    paymentQrEnabled: booleanSetting(settings.paymentQrEnabled)
  };
}

function withNormalizedSettings(repo: PosRepository): PosRepository {
  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property === "getSettings") {
        return async () => normalizeSettings(await target.getSettings());
      }
      if (property === "updateSettings") {
        return async (settings: AppSettings, staff: Parameters<PosRepository["updateSettings"]>[1]) =>
          normalizeSettings(await target.updateSettings({ ...settings, paymentQrEnabled: booleanSetting(settings.paymentQrEnabled) }, staff));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export async function createRepository(): Promise<PosRepository> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const { TauriRepository } = await import("./tauriRepository");
    return withNormalizedSettings(new TauriRepository());
  }
  return withNormalizedSettings(new BrowserRepository());
}
