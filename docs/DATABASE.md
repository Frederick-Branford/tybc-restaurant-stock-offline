# Database Design

## Inventory Principle

Stock movement ledger is the source of truth.

Current stock:

SUM(stock_movements.base_quantity)

## Planned Tables

### Identity
- profiles
- roles
- permissions
- role_permissions

### Inventory
- categories
- units
- items
- item_units
- stock_movements
- waste_reasons
- waste_records

### Stock Count
- stock_counts
- stock_count_items

### Purchasing
- suppliers
- purchase_orders
- purchase_order_items
- goods_receipts
- goods_receipt_items

### System
- alerts
- audit_logs
- ai_insights

## Important Rules

- Quantities use NUMERIC, not floating point.
- Internal inventory calculations use base units.
- Confirmed stock movements are immutable.
- Stock count differences create adjustment movements.
- Receiving goods creates stock movements.
- Critical multi-write operations must run in one database transaction.
