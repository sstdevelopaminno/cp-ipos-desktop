import type { AppSettings, AuditEvent, DiscountType, PaymentMethod, Product, Receipt, Sale, SalesSummary, Shift, Staff, StockMovement, StockMovementType, StorageHealth } from "../domain/types";

export type CheckoutItemInput = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  originalUnitPrice?: number;
  discountType?: DiscountType | "none";
  discountValue?: number;
};

export type CheckoutInput = {
  items: CheckoutItemInput[];
  paymentMethod: PaymentMethod;
  paid: number;
  staff: Staff;
  shift: Shift;
  deviceId: string;
  subtotal?: number;
  discountAmount?: number;
  discountType?: DiscountType;
  discountValue?: number;
};

export type SaleFilters = { todayOnly?: boolean; date?: string; paymentMethod?: PaymentMethod | "all"; receipt?: string; status?: "completed" | "cancelled" | "all" };
export type ProductInput = Omit<Product, "id" | "active" | "sku" | "name"> & { id?: string; sku?: string; name?: string; active?: boolean };
export type EmployeeInput = { id?: string; code: string; displayName: string; role: Staff["role"]; active: boolean; demoPin?: string; permissions?: string[] };
export type StockInput = { productId: string; movementType: Exclude<StockMovementType, "SALE" | "SALE_VOID_RETURN">; quantity: number; reason: string; staff: Staff; shiftId?: string };
export type CancelBillInput = { items: { productId: string; name: string; quantity: number; unitPrice: number }[]; reason: string; staff: Staff; shift?: Shift; deviceId: string };
export type VoidSaleInput = { saleId: string; pin: string; reason: string; restock: boolean; staff: Staff; shift?: Shift; deviceId: string };

export interface PosRepository {
  initialize(): Promise<void>;
  verifyPin(pin: string): Promise<Staff | null>;
  getSavedSession(): Promise<Staff | null>;
  saveSession(staff: Staff): Promise<void>;
  clearSession(staff?: Staff, shift?: Shift, deviceId?: string): Promise<void>;
  listProducts(): Promise<Product[]>;
  findProductByBarcode(barcode: string): Promise<Product | null>;
  findProductByCode(productCode: string): Promise<Product | null>;
  createProduct(input: ProductInput, staff: Staff): Promise<Product>;
  updateProduct(input: Product, staff: Staff): Promise<Product>;
  saveProductImage(file: File): Promise<string>;
  getActiveShift(): Promise<Shift | null>;
  openShift(openingCash: number, staff?: Staff, deviceId?: string): Promise<Shift>;
  closeShift(staff?: Staff, deviceId?: string): Promise<void>;
  checkout(input: CheckoutInput): Promise<Sale>;
  cancelBill(input: CancelBillInput): Promise<void>;
  voidSale(input: VoidSaleInput): Promise<Sale>;
  listSales(limit?: number, filters?: SaleFilters): Promise<Sale[]>;
  getSale(id: string): Promise<Sale | null>;
  getReceipt(id: string): Promise<Receipt | null>;
  getSalesSummary(date: string): Promise<SalesSummary>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
  listStockMovements(limit?: number): Promise<StockMovement[]>;
  recordCartItemRemoved(product: Product, quantity: number, staff: Staff, shift?: Shift, deviceId?: string): Promise<void>;
  applyStockMovement(input: StockInput): Promise<StockMovement>;
  listEmployees(): Promise<Staff[]>;
  saveEmployee(input: EmployeeInput, staff: Staff): Promise<Staff>;
  deleteEmployee(id: string, staff: Staff): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings, staff: Staff): Promise<AppSettings>;
  getStorageHealth(): Promise<StorageHealth>;
  getAppVersion(): Promise<string>;
}