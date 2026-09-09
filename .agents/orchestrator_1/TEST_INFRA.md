# E2E Test Infra: Tanta Delivery Telegram Bot — Points & Wallet System

## Test Philosophy
- Requirement-driven verification based on `ORIGINAL_REQUEST.md` (Method 1).
- Isolated SQLite database execution (using temporary file or memory via `DB_PATH`).
- Self-contained, dependency-free test script utilizing Node.js built-in `node:test` and `node:assert`.

## Test Scenarios
1. **Scenario 1: Loyalty Points Configuration & Persistence**
   - Config default `POINTS_PER_ORDER = 10`.
   - Adding points on confirmation (`confirm`) increases user points.
   - Idempotent `ALTER TABLE` / `PRAGMA table_info` migration adds `points` and `wallet_balance` without corrupting existing user records.
   - Deducting points clamps to 0 minimum.

2. **Scenario 2: Wallet Exchange Packages**
   - User with 80 points exchanges for 20 EGP (تكلفة مشوار البلد) -> points = 0, wallet = 20 EGP.
   - User with 150 points exchanges for 60 EGP (تكلفة مشوار طنطا) -> points = 0, wallet = 60 EGP.
   - Attempting exchange with insufficient points fails gracefully with no balance change.

3. **Scenario 3: Wallet Balance Discount on Order**
   - When user with wallet balance confirms order with discount:
     - Deducts discount from wallet balance.
     - Details include `[خصم من المحفظة: X ج]`.
     - Awards 10 loyalty points.
     - Courier alert includes prominent wallet discount reminder (`💳 خصم من المحفظة`).

4. **Scenario 4: Customer Classification**
   - User with 0 prior confirmed orders: classified as `عميل جديد 🆕`.
   - User with 1+ prior confirmed orders: classified as `عميل سابق 🌟 (إجمالي طلباته: X)`.

5. **Scenario 5: Cancellation & Rollback**
   - Admin cancels order (`set_status:*:cancelled`).
   - Rollback deducts awarded 10 points (clamped to 0).
   - Rollback restores used wallet balance.
   - Repeat cancellation does NOT re-deduct points or re-restore wallet (idempotent).
   - Customer notification contains points deduction and restored wallet balance.

6. **Scenario 6: Syntax Check**
   - `node --check` across all JS files.
