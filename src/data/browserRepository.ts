import type { PosRepository, CheckoutInput } from "./repository";
import type { Product, Sale, Shift, Staff } from "../domain/types";
import { DEMO_PRODUCTS } from "./seed";
const K = { shift:"cpipos.desktop.demo.shift", sales:"cpipos.desktop.demo.sales" };
export class BrowserRepository implements PosRepository {
  async initialize() {}
  async verifyPin(pin:string): Promise<Staff|null> { return pin === "1234" ? { id:"staff-owner", code:"OWNER", displayName:"ผู้ดูแลร้าน", role:"owner" } : null; }
  async listProducts(): Promise<Product[]> { return DEMO_PRODUCTS; }
  async getActiveShift(): Promise<Shift|null> { const v=localStorage.getItem(K.shift); return v?JSON.parse(v):null; }
  async openShift(openingCash:number): Promise<Shift> { const s:Shift={id:crypto.randomUUID(),openedAt:new Date().toISOString(),openingCash,status:"open"}; localStorage.setItem(K.shift,JSON.stringify(s)); return s; }
  async closeShift(): Promise<void> { localStorage.removeItem(K.shift); }
  async checkout(input:CheckoutInput): Promise<Sale> {
    const total=input.items.reduce((s,i)=>s+i.quantity*i.unitPrice,0);
    const sale:Sale={id:crypto.randomUUID(),receiptNo:`R${Date.now().toString().slice(-8)}`,total,paid:input.paid,changeAmount:Math.max(0,input.paid-total),paymentMethod:input.paymentMethod,createdAt:new Date().toISOString()};
    const sales=await this.listSales(999); localStorage.setItem(K.sales,JSON.stringify([sale,...sales])); return sale;
  }
  async listSales(limit=20): Promise<Sale[]> { const v=localStorage.getItem(K.sales); return (v?JSON.parse(v):[]).slice(0,limit); }
}
