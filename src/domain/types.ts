export type Role = "owner" | "manager" | "staff";
export type PaymentMethod = "cash" | "transfer" | "promptpay" | "card";
export type SaleStatus = "completed" | "cancelled";
export type Language = "th" | "en";
export type StockMovementType = "STOCK_IN" | "SALE" | "STOCK_OUT" | "ADJUSTMENT" | "SALE_VOID_RETURN";
export type DiscountType = "amount" | "percent";

export type Product = {
  id: string;
  productCode: string;
  sku: string;
  barcode?: string;
  nameTh: string;
  nameEn?: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  cost: number;
  unit: string;
  stockQuantity: number;
  minimumStock: number;
  quantityScale: number;
  imagePath?: string;
  active: boolean;
};

export type CartLine = Product & { quantity: number };
export type Shift = { id: string; openedAt: string; openingCash: number; status: "open" | "closed" };
export type Staff = { id: string; code: string; displayName: string; role: Role; active?: boolean };

export type SaleItem = {
  id?: string;
  saleId?: string;
  productId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type Sale = {
  id: string;
  receiptNo: string;
  total: number;
  paid: number;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  status: SaleStatus;
  cashierName?: string;
  employeeCode?: string;
  shiftId?: string;
  cancelledAt?: string;
  cancelledReason?: string;
};

export type Receipt = Sale & {
  items: SaleItem[];
  settings: AppSettings;
  receiptLabel?: string;
  subtotal?: number;
  discountAmount?: number;
  discountType?: DiscountType;
  discountValue?: number;
};

export type AppSettings = {
  storeName: string;
  branchName: string;
  deviceName: string;
  deviceId: string;
  receiptHeader: string;
  taxId: string;
  address: string;
  phone: string;
  receiptFooter: string;
  ownerName: string;
  ownerPinNote: string;
  printerType: string;
  scannerMode: string;
  remoteManagementEnabled: boolean;
  language: Language;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  employeeId?: string;
  employeeCode?: string;
  role?: Role;
  action: string;
  entityType?: string;
  entityId?: string;
  shiftId?: string;
  deviceId?: string;
  reason?: string;
  status?: string;
  details?: string;
};

export type StockMovement = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  movementType: StockMovementType;
  quantity: number;
  beforeQuantity: number;
  afterQuantity: number;
  unitCost: number;
  reason?: string;
  employeeId?: string;
  shiftId?: string;
  createdAt: string;
};

export type SalesSummary = {
  date: string;
  totalSales: number;
  billCount: number;
  cashTotal: number;
  transferTotal: number;
  averageBill: number;
  cancelledCount: number;
  cancelledValue: number;
  byEmployee: { label: string; total: number; count: number }[];
  byProduct: { label: string; quantity: number; total: number }[];
  hourly: { hour: string; total: number; count: number }[];
};

export type StorageHealth = {
  databaseSize: number;
  mediaSize: number;
  backupSize: number;
  appDataSize: number;
  freeDisk?: number;
  salesCount: number;
  auditCount: number;
  oldestSale?: string;
  newestSale?: string;
};