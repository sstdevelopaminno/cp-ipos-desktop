import Database from "@tauri-apps/plugin-sql";
import type { PosRepository, CheckoutInput } from "./repository";
import type { Product, Sale, Shift, Staff } from "../domain/types";

type DbProduct = { id:string; sku:string; name:string; category_id:string; category_name:string; price:number; active:number };
type DbShift = { id:string; opened_at:string; opening_cash:number; status:"open"|"closed" };
type DbSale = { id:string; receipt_no:string; total:number; paid:number; change_amount:number; payment_method:"cash"|"promptpay"|"card"; created_at:string };

export class TauriRepository implements PosRepository {
  private db?: Database;
  private async conn() {
    if(!this.db) {
      this.db = await Database.load("sqlite:cpipos.db");
      await this.db.execute("PRAGMA journal_mode=WAL");
      await this.db.execute("PRAGMA busy_timeout=5000");
    }
    return this.db;
  }
  async initialize() { await this.conn(); }
  async verifyPin(pin:string): Promise<Staff|null> {
    const db=await this.conn();
    // V0.1 demo PIN only. Replace with Argon2/PBKDF verification before production rollout.
    const rows=await db.select<Array<{id:string;code:string;display_name:string;role:"owner"|"manager"|"staff"}>>("SELECT id,code,display_name,role FROM staff WHERE pin_demo = $1 AND active = 1 LIMIT 1", [pin]);
    return rows[0] ? { id:rows[0].id, code:rows[0].code, displayName:rows[0].display_name, role:rows[0].role } : null;
  }
  async listProducts(): Promise<Product[]> {
    const db=await this.conn(); const rows=await db.select<DbProduct[]>("SELECT id,sku,name,category_id,category_name,price,active FROM products WHERE active=1 ORDER BY category_name,name");
    return rows.map(r=>({id:r.id,sku:r.sku,name:r.name,categoryId:r.category_id,categoryName:r.category_name,price:Number(r.price),active:Boolean(r.active)}));
  }
  async getActiveShift(): Promise<Shift|null> {
    const db=await this.conn(); const rows=await db.select<DbShift[]>("SELECT id,opened_at,opening_cash,status FROM shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1"); const r=rows[0];
    return r?{id:r.id,openedAt:r.opened_at,openingCash:Number(r.opening_cash),status:r.status}:null;
  }
  async openShift(openingCash:number): Promise<Shift> {
    const db=await this.conn(); const existing=await this.getActiveShift(); if(existing) return existing;
    const s:Shift={id:crypto.randomUUID(),openedAt:new Date().toISOString(),openingCash,status:"open"};
    await db.execute("INSERT INTO shifts(id,opened_at,opening_cash,status) VALUES($1,$2,$3,'open')",[s.id,s.openedAt,s.openingCash]); return s;
  }
  async closeShift(): Promise<void> { const db=await this.conn(); await db.execute("UPDATE shifts SET status='closed',closed_at=$1 WHERE status='open'",[new Date().toISOString()]); }
  async checkout(input:CheckoutInput): Promise<Sale> {
    const db=await this.conn(); const total=input.items.reduce((s,i)=>s+i.quantity*i.unitPrice,0); if(!input.items.length) throw new Error("EMPTY_CART"); if(input.paid<total && input.paymentMethod==="cash") throw new Error("INSUFFICIENT_CASH");
    const sale:Sale={id:crypto.randomUUID(),receiptNo:`R${Date.now().toString().slice(-8)}`,total,paid:input.paid,changeAmount:Math.max(0,input.paid-total),paymentMethod:input.paymentMethod,createdAt:new Date().toISOString()};
    // One INSERT is the atomic checkout boundary. A SQLite AFTER INSERT trigger
    // expands items_json into sale_items inside the same statement transaction.
    // This intentionally avoids BEGIN/COMMIT across plugin-sql pooled execute calls.
    await db.execute(
      "INSERT INTO sales(id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [sale.id,sale.receiptNo,sale.total,sale.paid,sale.changeAmount,sale.paymentMethod,JSON.stringify(input.items),sale.createdAt]
    );
    return sale;
  }
  async listSales(limit=20): Promise<Sale[]> {
    const db=await this.conn(); const rows=await db.select<DbSale[]>("SELECT id,receipt_no,total,paid,change_amount,payment_method,created_at FROM sales ORDER BY created_at DESC LIMIT $1",[limit]);
    return rows.map(r=>({id:r.id,receiptNo:r.receipt_no,total:Number(r.total),paid:Number(r.paid),changeAmount:Number(r.change_amount),paymentMethod:r.payment_method,createdAt:r.created_at}));
  }
}
