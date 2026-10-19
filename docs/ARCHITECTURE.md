# Restaurant Stock System — Architecture

## Architecture Style

Modular Monolith.

## Technology

- Next.js 16
- React 19
- TypeScript strict
- Tailwind CSS
- shadcn/ui with Base UI
- PostgreSQL / Supabase
- Supabase Auth
- Supabase Storage
- Zod
- Vitest
- Playwright
- Vercel

## Core Principles

1. Stock movements are the inventory source of truth.
2. Current stock must not be edited directly.
3. Confirmed stock movements are immutable.
4. Corrections create new movements.
5. Critical operations must execute transactionally.
6. Authorization is enforced server-side.
7. RLS provides an additional database security boundary.
8. AI is read-only in the initial version.
9. Database computes; AI interprets.
10. UI must not own business logic.

## Main Domains

- Authentication
- Users & Permissions
- Inventory
- Stock Movement
- Waste
- Stock Count
- Purchasing
- Suppliers
- Reports
- Alerts
- Audit
- AI
