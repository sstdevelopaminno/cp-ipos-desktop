import { useState } from "react";
import type { Staff } from "../domain/types";
import type { PosRepository } from "../data/repository";
export function LoginScreen({repo,onLogin}:{repo:PosRepository;onLogin:(s:Staff)=>void}){
 const [pin,setPin]=useState(""); const [error,setError]=useState("");
 const press=(n:string)=>{ if(pin.length<6){setPin(v=>v+n);setError("");}};
 const submit=async()=>{const s=await repo.verifyPin(pin); if(s) onLogin(s); else {setError("PIN ไม่ถูกต้อง");setPin("");}};
 return <main className="center-screen"><section className="login-card"><div className="brand-mark">C</div><h1>CpIPOS Desktop</h1><p>เข้าสู่ระบบพนักงาน • Offline</p><div className="pin-dots">{Array.from({length:4},(_,i)=><span key={i} className={i<pin.length?"filled":""}/>)}</div><div className="keypad">{[1,2,3,4,5,6,7,8,9].map(n=><button key={n} onClick={()=>press(String(n))}>{n}</button>)}<button onClick={()=>setPin("")}>ล้าง</button><button onClick={()=>press("0")}>0</button><button className="primary" onClick={submit}>เข้า</button></div>{error&&<p className="error">{error}</p>}<small>Demo PIN: 1234</small></section></main>
}
