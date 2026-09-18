import type { Sale } from "../domain/types";
import { getCloudArchivedReceipt, listCloudArchivedSales, mergeLocalAndCloudSales } from "../cloud-archive-client";
import type { PosRepository, SaleFilters } from "./repository";
import { BrowserRepository } from "./browserRepository";

const STARTUP_SOFT_INITIALIZE_MS = 6500;

function matchesFilters(sale: Sale, filters: SaleFilters = {}) {
  const date = sale.createdAt.slice(0, 10);
  if (filters.todayOnly && date !== new Date().toISOString().slice(0, 10)) return false;
  if (filters.date && date !== filters.date) return false;
  if (filters.paymentMethod && filters.paymentMethod !== "all" && sale.paymentMethod !== filters.paymentMethod) return false;
  if (filters.status && filters.status !== "all" && sale.status !== filters.status) return false;
  if (filters.receipt && !sale.receiptNo.toLowerCase().includes(filters.receipt.toLowerCase())) return false;
  return true;
}

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
            console.warn("CpIPOS database initialization is still running in the background");
            window.dispatchEvent(new CustomEvent("cpipos:database-initialize-background"));
          }
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PosRepository;
}

function withCloudArchive(base: PosRepository): PosRepository {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "listSales") {
        return async (limit = 50, filters: SaleFilters = {}) => {
          const [localRows, cloudRows] = await Promise.all([
            target.listSales(Math.max(limit, 3000), { status: "all" }),
            listCloudArchivedSales(Math.max(limit, 3000))
          ]);
          return mergeLocalAndCloudSales(localRows, cloudRows).filter(row => matchesFilters(row, filters)).slice(0, limit);
        };
      }
      if (property === "getSale") {
        return async (id: string) => {
          const local = await target.getSale(id);
          if (local) return local;
          const cloudRows = await listCloudArchivedSales(3000);
          return cloudRows.find(row => row.id === id) ?? null;
        };
      }
      if (property === "getReceipt") {
        return async (id: string) => {
          const local = await target.getReceipt(id);
          if (local) return local;
          const settings = await target.getSettings();
          return getCloudArchivedReceipt(id, settings);
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
    return withCloudArchive(withStartupStabilizer(new TauriRepository()));
  }
  return new BrowserRepository();
}
