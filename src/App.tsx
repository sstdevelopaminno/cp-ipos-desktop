import { useEffect, useState } from "react";
import { createRepository } from "./data";
import type { PosRepository } from "./data/repository";
import type { Product, Shift, Staff } from "./domain/types";
import { LoginScreen } from "./screens/LoginScreen";
import { ShiftScreen } from "./screens/ShiftScreen";
import { PosScreen } from "./screens/PosScreen";

export default function App(){
 const [repo,setRepo]=useState<PosRepository|null>(null); const [staff,setStaff]=useState<Staff|null>(null); const [shift,setShift]=useState<Shift|null>(null); const [products,setProducts]=useState<Product[]>([]); const [error,setError]=useState("");
 useEffect(()=>{(async()=>{try{const r=await createRepository();await r.initialize();setRepo(r);setProducts(await r.listProducts());setShift(await r.getActiveShift());}catch(e){setError(e instanceof Error?e.message:String(e));}})()},[]);
 if(error)return <main className="center-screen"><section className="error-card"><h1>เปิดฐานข้อมูลไม่สำเร็จ</h1><pre>{error}</pre></section></main>;
 if(!repo)return <main className="center-screen"><div className="loader">กำลังเริ่ม CpIPOS…</div></main>;
 if(!staff)return <LoginScreen repo={repo} onLogin={setStaff}/>;
 if(!shift)return <ShiftScreen repo={repo} staff={staff} onReady={setShift}/>;
 return <PosScreen repo={repo} staff={staff} shift={shift} products={products} onCloseShift={async()=>{await repo.closeShift();setShift(null)}}/>;
}
