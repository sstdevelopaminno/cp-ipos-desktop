import type { AuditEvent, AppSettings, Product, Receipt, Sale, SalesSummary, Shift, Staff, StockMovement, StorageHealth } from "../domain/types";
import type { CancelBillInput, CheckoutInput, EmployeeInput, PosRepository, ProductInput, SaleFilters, StockInput, VoidSaleInput } from "./repository";
import { createPinCredential, verifyPinCredential, type PinCredential } from "./pinCredential";
import { DEMO_PRODUCTS } from "./seed";

const K = { shift:"cpipos.desktop.demo.shift", sales:"cpipos.desktop.demo.sales", items:"cpipos.desktop.demo.items", products:"cpipos.desktop.demo.products", staff:"cpipos.desktop.demo.staff", settings:"cpipos.desktop.demo.settings", audit:"cpipos.desktop.demo.audit", stock:"cpipos.desktop.demo.stock", session:"cpipos.desktop.demo.session" };
type StoredStaff = Staff & { demoPin?: string; pinHash?: string; pinSalt?: string; pinHashAlgorithm?: PinCredential["pinHashAlgorithm"]; pinHashIterations?: number };
const DEFAULT_STAFF: StoredStaff = { id:"staff-owner", code:"OWNR", displayName:"ผู้ดูแลร้าน", role:"owner", active:true, demoPin:"1234" };
const DEFAULT_SETTINGS: AppSettings = {
  storeName:"CpIPOS Store",
  branchName:"Main Branch",
  deviceName:"POS-01",
  deviceId:"browser-pos-01",
  receiptHeader:"CpIPOS",
  taxId:"",
  address:"",
  phone:"",
  receiptFooter:"ขอบคุณที่ใช้บริการ",
  storeLogoPath:"",
  ownerName:"Owner",
  ownerPinNote:"Demo-only owner PIN. Secure hashing is a later task.",
  printerType:"windows-print-dialog",
  printerName:"",
  printerPaperWidthMm:"80",
  printerConnectionNote:"เลือกเครื่องพิมพ์ 80mm ผ่าน Windows Print Dialog ในการพิมพ์ครั้งแรก",
  printerSetupConfirmed:false,
  printerAutoConnect:true,
  printerAutoPrintReceipt:true,
  printerConnectionStatus:"not_checked",
  printerLastCheckedAt:"",
  cashDrawerEnabled:true,
  scannerMode:"keyboard-wedge",
  remoteManagementEnabled:false,
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
  language:"th"
};
const read = <T,>(key:string, fallback:T):T => {
  const v=localStorage.getItem(key);
  if(!v) return fallback;
  const parsed = JSON.parse(v) as T;
  const canMerge = fallback && typeof fallback === "object" && !Array.isArray(fallback) && parsed && typeof parsed === "object" && !Array.isArray(parsed);
  return canMerge ? { ...(fallback as Record<string, unknown>), ...(parsed as Record<string, unknown>) } as T : parsed;
};
const write = (key:string, value:unknown) => localStorage.setItem(key, JSON.stringify(value));
const money = (n:number) => Math.round((Number(n)||0)*100)/100;
const qty = (n:number) => Math.round((Number(n)||0)*1000)/1000;
const cleanBarcode = (v?:string) => (v || "").trim().replace(/\s+/g, "");

export class BrowserRepository implements PosRepository {
  async initialize() {
    if(!localStorage.getItem(K.products)) write(K.products, DEMO_PRODUCTS);
    const employees=read<StoredStaff[]>(K.staff,[DEFAULT_STAFF]);
    const normalized=employees.map(e=>e.id==="staff-owner" && e.code.length>4 ? {...e,code:"OWNR",demoPin:e.demoPin || "1234"}:e);
    write(K.staff, await this.upgradeLegacyPins(normalized));
    if(!localStorage.getItem(K.settings)) write(K.settings, DEFAULT_SETTINGS);
  }
  async verifyPin(pin:string, code?:string) { const employees=read<StoredStaff[]>(K.staff,[DEFAULT_STAFF]); const wanted=code?.trim().toLowerCase(); for(const employee of employees){ if(employee.active===false || (wanted && employee.code.toLowerCase()!==wanted)) continue; if(await verifyPinCredential(pin, employee)) return employee; if(employee.demoPin && employee.demoPin===pin){ const credential=await createPinCredential(employee.demoPin); const upgraded={...employee,...credential,demoPin:undefined}; write(K.staff, employees.map(e=>e.id===employee.id?upgraded:e)); return upgraded; } } return null; }
  async getSavedSession() { return read<Staff|null>(K.session, null); }
  async saveSession(staff:Staff) { write(K.session, staff); await this.audit("LOGIN", staff); }
  async clearSession(staff?:Staff) { localStorage.removeItem(K.session); await this.audit("LOGOUT", staff); }
  async listProducts() { return read<Product[]>(K.products, DEMO_PRODUCTS); }
  async findProductByBarcode(barcode:string) { const code=cleanBarcode(barcode); return (await this.listProducts()).find(p=>p.barcode===code) || null; }
  async findProductByCode(productCode:string) { const code=productCode.trim(); return (await this.listProducts()).find(p=>p.productCode===code || p.sku===code) || null; }
  async createProduct(input:ProductInput, staff:Staff) { const products=await this.listProducts(); const productCode=input.productCode.trim(); const barcode=cleanBarcode(input.barcode); if(products.some(x=>x.productCode===productCode)) throw new Error("PRODUCT_CODE_EXISTS"); if(barcode && products.some(x=>x.barcode===barcode)) throw new Error("BARCODE_EXISTS"); const p={...input,id:input.id || crypto.randomUUID(),productCode,sku:productCode,barcode:barcode || undefined,nameTh:input.nameTh.trim(),name:input.nameTh.trim(),nameEn:input.nameEn?.trim() || undefined,quantityScale:input.quantityScale || 1,active:input.active ?? true} as Product; write(K.products,[p,...products]); await this.audit("PRODUCT_CREATED", staff, {entityType:"product", entityId:p.id}); return p; }
  async updateProduct(input:Product, staff:Staff) { const products=await this.listProducts(); if(products.some(x=>x.id!==input.id && x.productCode===input.productCode)) throw new Error("PRODUCT_CODE_EXISTS"); if(input.barcode && products.some(x=>x.id!==input.id && x.barcode===input.barcode)) throw new Error("BARCODE_EXISTS"); const clean={...input,sku:input.productCode,name:input.nameTh}; write(K.products,products.map(p=>p.id===input.id?clean:p)); await this.audit("PRODUCT_UPDATED", staff, {entityType:"product", entityId:input.id}); return clean; }
  async saveProductImage(file:File) { return `media/products/${Date.now()}-${file.name}`; }
  async getActiveShift() { return read<Shift|null>(K.shift, null); }
  async openShift(openingCash:number, staff?:Staff) { const existing=await this.getActiveShift(); if(existing) return existing; const s:Shift={id:crypto.randomUUID(),openedAt:new Date().toISOString(),openingCash:money(openingCash),status:"open"}; write(K.shift,s); await this.audit("SHIFT_OPEN", staff, {entityType:"shift",entityId:s.id,shiftId:s.id}); return s; }
  async closeShift(staff?:Staff) { const s=await this.getActiveShift(); if(s) write(K.shift,{...s,status:"closed"}); await this.audit("SHIFT_CLOSE", staff, {entityType:"shift",entityId:s?.id,shiftId:s?.id}); }
  async checkout(input:CheckoutInput) { const total=money(input.items.reduce((s,i)=>s+qty(i.quantity)*money(i.unitPrice),0)); if(!input.items.length) throw new Error("EMPTY_CART"); if(input.paymentMethod==="cash" && money(input.paid)<total) throw new Error("INSUFFICIENT_CASH"); const paid=money(input.paymentMethod==="cash"?input.paid:total); const sale:Sale={id:crypto.randomUUID(),receiptNo:`R${Date.now().toString().slice(-8)}`,total,paid,changeAmount:money(Math.max(0,paid-total)),paymentMethod:input.paymentMethod,createdAt:new Date().toISOString(),status:"completed",cashierName:input.staff.displayName,employeeCode:input.staff.code,shiftId:input.shift.id}; const products=await this.listProducts(); write(K.products,products.map(p=>{ const line=input.items.find(i=>i.productId===p.id); return line?{...p,stockQuantity:qty(p.stockQuantity-line.quantity)}:p; })); write(K.sales,[sale,...await this.listSales(999)]); write(K.items,{...read<Record<string,unknown[]>>(K.items,{}),[sale.id]:input.items}); await this.audit("SALE_COMPLETED", input.staff, {entityType:"sale",entityId:sale.id,shiftId:input.shift.id,status:input.paymentMethod}); return sale; }
  async cancelBill(input:CancelBillInput) { await this.audit("SALE_CANCELLED", input.staff, {entityType:"cart",reason:input.reason,shiftId:input.shift?.id,status:"cancelled",details:JSON.stringify(input.items)}); }
  async voidSale(input:VoidSaleInput) { const auth=await this.verifyPin(input.pin); if(!auth || !["owner","manager"].includes(auth.role)) throw new Error("AUTHORIZED_PIN_REQUIRED"); const sales=await this.listSales(999); const sale=sales.find(s=>s.id===input.saleId); if(!sale) throw new Error("SALE_NOT_FOUND"); if(sale.status!=="completed") throw new Error("SALE_ALREADY_CANCELLED"); const updated={...sale,status:"cancelled" as const,cancelledAt:new Date().toISOString(),cancelledReason:input.reason}; write(K.sales,sales.map(s=>s.id===input.saleId?updated:s)); if(input.restock){ const items=read<Record<string,CheckoutInput["items"]>>(K.items,{})[input.saleId] || []; const products=await this.listProducts(); write(K.products,products.map(p=>{ const line=items.find(i=>i.productId===p.id); return line?{...p,stockQuantity:qty(p.stockQuantity+line.quantity)}:p; })); const stock=read<StockMovement[]>(K.stock,[]); for(const line of items){ const p=products.find(x=>x.id===line.productId); if(p) stock.unshift({id:crypto.randomUUID(),productId:p.id,sku:p.productCode,name:p.nameTh,movementType:"SALE_VOID_RETURN",quantity:line.quantity,beforeQuantity:p.stockQuantity,afterQuantity:qty(p.stockQuantity+line.quantity),unitCost:p.cost,reason:input.reason,employeeId:auth.id,shiftId:input.shift?.id,createdAt:new Date().toISOString()}); } write(K.stock,stock); } await this.audit("SALE_VOIDED", auth, {entityType:"sale",entityId:input.saleId,reason:input.reason,status:input.restock?"SALE_VOID_RETURN":"VOID_ONLY"}); return updated; }
  async listSales(limit=50, filters:SaleFilters={}) { let rows=read<Sale[]>(K.sales, []); if(filters.todayOnly){const d=new Date().toISOString().slice(0,10); rows=rows.filter(s=>s.createdAt.startsWith(d));} if(filters.date) rows=rows.filter(s=>s.createdAt.startsWith(filters.date!)); if(filters.paymentMethod && filters.paymentMethod!=="all") rows=rows.filter(s=>s.paymentMethod===filters.paymentMethod); if(filters.status && filters.status!=="all") rows=rows.filter(s=>s.status===filters.status); if(filters.receipt) rows=rows.filter(s=>s.receiptNo.includes(filters.receipt!)); return rows.slice(0,limit); }
  async getSale(id:string) { return (await this.listSales(999)).find(s=>s.id===id) || null; }
  async getReceipt(id:string):Promise<Receipt|null> { const sale=await this.getSale(id); if(!sale) return null; const items=(read<Record<string,CheckoutInput["items"]>>(K.items,{})[id] || []).map(i=>({...i,name:i.name,lineTotal:money(i.quantity*i.unitPrice)})); return {...sale,items,settings:await this.getSettings(),receiptLabel:sale.receiptNo}; }
  async getSalesSummary(date:string):Promise<SalesSummary> { const sales=await this.listSales(999,{date,status:"completed"}); const cancelled=await this.listSales(999,{date,status:"cancelled"}); const totalSales=money(sales.reduce((s,r)=>s+r.total,0)); return {date,totalSales,billCount:sales.length,cashTotal:money(sales.filter(s=>s.paymentMethod==="cash").reduce((a,b)=>a+b.total,0)),transferTotal:money(sales.filter(s=>s.paymentMethod==="transfer").reduce((a,b)=>a+b.total,0)),averageBill:sales.length?money(totalSales/sales.length):0,cancelledCount:cancelled.length,cancelledValue:money(cancelled.reduce((a,b)=>a+b.total,0)),byEmployee:[],byProduct:[],hourly:[]}; }
  async listAuditEvents(limit=100) { return read<AuditEvent[]>(K.audit, []).slice(0,limit); }
  async listStockMovements(limit=100) { return read<StockMovement[]>(K.stock, []).slice(0,limit); }
  async recordCartItemRemoved(product:Product, quantity:number, staff:Staff, shift?:Shift) { await this.audit("CART_ITEM_REMOVED", staff, {entityType:"product",entityId:product.id,shiftId:shift?.id,details:JSON.stringify({quantity})}); }
  async applyStockMovement(input:StockInput) { const products=await this.listProducts(); const p=products.find(x=>x.id===input.productId); if(!p) throw new Error("PRODUCT_NOT_FOUND"); const amount=qty(input.quantity); const before=p.stockQuantity; const after=input.movementType==="STOCK_IN"?qty(before+amount):input.movementType==="STOCK_OUT"?qty(before-amount):amount; const movement:StockMovement={id:crypto.randomUUID(),productId:p.id,sku:p.productCode,name:p.nameTh,movementType:input.movementType,quantity:amount,beforeQuantity:before,afterQuantity:after,unitCost:p.cost,reason:input.reason,employeeId:input.staff.id,shiftId:input.shiftId,createdAt:new Date().toISOString()}; write(K.products,products.map(x=>x.id===p.id?{...x,stockQuantity:after}:x)); write(K.stock,[movement,...read<StockMovement[]>(K.stock,[])]); await this.audit(input.movementType, input.staff, {entityType:"product",entityId:p.id,reason:input.reason}); return movement; }
  async listEmployees() { return read<Staff[]>(K.staff, [DEFAULT_STAFF]); }
  async saveEmployee(input:EmployeeInput, staff:Staff) { if(!["owner","manager"].includes(staff.role)) throw new Error("EMPLOYEE_PERMISSION_DENIED"); const id=input.id || crypto.randomUUID(); const code=input.code.trim().toUpperCase(); const displayName=input.displayName.trim(); const newPin=input.demoPin?.trim(); if(!code || code.length>4) throw new Error("EMPLOYEE_CODE_TOO_LONG"); if(!input.id && !newPin) throw new Error("EMPLOYEE_PIN_REQUIRED"); if(newPin && !/^\d{4}$/.test(newPin)) throw new Error("EMPLOYEE_PIN_INVALID"); const employees=read<StoredStaff[]>(K.staff,[DEFAULT_STAFF]); if(employees.some(e=>e.id!==id && e.code.toLowerCase()===code.toLowerCase())) throw new Error("EMPLOYEE_CODE_EXISTS"); const current=employees.find(e=>e.id===id); const credential=newPin ? await createPinCredential(newPin) : null; const emp:StoredStaff={id,code,displayName,role:input.role,active:input.active,...(credential || {pinHash:current?.pinHash,pinSalt:current?.pinSalt,pinHashAlgorithm:current?.pinHashAlgorithm,pinHashIterations:current?.pinHashIterations})}; const all=employees.filter(e=>e.id!==emp.id); write(K.staff,[emp,...all]); await this.audit(input.id?"EMPLOYEE_UPDATED":"EMPLOYEE_CREATED", staff, {entityType:"employee",entityId:emp.id}); return emp; }
  private async upgradeLegacyPins(employees:StoredStaff[]) { return Promise.all(employees.map(async employee => { if(!employee.demoPin || employee.pinHash) return employee; const credential=await createPinCredential(employee.demoPin); return {...employee,...credential,demoPin:undefined}; })); }
  async deleteEmployee(id:string, staff:Staff) { if(!["owner","manager"].includes(staff.role)) throw new Error("EMPLOYEE_PERMISSION_DENIED"); if(id===staff.id) throw new Error("EMPLOYEE_SELF_DELETE"); const employees=await this.listEmployees(); const target=employees.find(e=>e.id===id); if(!target) throw new Error("EMPLOYEE_NOT_FOUND"); write(K.staff, employees.map(e=>e.id===id?{...e,active:false}:e)); await this.audit("EMPLOYEE_DELETED", staff, {entityType:"employee",entityId:id,status:"inactive"}); }
  async getSettings() { return read<AppSettings>(K.settings, DEFAULT_SETTINGS); }
  async updateSettings(settings:AppSettings, staff:Staff) { write(K.settings, settings); await this.audit("SETTINGS_CHANGED", staff, {entityType:"settings",entityId:"local",details:JSON.stringify({language:settings.language,printerName:settings.printerName,programLicenseStatus:settings.programLicenseStatus})}); return settings; }
  async getStorageHealth():Promise<StorageHealth> { const sales=await this.listSales(999); const audit=await this.listAuditEvents(999); return {databaseSize:0,mediaSize:0,backupSize:0,appDataSize:0,salesCount:sales.length,auditCount:audit.length,oldestSale:sales.at(-1)?.createdAt,newestSale:sales[0]?.createdAt}; }
  async getAppVersion() { return "0.1.0"; }
  private async audit(action:string, staff?:Staff, data:Partial<AuditEvent>={}) { write(K.audit,[{id:crypto.randomUUID(),timestamp:new Date().toISOString(),employeeId:staff?.id,employeeCode:staff?.code,role:staff?.role,action,...data},...read<AuditEvent[]>(K.audit,[])]); }
}
