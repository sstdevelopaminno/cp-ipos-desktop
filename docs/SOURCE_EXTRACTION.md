# UI Source Extraction Record

Source inspected: `sstdevelopaminno/CpIPOS`, branch `agent-docs-preflight-schema-drift`.

Desktop V0.1 ports the low-coupling POS UI primitives from:
- `apps/backoffice-web/src/components/pos-ui/pos-shell.tsx` (source blob `fc9f4f72...`)
- `.../pos-category-nav.tsx` (`1f2fd3df...`)
- `.../pos-product-card.tsx` (`f373a8de...`)
- `.../pos-product-grid.tsx` (`2de12873...`)
- `.../pos-cart-panel.tsx` (`89da8dcb...`)

Reviewed but intentionally **not copied wholesale**:
- `components/pos/pos-sales-module.tsx` — very large and coupled to web/cloud behavior.
- `components/pos/pos-sales-mvp.tsx` — useful flow reference; Desktop implements a local repository boundary instead.
- browser/PWA print agents — Desktop printer integration will use native Windows/Tauri boundary.
- Web API routes, Supabase clients, Vercel runtime code — prohibited in the offline critical path.

Rule: UI can be ported; network/data access must be replaced with `PosRepository` implementations.
