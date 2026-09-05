# CpIPOS Desktop

Windows POS แบบ Offline-first ที่แยก repository ออกจาก CpIPOS Web โดยเด็ดขาด

สถานะ: development prototype **ยังไม่พร้อม production** ผลตรวจ Phase 0: [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md)

## V0.1 ที่ทำแล้ว
- React + TypeScript + Vite UI
- Tauri 2 Windows shell
- SQLite local database ผ่าน `@tauri-apps/plugin-sql`
- Login demo PIN, เปิด/ปิดกะ, POS catalog, cart, cash/PromptPay/card checkout
- transaction เก็บ `sales` + `sale_items` ในเครื่อง
- `sync_queue` เตรียม schema ไว้ แต่ยังไม่เปิด Cloud Sync
- Browser fallback สำหรับพัฒนา UI โดยไม่ต้องเปิด Tauri
- Extracted UI primitives จาก CpIPOS source โดยไม่ import API/Supabase/Vercel

**PromptPay และ Card ใน V0.1 เป็น PAYMENT METHOD RECORDING ONLY:** บันทึกวิธีชำระเงินเท่านั้น ไม่ตรวจสอบว่าได้รับเงินจริงจาก payment gateway ข้อความชำระสำเร็จหมายถึงบันทึกการขายในเครื่องสำเร็จ

## Run บน Windows
Prerequisites: Node.js 22.12+ (หรือ Node 24), npm, Rust stable MSVC, Microsoft C++ Build Tools (Desktop development with C++), Windows SDK และ WebView2 Runtime.

```powershell
npm install
npm run desktop:dev
```

หลังมี package-lock.json แล้ว ใช้ `npm ci` สำหรับติดตั้งตาม lockfile (GitHub Actions ใช้คำสั่งนี้)

Build installer:

```powershell
npm run desktop:build
```

ผลลัพธ์ installer จะอยู่ใต้ `src-tauri/target/release/bundle/` (NSIS/MSI)

## Demo
PIN เริ่มต้นสำหรับ development: `1234` เป็น PIN ชั่วคราว/demo-only และ **ไม่ใช่ secure authentication**

> ก่อน production ต้องเปลี่ยน `pin_demo` เป็น password/PIN hashing และเพิ่ม secure credential migration.

## Phase 1 completion gate
Phase 1 ยังไม่เสร็จจนกว่าจะครบทุกข้อ:
- Secure PIN hashing
- Receipt screen
- Receipt reprint
- Sales history
- Backup/restore
- Offline Tauri verification: login, shift, POS/cart, CASH checkout และยืนยัน SQLite คงอยู่หลังเปิดใหม่ โดยไม่พึ่ง Internet/Supabase/Vercel API

การผ่าน bootstrap/build อย่างเดียวไม่ได้หมายถึง production-ready

## Repository rule
Repository นี้ต้องเป็น `cp-ipos-desktop` แยกจาก `sstdevelopaminno/CpIPOS`. ห้ามนำ source tree นี้กลับไปวางเป็น app ย่อยใน Web monorepo.
