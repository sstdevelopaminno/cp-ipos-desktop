import { useMemo, useState } from "react";
import type { CartLine, Product, Shift, Staff } from "../domain/types";
import type { PosRepository } from "../data/repository";
import { PosShell } from "../components/pos-ui/PosShell";
import { PosCategoryNav } from "../components/pos-ui/PosCategoryNav";
import { PosProductGrid } from "../components/pos-ui/PosProductGrid";
import { PosProductCard } from "../components/pos-ui/PosProductCard";
import { PosCartPanel } from "../components/pos-ui/PosCartPanel";

export function PosScreen({repo,staff,shift,products,onCloseShift}:{repo:PosRepository;staff:Staff;shift:Shift;products:Product[];onCloseShift:()=>void}){
 const cats=useMemo(()=>[{id:"all",label:"ทั้งหมด"},...Array.from(new Map(products.map(p=>[p.categoryId,{id:p.categoryId,label:p.categoryName}])).values())],[products]);
 const [cat,setCat]=useState("all"); const [cart,setCart]=useState<CartLine[]>([]); const [paid,setPaid]=useState(""); const [notice,setNotice]=useState("");
 const shown=cat==="all"?products:products.filter(p=>p.categoryId===cat); const count=cart.reduce((s,l)=>s+l.quantity,0); const total=cart.reduce((s,l)=>s+l.price*l.quantity,0);
 const add=(p:Product)=>setCart(c=>{const x=c.find(l=>l.id===p.id);return x?c.map(l=>l.id===p.id?{...l,quantity:l.quantity+1}:l):[...c,{...p,quantity:1}]});
 const change=(id:string,d:number)=>setCart(c=>c.map(l=>l.id===id?{...l,quantity:l.quantity+d}:l).filter(l=>l.quantity>0));
 const checkout=async(method:"cash"|"promptpay"|"card")=>{try{const receive=method==="cash"?Number(paid||total):total;const sale=await repo.checkout({items:cart.map(l=>({productId:l.id,name:l.name,quantity:l.quantity,unitPrice:l.price})),paymentMethod:method,paid:receive});setNotice(`ชำระสำเร็จ ${sale.receiptNo} • เงินทอน ฿${sale.changeAmount.toFixed(2)}`);setCart([]);setPaid("");}catch(e){setNotice(e instanceof Error?e.message:"ชำระเงินไม่สำเร็จ")}};
 return <PosShell topBar={<div className="topbar-inner"><div><strong>CpIPOS</strong><span> Desktop • Offline</span></div><div className="topbar-meta"><span>กะ {shift.id.slice(0,6)}</span><span>{staff.displayName}</span><button onClick={onCloseShift}>ปิดกะ</button></div></div>} categoryNav={<PosCategoryNav items={cats} activeId={cat} onSelect={setCat}/>} productGrid={<PosProductGrid>{shown.map(p=><PosProductCard key={p.id} title={p.name} price={p.price} subtitle={p.sku} onAdd={()=>add(p)}/>)}</PosProductGrid>} cartPanel={<PosCartPanel title="รายการขาย" itemCount={count} onClear={cart.length?()=>setCart([]):undefined}><div className="cart-lines">{!cart.length?<p className="cart-empty">แตะสินค้าเพื่อเพิ่มรายการ</p>:cart.map(l=><div className="cart-line" key={l.id}><div><strong>{l.name}</strong><small>฿{l.price} × {l.quantity}</small></div><div className="qty"><button onClick={()=>change(l.id,-1)}>−</button><b>{l.quantity}</b><button onClick={()=>change(l.id,1)}>+</button></div><strong>฿{l.price*l.quantity}</strong></div>)}</div><div className="checkout"><div className="total"><span>ยอดสุทธิ</span><strong>฿{total.toFixed(2)}</strong></div><label>รับเงินสด<input value={paid} onChange={e=>setPaid(e.target.value)} inputMode="decimal" placeholder={String(total)}/></label><div className="pay-buttons"><button disabled={!cart.length} onClick={()=>checkout("cash")}>เงินสด</button><button disabled={!cart.length} onClick={()=>checkout("promptpay")}>พร้อมเพย์</button><button disabled={!cart.length} onClick={()=>checkout("card")}>บัตร/อื่นๆ</button></div>{notice&&<p className="notice">{notice}</p>}</div></PosCartPanel>} />
}
