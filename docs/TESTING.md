# Testing Strategy

## Quality Gate

Before important commits:

npm run lint
npm run typecheck
npm test
npm run build

## Unit Tests

Focus on:

- Unit conversion
- Stock balance
- Variance calculations
- Validation
- Business rules

## Integration Tests

Focus on:

- Stock in
- Stock out
- Waste
- Stock count completion
- PO receiving
- Audit creation

## E2E Tests

Critical flows:

1. Login
2. Stock In
3. Stock Out
4. Waste
5. Stock Count
6. Purchase Order
7. Receiving

## Critical Invariants

- Receiving the same operation twice must not duplicate stock.
- Completing a count twice must not duplicate adjustments.
- Unauthorized users cannot mutate inventory.
- Confirmed movements cannot be edited.
