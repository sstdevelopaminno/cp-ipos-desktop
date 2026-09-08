import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { CancelBillInput, CheckoutInput, EmployeeInput, PosRepository, ProductInput, SaleFilters, StockInput, VoidSaleInput } from "./repository";
import type { AppSettings, AuditEvent, PaymentMethod, Product, Receipt, Sale, SalesSummary, Shift, Staff, StockMovement, StockMovementType, StorageHealth } from "../domain/types";

type DbProduct = { id:string; product_code?:string|null; sku:string; barcode?:string|null; name?:string|null; name_th?:string|null; name_en?:string|null; category_id:string; category_name:string; price:number; cost:number; unit:string; stock_quantity:number; minimum_stock:number; quantity_scale?:number|null; image_path?:string|null; active:number };
type DbShift = { id:string; opened_at:string; opening_cash:number; status:"open"|"closed" };
type DbSale = { id:string; receipt_no:string; total:number; paid:number; change_amount:number; payment_method:PaymentMethod; created_at:string; status:"completed"|"cancelled"; cashier_name?:string|null; employee_code?:string|null; shift_id?:string|null; cancelled_at?:string|null; cancelled_reason?:string|null };
type DbSaleItem = { id:string; sale_id:string; product_id?:string|null; name:string; quantity:number; unit_price:number; line_total:number };
type DbStaff = { id:string; code:string; display_name:string; role:Staff["role"]; active:number };
type DbAudit = { id:string; timestamp:string; employee_id?:string|null; employee_code?:string|null; role?:Staff["role"]|null; action:string; entity_type?:string|null; entity_id?:string|null; shift_id?:string|null; device_id?:string|null; reason?:string|null; status?:string|null; details_json?:string|null };
type DbStock = { id:string; product_id:string; sku:string; name:string; movement_type:string; quantity:number; before_quantity:number; after_quantity:number; unit_cost:number; reason?:string|null; employee_id?:string|null; shift_id?:string|null; created_at:string };

const DEFAULT_SETTINGS: AppSettings = {
  storeName: "CpIPOS Store",
  branchName: "Main Branch",
  deviceName: "POS-01",
  deviceId: "desktop-pos-01",
  receiptHeader: "CpIPOS",
  taxId: "",
  address: "",
  phone: "",
  receiptFooter: "ขอบคุณที่ใช้บริการ",
  storeLogoPath: "",
  ownerName: "Owner",
  ownerPinNote: "Demo-only owner PIN. Secure hashing is a later task.",
  printerType: "windows-print-dialog",
  printerName: "",
  printerPaperWidthMm: "80",
  printerConnectionNote: "เลือกเครื่องพิมพ์ 80mm ผ่าน Windows Print Dialog ในการพิมพ์ครั้งแรก",
  printerSetupConfirmed: false,
  printerAutoConnect: true,
  printerAutoPrintReceipt: true,
  printerConnectionStatus: "not_checked",
  printerLastCheckedAt: "",
  cashDrawerEnabled: true,
  scannerMode: "keyboard-wedge",
  remoteManagementEnabled: false,
  programLicenseKey: "",
  programLicenseToken: "",
  programLicenseStatus: "not_configured",
  programLicensePlan: "",
  programLicenseDeviceLimit: "1",
  programLicenseDeviceFingerprint: "",
  programLicenseBackendUrl: "",
  programLicenseActivatedAt: "",
  programLicenseExpiresAt: "",
  programLicenseLastCheckedAt: "",
  language: "th",
};

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const qty = (value: number) => Math.round((Number(value) || 0) * 1000) / 1000;
const todayRange = (date: string) => [`${date}T00:00:00.000`, `${date}T23:59:59.999`];
const cleanBarcode = (value?: string) => (value || "").trim().replace(/\s+/g, "");
const productSelect = "SELECT id,product_code,sku,barcode,name,name_th,name_en,category_id,category_name,price,cost,unit,stock_quantity,minimum_stock,quantity_scale,image_path,active FROM products";
const stockType = (value: string): StockMovementType => {
  if (value === "in") return "STOCK_IN";
  if (value === "out") return "STOCK_OUT";
  if (value === "adjustment") return "ADJUSTMENT";
  if (value === "sale") return "SALE";
  if (["STOCK_IN","SALE","STOCK_OUT","ADJUSTMENT","SALE_VOID_RETURN"].includes(value)) return value as StockMovementType;
  return "ADJUSTMENT";
};

export class TauriRepository implements PosRepository {
  private db?: Database;

  private async conn() {
    if (!this.db) {
      this.db = await Database.load("sqlite:cpipos.db");
      await this.db.execute("PRAGMA journal_mode=WAL");
      await this.db.execute("PRAGMA busy_timeout=5000");
    }
    return this.db;
  }

  async initialize() {
    const db = await this.conn();
    await this.ensureSettings(db);
  }

  private product(r: DbProduct): Product {
    const productCode = r.product_code || r.sku;
    const nameTh = r.name_th || r.name || "";
    return {
      id: r.id,
      productCode,
      sku: productCode,
      barcode: r.barcode || undefined,
      nameTh,
      nameEn: r.name_en || undefined,
      name: nameTh,
      categoryId: r.category_id,
      categoryName: r.category_name,
      price: Number(r.price),
      cost: Number(r.cost || 0),
      unit: r.unit || "ชิ้น",
      stockQuantity: Number(r.stock_quantity || 0),
      minimumStock: Number(r.minimum_stock || 0),
      quantityScale: Number(r.quantity_scale || 1),
      imagePath: r.image_path || undefined,
      active: Boolean(r.active),
    };
  }

  private sale(r: DbSale): Sale {
    return { id:r.id, receiptNo:r.receipt_no, total:Number(r.total), paid:Number(r.paid), changeAmount:Number(r.change_amount), paymentMethod:r.payment_method, createdAt:r.created_at, status:r.status, cashierName:r.cashier_name || undefined, employeeCode:r.employee_code || undefined, shiftId:r.shift_id || undefined, cancelledAt:r.cancelled_at || undefined, cancelledReason:r.cancelled_reason || undefined };
  }

  private staff(r: DbStaff): Staff { return { id:r.id, code:r.code, displayName:r.display_name, role:r.role, active:Boolean(r.active) }; }

  private async ensureSettings(db: Database) {
    for (const [key, value] of Object.entries(this.settingsToRows(DEFAULT_SETTINGS))) {
      await db.execute("INSERT OR IGNORE INTO app_settings(key,value) VALUES($1,$2)", [key, value]);
    }
  }

  private settingsToRows(s: AppSettings) { return { ...s, remoteManagementEnabled: String(s.remoteManagementEnabled), printerSetupConfirmed: String(s.printerSetupConfirmed), printerAutoConnect: String(s.printerAutoConnect), printerAutoPrintReceipt: String(s.printerAutoPrintReceipt), cashDrawerEnabled: String(s.cashDrawerEnabled) }; }
  private rowsToSettings(rows: {key:string;value:string}[]): AppSettings {
    const map = new Map(rows.map(r => [r.key, r.value]));
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(map), remoteManagementEnabled: map.get("remoteManagementEnabled") === "true", printerSetupConfirmed: map.get("printerSetupConfirmed") === "true", printerAutoConnect: map.get("printerAutoConnect") !== "false", printerAutoPrintReceipt: map.get("printerAutoPrintReceipt") !== "false", cashDrawerEnabled: map.get("cashDrawerEnabled") !== "false", language: map.get("language") === "en" ? "en" : "th" };
  }

  private async audit(action:string, staff?:Staff, data:Partial<AuditEvent>={}) {
    const db = await this.conn();
    await db.execute("INSERT INTO audit_events(id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,shift_id,device_id,reason,status,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [crypto.randomUUID(), new Date().toISOString(), staff?.id ?? null, staff?.code ?? null, staff?.role ?? null, action, data.entityType ?? null, data.entityId ?? null, data.shiftId ?? null, data.deviceId ?? null, data.reason ?? null, data.status ?? null, data.details ?? null]);
  }

  async verifyPin(pin:string, code?:string) { const db=await this.conn(); const wanted=code?.trim(); const rows=wanted ? await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE pin_demo = $1 AND lower(code)=lower($2) AND active = 1 LIMIT 1", [pin,wanted]) : await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE pin_demo = $1 AND active = 1 LIMIT 1", [pin]); return rows[0] ? this.staff(rows[0]) : null; }
  async getSavedSession() { const db=await this.conn(); const meta=await db.select<Array<{value:string}>>("SELECT value FROM app_meta WHERE key='current_staff_id' LIMIT 1"); if(!meta[0]) return null; const rows=await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE id=$1 AND active=1 LIMIT 1", [meta[0].value]); return rows[0] ? this.staff(rows[0]) : null; }
  async saveSession(staff:Staff) { const db=await this.conn(); await db.execute("INSERT INTO app_meta(key,value) VALUES('current_staff_id',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [staff.id]); await this.audit("LOGIN", staff, { entityType:"session", entityId:staff.id }); }
  async clearSession(staff?:Staff, shift?:Shift, deviceId?:string) { const db=await this.conn(); await db.execute("DELETE FROM app_meta WHERE key='current_staff_id'"); await this.audit("LOGOUT", staff, { entityType:"session", entityId:staff?.id, shiftId:shift?.id, deviceId }); }

  async listProducts() { const db=await this.conn(); const rows=await db.select<DbProduct[]>(`${productSelect} ORDER BY active DESC, category_name, name_th`); return rows.map(r=>this.product(r)); }
  async findProductByBarcode(barcode:string) { const code=cleanBarcode(barcode); if(!code) return null; const db=await this.conn(); const rows=await db.select<DbProduct[]>(`${productSelect} WHERE barcode=$1 LIMIT 1`, [code]); return rows[0] ? this.product(rows[0]) : null; }
  async findProductByCode(productCode:string) { const code=productCode.trim(); if(!code) return null; const db=await this.conn(); const rows=await db.select<DbProduct[]>(`${productSelect} WHERE product_code=$1 OR sku=$1 LIMIT 1`, [code]); return rows[0] ? this.product(rows[0]) : null; }

  async createProduct(input:ProductInput, staff:Staff) {
    const db=await this.conn();
    const productCode=input.productCode.trim();
    const barcode=cleanBarcode(input.barcode) || null;
    if(await this.findProductByCode(productCode)) throw new Error("PRODUCT_CODE_EXISTS");
    if(barcode && await this.findProductByBarcode(barcode)) throw new Error("BARCODE_EXISTS");
    const product={...input,id:input.id || crypto.randomUUID(),productCode,sku:productCode,barcode:barcode || undefined,name:input.nameTh,nameTh:input.nameTh.trim(),nameEn:input.nameEn?.trim() || undefined,active:input.active ?? true,quantityScale:input.quantityScale || 1} as Product;
    await db.execute("INSERT INTO products(id,product_code,sku,barcode,name,name_th,name_en,category_id,category_name,price,cost,unit,stock_quantity,minimum_stock,quantity_scale,image_path,active,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CURRENT_TIMESTAMP)", [product.id,product.productCode,product.productCode,barcode,product.nameTh,product.nameTh,product.nameEn || null,product.categoryId,product.categoryName,money(product.price),money(product.cost),product.unit,qty(product.stockQuantity),qty(product.minimumStock),product.quantityScale,product.imagePath || null,product.active?1:0]);
    await this.audit("PRODUCT_CREATED", staff, { entityType:"product", entityId:product.id, details:JSON.stringify({productCode,barcode}) });
    return product;
  }

  async updateProduct(input:Product, staff:Staff) {
    const before=(await this.listProducts()).find(p=>p.id===input.id);
    const productCode=input.productCode.trim();
    const barcode=cleanBarcode(input.barcode) || null;
    const db=await this.conn();
    const codeOwner=await this.findProductByCode(productCode); if(codeOwner && codeOwner.id!==input.id) throw new Error("PRODUCT_CODE_EXISTS");
    const barcodeOwner=barcode ? await this.findProductByBarcode(barcode) : null; if(barcodeOwner && barcodeOwner.id!==input.id) throw new Error("BARCODE_EXISTS");
    const clean={...input,productCode,sku:productCode,barcode:barcode || undefined,nameTh:input.nameTh.trim(),name:input.nameTh.trim(),nameEn:input.nameEn?.trim() || undefined,quantityScale:input.quantityScale || 1};
    await db.execute("UPDATE products SET product_code=$2,sku=$3,barcode=$4,name=$5,name_th=$6,name_en=$7,category_id=$8,category_name=$9,price=$10,cost=$11,unit=$12,stock_quantity=$13,minimum_stock=$14,quantity_scale=$15,image_path=$16,active=$17,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [clean.id,clean.productCode,clean.productCode,barcode,clean.nameTh,clean.nameTh,clean.nameEn || null,clean.categoryId,clean.categoryName,money(clean.price),money(clean.cost),clean.unit,qty(clean.stockQuantity),qty(clean.minimumStock),clean.quantityScale,clean.imagePath || null,clean.active?1:0]);
    if(before && before.price !== clean.price) await this.audit("PRICE_CHANGED", staff, { entityType:"product", entityId:clean.id, details:JSON.stringify({from:before.price,to:clean.price}) });
    await this.audit("PRODUCT_UPDATED", staff, { entityType:"product", entityId:clean.id });
    return clean;
  }

  async saveProductImage(file: File) { const bytes = Array.from(new Uint8Array(await file.arrayBuffer())); return invoke<string>("save_product_image", { fileName:file.name, bytes }); }

  async getActiveShift() { const db=await this.conn(); const rows=await db.select<DbShift[]>("SELECT id,opened_at,opening_cash,status FROM shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1"); const r=rows[0]; return r ? { id:r.id, openedAt:r.opened_at, openingCash:Number(r.opening_cash), status:r.status } : null; }
  async openShift(openingCash:number, staff?:Staff, deviceId?:string) { const db=await this.conn(); const existing=await this.getActiveShift(); if(existing) return existing; const s:Shift={id:crypto.randomUUID(),openedAt:new Date().toISOString(),openingCash:money(openingCash),status:"open"}; await db.execute("INSERT INTO shifts(id,opened_at,opening_cash,status) VALUES($1,$2,$3,'open')", [s.id,s.openedAt,s.openingCash]); await this.audit("SHIFT_OPEN", staff, { entityType:"shift", entityId:s.id, shiftId:s.id, deviceId }); return s; }
  async closeShift(staff?:Staff, deviceId?:string) { const shift=await this.getActiveShift(); const db=await this.conn(); await db.execute("UPDATE shifts SET status='closed',closed_at=$1 WHERE status='open'", [new Date().toISOString()]); await this.audit("SHIFT_CLOSE", staff, { entityType:"shift", entityId:shift?.id, shiftId:shift?.id, deviceId }); }

  async checkout(input:CheckoutInput) {
    const db=await this.conn();
    const total=money(input.items.reduce((s,i)=>s+qty(i.quantity)*money(i.unitPrice),0));
    if(!input.items.length) throw new Error("EMPTY_CART");
    if(input.paymentMethod==="cash" && money(input.paid)<total) throw new Error("INSUFFICIENT_CASH");
    const paid=money(input.paymentMethod==="cash"?input.paid:total);
    const sale:Sale={id:crypto.randomUUID(),receiptNo:`R${Date.now().toString().slice(-8)}`,total,paid,changeAmount:money(Math.max(0,paid-total)),paymentMethod:input.paymentMethod,createdAt:new Date().toISOString(),status:"completed",cashierName:input.staff.displayName,employeeCode:input.staff.code,shiftId:input.shift.id};
    await db.execute("INSERT INTO sales(id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,employee_id,employee_code,cashier_name,shift_id,device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,$11,$12,$13)", [sale.id,sale.receiptNo,total,paid,sale.changeAmount,input.paymentMethod,JSON.stringify(input.items.map(i=>({...i,quantity:qty(i.quantity),unitPrice:money(i.unitPrice)}))),sale.createdAt,input.staff.id,input.staff.code,input.staff.displayName,input.shift.id,input.deviceId]);
    return sale;
  }

  async cancelBill(input:CancelBillInput) { const db=await this.conn(); const id=crypto.randomUUID(); await db.execute("INSERT INTO sale_cancellations(id,created_at,employee_id,employee_code,role,shift_id,device_id,reason,items_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id,new Date().toISOString(),input.staff.id,input.staff.code,input.staff.role,input.shift?.id ?? null,input.deviceId,input.reason,JSON.stringify(input.items)]); await this.audit("SALE_CANCELLED", input.staff, { entityType:"cart", entityId:id, shiftId:input.shift?.id, deviceId:input.deviceId, reason:input.reason, status:"cancelled", details:JSON.stringify(input.items) }); }
  async recordCartItemRemoved(product:Product, quantity:number, staff:Staff, shift?:Shift, deviceId?:string) { await this.audit("CART_ITEM_REMOVED", staff, { entityType:"product", entityId:product.id, shiftId:shift?.id, deviceId, details:JSON.stringify({productCode:product.productCode,quantity}) }); }

  async voidSale(input: VoidSaleInput) {
    const authorizer = await this.verifyPin(input.pin);
    if(!authorizer || !["owner","manager"].includes(authorizer.role)) throw new Error("AUTHORIZED_PIN_REQUIRED");
    const sale = await this.getSale(input.saleId);
    if(!sale) throw new Error("SALE_NOT_FOUND");
    if(sale.status !== "completed") throw new Error("SALE_ALREADY_CANCELLED");
    const db=await this.conn();
    await db.execute("UPDATE sales SET status='cancelled', cancelled_at=$2, cancelled_by=$3, cancelled_reason=$4, void_restock=$5 WHERE id=$1 AND status='completed'", [input.saleId,new Date().toISOString(),authorizer.id,input.reason,input.restock?1:0]);
    const updated = await this.getSale(input.saleId);
    if(!updated || updated.status !== "cancelled") throw new Error("VOID_FAILED");
    return updated;
  }

  async listSales(limit=50, filters:SaleFilters={}) {
    const db=await this.conn(); const where:string[]=[]; const params:unknown[]=[];
    const add=(sql:string,value:unknown)=>{ params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
    if(filters.todayOnly){ const [a,b]=todayRange(new Date().toISOString().slice(0,10)); add("created_at >= ?",a); add("created_at <= ?",b); }
    if(filters.date){ const [a,b]=todayRange(filters.date); add("created_at >= ?",a); add("created_at <= ?",b); }
    if(filters.paymentMethod && filters.paymentMethod!=="all") add("payment_method = ?",filters.paymentMethod);
    if(filters.status && filters.status!=="all") add("status = ?",filters.status);
    if(filters.receipt) add("receipt_no LIKE ?",`%${filters.receipt}%`);
    params.push(limit);
    const sql=`SELECT id,receipt_no,total,paid,change_amount,payment_method,created_at,status,cashier_name,employee_code,shift_id,cancelled_at,cancelled_reason FROM sales ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY created_at DESC LIMIT $${params.length}`;
    const rows=await db.select<DbSale[]>(sql, params); return rows.map(r=>this.sale(r));
  }
  async getSale(id:string) { const db=await this.conn(); const rows=await db.select<DbSale[]>("SELECT id,receipt_no,total,paid,change_amount,payment_method,created_at,status,cashier_name,employee_code,shift_id,cancelled_at,cancelled_reason FROM sales WHERE id=$1 LIMIT 1", [id]); return rows[0] ? this.sale(rows[0]) : null; }
  async getReceipt(id:string) { const sale=await this.getSale(id); if(!sale) return null; const db=await this.conn(); const items=await db.select<DbSaleItem[]>("SELECT id,sale_id,product_id,name,quantity,unit_price,line_total FROM sale_items WHERE sale_id=$1", [id]); const receipts=await db.select<Array<{receipt_label:string}>>("SELECT receipt_label FROM receipts WHERE sale_id=$1 LIMIT 1", [id]); return {...sale, items:items.map(i=>({id:i.id,saleId:i.sale_id,productId:i.product_id || undefined,name:i.name,quantity:Number(i.quantity),unitPrice:Number(i.unit_price),lineTotal:Number(i.line_total)})), settings:await this.getSettings(), receiptLabel:receipts[0]?.receipt_label}; }
  async getSalesSummary(date:string) { const db=await this.conn(); const [a,b]=todayRange(date); const rows=await db.select<Array<{payment_method:PaymentMethod; total:number; receipt_no:string; cashier_name?:string|null; hour:string}>>("SELECT payment_method,total,receipt_no,cashier_name,strftime('%H',created_at) as hour FROM sales WHERE created_at >= $1 AND created_at <= $2 AND status='completed'", [a,b]); const cancelled=await db.select<Array<{total:number}>>("SELECT total FROM sales WHERE created_at >= $1 AND created_at <= $2 AND status='cancelled'", [a,b]); const items=await db.select<Array<{label:string; quantity:number; total:number}>>("SELECT name as label, SUM(quantity) as quantity, SUM(line_total) as total FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE created_at >= $1 AND created_at <= $2 AND status='completed') GROUP BY name ORDER BY total DESC LIMIT 10", [a,b]); const byEmployee=new Map<string,{label:string;total:number;count:number}>(); const hourly=new Map<string,{hour:string;total:number;count:number}>(); let totalSales=0; for(const r of rows){ totalSales+=Number(r.total); const e=r.cashier_name || "-"; const agg=byEmployee.get(e)||{label:e,total:0,count:0}; agg.total+=Number(r.total); agg.count+=1; byEmployee.set(e,agg); const h=hourly.get(r.hour)||{hour:r.hour,total:0,count:0}; h.total+=Number(r.total); h.count+=1; hourly.set(r.hour,h); } return {date,totalSales:money(totalSales),billCount:rows.length,cashTotal:money(rows.filter(r=>r.payment_method==="cash").reduce((s,r)=>s+Number(r.total),0)),transferTotal:money(rows.filter(r=>r.payment_method==="transfer").reduce((s,r)=>s+Number(r.total),0)),averageBill:rows.length?money(totalSales/rows.length):0,cancelledCount:cancelled.length,cancelledValue:money(cancelled.reduce((s,r)=>s+Number(r.total),0)),byEmployee:[...byEmployee.values()].map(x=>({...x,total:money(x.total)})),byProduct:items.map(i=>({label:i.label,quantity:Number(i.quantity),total:money(Number(i.total))})),hourly:[...hourly.values()].map(x=>({...x,total:money(x.total)}))}; }
  async listAuditEvents(limit=100) { const db=await this.conn(); const rows=await db.select<DbAudit[]>("SELECT id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,shift_id,device_id,reason,status,details_json FROM audit_events ORDER BY timestamp DESC LIMIT $1", [limit]); return rows.map(r=>({id:r.id,timestamp:r.timestamp,employeeId:r.employee_id||undefined,employeeCode:r.employee_code||undefined,role:r.role||undefined,action:r.action,entityType:r.entity_type||undefined,entityId:r.entity_id||undefined,shiftId:r.shift_id||undefined,deviceId:r.device_id||undefined,reason:r.reason||undefined,status:r.status||undefined,details:r.details_json||undefined})); }
  async listStockMovements(limit=100) { const db=await this.conn(); const rows=await db.select<DbStock[]>("SELECT id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at FROM stock_movement_ledger ORDER BY created_at DESC LIMIT $1", [limit]); return rows.map(r=>({id:r.id,productId:r.product_id,sku:r.sku,name:r.name,movementType:stockType(r.movement_type),quantity:Number(r.quantity),beforeQuantity:Number(r.before_quantity),afterQuantity:Number(r.after_quantity),unitCost:Number(r.unit_cost),reason:r.reason||undefined,employeeId:r.employee_id||undefined,shiftId:r.shift_id||undefined,createdAt:r.created_at})); }
  async applyStockMovement(input:StockInput) { const db=await this.conn(); const p=(await this.listProducts()).find(x=>x.id===input.productId); if(!p) throw new Error("PRODUCT_NOT_FOUND"); const amount=qty(input.quantity); const before=p.stockQuantity; const after=input.movementType==="STOCK_IN"?qty(before+amount):input.movementType==="STOCK_OUT"?qty(before-amount):amount; const movement:StockMovement={id:crypto.randomUUID(),productId:p.id,sku:p.productCode,name:p.nameTh,movementType:input.movementType,quantity:amount,beforeQuantity:before,afterQuantity:after,unitCost:p.cost,reason:input.reason,employeeId:input.staff.id,shiftId:input.shiftId,createdAt:new Date().toISOString()}; await db.execute("INSERT INTO stock_movement_ledger(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [movement.id,movement.productId,movement.sku,movement.name,movement.movementType,movement.quantity,movement.beforeQuantity,movement.afterQuantity,movement.unitCost,movement.reason || null,movement.employeeId || null,movement.shiftId || null,movement.createdAt]); await db.execute("UPDATE products SET stock_quantity=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [p.id,after]); await this.audit(input.movementType, input.staff, {entityType:"product",entityId:p.id,shiftId:input.shiftId,reason:input.reason,details:JSON.stringify({before,after})}); return movement; }
  async listEmployees() { const db=await this.conn(); const rows=await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff ORDER BY active DESC, code"); return rows.map(r=>this.staff(r)); }
  async saveEmployee(input:EmployeeInput, staff:Staff) { if(!["owner","manager"].includes(staff.role)) throw new Error("EMPLOYEE_PERMISSION_DENIED"); const db=await this.conn(); const id=input.id || crypto.randomUUID(); const code=input.code.trim().toUpperCase(); const displayName=input.displayName.trim(); if(!code || code.length>4) throw new Error("EMPLOYEE_CODE_TOO_LONG"); if(input.demoPin && !/^\d{4}$/.test(input.demoPin.trim())) throw new Error("EMPLOYEE_PIN_INVALID"); const existing=await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE lower(code)=lower($1) AND id<>$2 LIMIT 1", [code,id]); if(existing[0]) throw new Error("EMPLOYEE_CODE_EXISTS"); await db.execute("INSERT INTO staff(id,code,display_name,role,pin_demo,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET code=excluded.code,display_name=excluded.display_name,role=excluded.role,pin_demo=COALESCE(excluded.pin_demo,pin_demo),active=excluded.active", [id,code,displayName,input.role,input.demoPin?.trim() || null,input.active?1:0]); await this.audit(input.id?"EMPLOYEE_UPDATED":"EMPLOYEE_CREATED", staff, {entityType:"employee",entityId:id}); const rows=await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE id=$1", [id]); return this.staff(rows[0]); }
  async deleteEmployee(id:string, staff:Staff) { if(!["owner","manager"].includes(staff.role)) throw new Error("EMPLOYEE_PERMISSION_DENIED"); if(id===staff.id) throw new Error("EMPLOYEE_SELF_DELETE"); const db=await this.conn(); const rows=await db.select<DbStaff[]>("SELECT id,code,display_name,role,active FROM staff WHERE id=$1 LIMIT 1", [id]); if(!rows[0]) throw new Error("EMPLOYEE_NOT_FOUND"); await db.execute("UPDATE staff SET active=0 WHERE id=$1", [id]); await this.audit("EMPLOYEE_DELETED", staff, {entityType:"employee",entityId:id,status:"inactive"}); }
  async getSettings() { const db=await this.conn(); await this.ensureSettings(db); const rows=await db.select<Array<{key:string;value:string}>>("SELECT key,value FROM app_settings"); return this.rowsToSettings(rows); }
  async updateSettings(settings:AppSettings, staff:Staff) { const db=await this.conn(); for(const [key,value] of Object.entries(this.settingsToRows(settings))) await db.execute("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP", [key,value]); await this.audit("SETTINGS_CHANGED", staff, {entityType:"settings",entityId:"local",details:JSON.stringify({language:settings.language,printerName:settings.printerName,programLicenseStatus:settings.programLicenseStatus})}); return settings; }
  async getStorageHealth() { const db=await this.conn(); const metrics=await invoke<Omit<StorageHealth,"salesCount"|"auditCount"|"oldestSale"|"newestSale">>("get_local_storage_metrics"); const sales=await db.select<Array<{count:number;oldest?:string|null;newest?:string|null}>>("SELECT COUNT(*) as count, MIN(created_at) as oldest, MAX(created_at) as newest FROM sales"); const audit=await db.select<Array<{count:number}>>("SELECT COUNT(*) as count FROM audit_events"); return {...metrics,salesCount:Number(sales[0]?.count || 0),auditCount:Number(audit[0]?.count || 0),oldestSale:sales[0]?.oldest || undefined,newestSale:sales[0]?.newest || undefined}; }
  async getAppVersion() { return "0.1.0"; }
}
