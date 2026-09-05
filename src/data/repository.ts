import type { Product, Sale, Shift, Staff } from "../domain/types";
export type CheckoutInput = { items: { productId:string; name:string; quantity:number; unitPrice:number }[]; paymentMethod:"cash"|"promptpay"|"card"; paid:number };
export interface PosRepository {
  initialize(): Promise<void>;
  verifyPin(pin: string): Promise<Staff | null>;
  listProducts(): Promise<Product[]>;
  getActiveShift(): Promise<Shift | null>;
  openShift(openingCash: number): Promise<Shift>;
  closeShift(): Promise<void>;
  checkout(input: CheckoutInput): Promise<Sale>;
  listSales(limit?: number): Promise<Sale[]>;
}
