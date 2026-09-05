import type { Product } from "../domain/types";
export const DEMO_PRODUCTS: Product[] = [
  { id:"p1", sku:"FOOD-001", name:"กะเพราหมูสับ", categoryId:"food", categoryName:"อาหารตามสั่ง", price:60, active:true },
  { id:"p2", sku:"FOOD-002", name:"กะเพราไก่", categoryId:"food", categoryName:"อาหารตามสั่ง", price:60, active:true },
  { id:"p3", sku:"FOOD-003", name:"ข้าวผัดหมู", categoryId:"food", categoryName:"อาหารตามสั่ง", price:65, active:true },
  { id:"p4", sku:"NOODLE-001", name:"ก๋วยเตี๋ยวน้ำใส", categoryId:"noodle", categoryName:"ก๋วยเตี๋ยว", price:55, active:true },
  { id:"p5", sku:"NOODLE-002", name:"ก๋วยเตี๋ยวต้มยำ", categoryId:"noodle", categoryName:"ก๋วยเตี๋ยว", price:60, active:true },
  { id:"p6", sku:"COFFEE-001", name:"อเมริกาโน่", categoryId:"coffee", categoryName:"กาแฟ", price:55, active:true },
  { id:"p7", sku:"COFFEE-002", name:"ลาเต้", categoryId:"coffee", categoryName:"กาแฟ", price:65, active:true },
  { id:"p8", sku:"DRINK-001", name:"ชาไทย", categoryId:"drink", categoryName:"เครื่องดื่ม", price:55, active:true },
  { id:"p9", sku:"DRINK-002", name:"น้ำเปล่า", categoryId:"drink", categoryName:"เครื่องดื่ม", price:15, active:true }
];
