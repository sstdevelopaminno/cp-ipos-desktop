import type { Product } from "../domain/types";
export const DEMO_PRODUCTS: Product[] = [
  { id:"p1", sku:"FOOD-001", barcode:"8850000000011", name:"กะเพราหมูสับ", categoryId:"food", categoryName:"อาหารตามสั่ง", price:60, cost:30, unit:"จาน", stockQuantity:80, minimumStock:10, active:true },
  { id:"p2", sku:"FOOD-002", barcode:"8850000000028", name:"กะเพราไก่", categoryId:"food", categoryName:"อาหารตามสั่ง", price:60, cost:30, unit:"จาน", stockQuantity:80, minimumStock:10, active:true },
  { id:"p3", sku:"FOOD-003", barcode:"8850000000035", name:"ข้าวผัดหมู", categoryId:"food", categoryName:"อาหารตามสั่ง", price:65, cost:32, unit:"จาน", stockQuantity:80, minimumStock:10, active:true },
  { id:"p4", sku:"NOODLE-001", barcode:"8850000000042", name:"ก๋วยเตี๋ยวน้ำใส", categoryId:"noodle", categoryName:"ก๋วยเตี๋ยว", price:55, cost:25, unit:"ชาม", stockQuantity:80, minimumStock:10, active:true },
  { id:"p5", sku:"NOODLE-002", barcode:"8850000000059", name:"ก๋วยเตี๋ยวต้มยำ", categoryId:"noodle", categoryName:"ก๋วยเตี๋ยว", price:60, cost:28, unit:"ชาม", stockQuantity:80, minimumStock:10, active:true },
  { id:"p6", sku:"COFFEE-001", barcode:"8850000000066", name:"อเมริกาโน่", categoryId:"coffee", categoryName:"กาแฟ", price:55, cost:18, unit:"แก้ว", stockQuantity:100, minimumStock:15, active:true },
  { id:"p7", sku:"COFFEE-002", barcode:"8850000000073", name:"ลาเต้", categoryId:"coffee", categoryName:"กาแฟ", price:65, cost:22, unit:"แก้ว", stockQuantity:100, minimumStock:15, active:true },
  { id:"p8", sku:"DRINK-001", barcode:"8850000000080", name:"ชาไทย", categoryId:"drink", categoryName:"เครื่องดื่ม", price:55, cost:18, unit:"แก้ว", stockQuantity:100, minimumStock:15, active:true },
  { id:"p9", sku:"DRINK-002", barcode:"8850000000097", name:"น้ำเปล่า", categoryId:"drink", categoryName:"เครื่องดื่ม", price:15, cost:7, unit:"ขวด", stockQuantity:120, minimumStock:24, active:true }
];