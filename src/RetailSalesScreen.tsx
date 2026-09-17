import { useEffect, useState, type ComponentProps } from "react";
import { GrocerySalesScreen } from "./GrocerySalesScreen";
import { salesModeAllowed } from "./license-entitlements";

type Props = ComponentProps<typeof GrocerySalesScreen>;

export function RetailSalesScreen(props: Props) {
  const [allowed, setAllowed] = useState(() => salesModeAllowed("grocery"));

  useEffect(() => {
    const refresh = () => setAllowed(salesModeAllowed("grocery"));
    const id = window.setTimeout(refresh, 0);
    const second = window.setTimeout(refresh, 500);
    window.addEventListener("cpipos:license-online-status", refresh);
    window.addEventListener("cpipos:license-entitlements", refresh);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(second);
      window.removeEventListener("cpipos:license-online-status", refresh);
      window.removeEventListener("cpipos:license-entitlements", refresh);
    };
  }, []);

  if (!allowed) {
    return <section className="error-card">
      <h1>License นี้ไม่ได้เปิดโหมดร้านชำ</h1>
      <p>โหมดขายถูกกำหนดจาก License Key ที่ออกโดย CUTTING POINT TECH IT กรุณาติดต่อฝ่าย IT เพื่อออก License Revision ที่อนุญาตโหมดร้านชำ</p>
    </section>;
  }

  return <GrocerySalesScreen {...props} />;
}
