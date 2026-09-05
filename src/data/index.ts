import type { PosRepository } from "./repository";
import { BrowserRepository } from "./browserRepository";

export async function createRepository(): Promise<PosRepository> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const { TauriRepository } = await import("./tauriRepository");
    return new TauriRepository();
  }
  return new BrowserRepository();
}
