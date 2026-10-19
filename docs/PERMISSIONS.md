# Permissions

## Initial Roles

- OWNER
- MANAGER
- PURCHASING
- STAFF

## Permission Model

Permissions are capability-based rather than hard-coded role checks.

Examples:

- inventory.view
- inventory.create
- inventory.adjust
- inventory.count
- waste.create
- purchase.view
- purchase.create
- purchase.approve
- supplier.manage
- reports.view
- users.manage
- ai.use

## Security Layers

1. UI capability checks
2. Server authorization
3. PostgreSQL / Supabase RLS

UI visibility is not considered a security boundary.
