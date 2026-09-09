# Project: Tanta Delivery Telegram Bot — Points, Wallet & Customer Classification

## Architecture
- Modular Telegraf Bot architecture with SQLite (`better-sqlite3`).
- Single source of truth for configuration: `config.js`.
- Synchronous database access layer with prepared statements: `db.js`.
- User interaction flows: `handlers/customer.js`.
- Admin & Courier notification and status management: `handlers/admin.js`.
- Keyboards and menus: `keyboards.js`.
- Main bot entry point and routing: `index.js`.
- Secondary repository mirror: `/home/engebrahimahmed/delivery-bot`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Configurable Points | `POINTS_PER_ORDER = process.env.POINTS_PER_ORDER || 10` in `config.js` | M1 | ORIGINAL_REQUEST R1 |
| 2 | Exchange Packages Config | `EXCHANGE_PACKAGES`: 80 pts -> 20 EGP (بلد), 150 pts -> 60 EGP (طنطا) | M1 | ORIGINAL_REQUEST Method 1 |
| 3 | DB Points & Wallet Columns | Safe migration adding `points` and `wallet_balance` to `users` table with default 0 | M1 | ORIGINAL_REQUEST Method 1 |
| 4 | Points & Wallet DB Helpers | `getUserPoints`, `getUserWallet`, `addPoints`, `deductPoints`, `addWalletBalance`, `deductWalletBalance`, `exchangePointsForWallet`, `getUserOrderStats` | M1 | ORIGINAL_REQUEST Method 1 |
| 5 | Wallet UI Button & Screen | `💰 محفظتي ونقاطي` in main menu and `/wallet`, `/profile`, `/points` displaying balance and exchange options | M1 | ORIGINAL_REQUEST Method 1 |
| 6 | Points to Wallet Exchange | Callback handler for exchanging points to wallet EGP with validation | M1 | ORIGINAL_REQUEST Method 1 |
| 7 | Order Confirmation Points | Award 10 points upon order confirmation and display new balance | M1 | ORIGINAL_REQUEST R1 |
| 8 | Wallet Discount on Order | Option to use wallet balance toward order delivery if `wallet_balance > 0` | M1 | ORIGINAL_REQUEST Method 1 |
| 9 | Customer Classification | `عميل جديد 🆕` (0 prior orders) vs `عميل سابق 🌟 (إجمالي طلباته: X)` | M1 | ORIGINAL_REQUEST R3 |
| 10 | Courier/Admin New Order Alert | Show classification, points, wallet balance, and wallet discount notice | M1 | ORIGINAL_REQUEST R4 & Method 1 |
| 11 | Admin Orders View Card | Display classification badge, points, and wallet balance on order cards | M1 | ORIGINAL_REQUEST R4 & Method 1 |
| 12 | Cancellation Points Rollback | Deduct points upon admin cancellation (`set_status:*:cancelled`) clamped to 0 | M1 | ORIGINAL_REQUEST R1 |
| 13 | Cancellation Wallet Restoration | Restore deducted wallet balance if order was cancelled by admin | M1 | ORIGINAL_REQUEST Method 1 |
| 14 | Cancellation Customer Notice | Notify customer of cancellation, deducted points, and restored wallet balance | M1 | ORIGINAL_REQUEST R1 & Method 1 |
| 15 | Automated E2E Test Suite | Node.js test script verifying all scenarios: points, exchange, wallet discount, classification, cancellation rollback | M2 | ORIGINAL_REQUEST Tests |
| 16 | Syntax Verification | `node --check` passes cleanly across all files | M2 | ORIGINAL_REQUEST Tests |
| 17 | Repository Mirroring | Mirror all changes to `/home/engebrahimahmed/delivery-bot` cleanly | M3 | ORIGINAL_REQUEST R5 |
| 18 | Dual Remote Git Push | Commit and push to `whatsapp-automation` and `delivery-bot` on both `main` and `master` | M3 | ORIGINAL_REQUEST R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Core Feature Implementation | `config.js`, `db.js`, `keyboards.js`, `handlers/customer.js`, `handlers/admin.js`, `index.js` | Survey done | IN_PROGRESS |
| 2 | E2E Test Suite & Quality | `tests/test_wallet_loyalty.js`, `node --check` | M1 | PLANNED |
| 3 | Repository Mirroring & Push | Sync to `/home/engebrahimahmed/delivery-bot`, commit & push to both remotes on `main` & `master` | M2 | PLANNED |

## Interface Contracts
### `config.js`
```javascript
const POINTS_PER_ORDER = process.env.POINTS_PER_ORDER ? parseInt(process.env.POINTS_PER_ORDER, 10) : 10;
const EXCHANGE_PACKAGES = [
  { id: 'balad', points: 80, egp: 20, label: 'تكلفة مشوار البلد' },
  { id: 'tanta', points: 150, egp: 60, label: 'تكلفة مشوار طنطا' }
];
```

### `db.js`
```javascript
getUserPoints(chatId) -> number
getUserWallet(chatId) -> number
addPoints(chatId, amount) -> number
deductPoints(chatId, amount) -> number (clamped to 0)
addWalletBalance(chatId, amount) -> number
deductWalletBalance(chatId, amount) -> number (clamped to 0)
exchangePointsForWallet(chatId, packagePoints, packageEgp) -> { success: boolean, points: number, wallet: number, error?: string }
getUserOrderStats(chatId) -> { totalOrders: number, completedCount: number }
```

## Code Layout
- `/home/engebrahimahmed/new-whatsapp-project/config.js`
- `/home/engebrahimahmed/new-whatsapp-project/db.js`
- `/home/engebrahimahmed/new-whatsapp-project/keyboards.js`
- `/home/engebrahimahmed/new-whatsapp-project/handlers/customer.js`
- `/home/engebrahimahmed/new-whatsapp-project/handlers/admin.js`
- `/home/engebrahimahmed/new-whatsapp-project/index.js`
- `/home/engebrahimahmed/new-whatsapp-project/tests/test_wallet_loyalty.js`
