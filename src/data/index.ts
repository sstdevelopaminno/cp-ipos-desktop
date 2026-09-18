import type { PosRepository } from "./repository";
import { BrowserRepository } from "./browserRepository";

// Desktop startup must never block the UI while SQLite finishes WAL recovery or
// first-run migrations.  Keep this under App.tsx's hard startup timeout and let
// later repository calls use the same connection once it is ready.
const STARTUP_SOFT_INITIALIZE_MS = 1200;

function softTimeout(ms: number) {
  return new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), ms));
}

function withStartupStabilizer(base: PosRepository): PosRepository {
  let initializeTask: Promise<void> | null = null;
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "initialize") {
        return async () => {
          initializeTask ??= target.initialize().catch((error) => {
            initializeTask = null;
            throw error;
          });
          const result = await Promise.race([initializeTask.then(() => "ready" as const), softTimeout(STARTUP_SOFT_INITIALIZE_MS)]);
          if (result === "timeout") {
            console.warn("CpIPOS database initialization continues in the background");
            window.dispatchEvent(new CustomEvent("cpipos:database-initialize-background"));
          }
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PosRepository;
}

export async function createRepository(): Promise<PosRepository> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const { TauriRepository } = await import("./tauriRepository");
    // Cloud archive is intentionally not wrapped into the core repository path:
    // it can make buttons feel stuck when the network is slow. Cloud sync should
    // run from its own runtime after the app is ready.
    return withStartupStabilizer(new TauriRepository());
  }
  return new BrowserRepository();
}
