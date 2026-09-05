export type Product = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  active: boolean;
};

export type CartLine = Product & { quantity: number };
export type Shift = { id: string; openedAt: string; openingCash: number; status: "open" | "closed" };
export type Sale = { id: string; receiptNo: string; total: number; paid: number; changeAmount: number; paymentMethod: "cash" | "promptpay" | "card"; createdAt: string };
export type Staff = { id: string; code: string; displayName: string; role: "owner" | "manager" | "staff" };
