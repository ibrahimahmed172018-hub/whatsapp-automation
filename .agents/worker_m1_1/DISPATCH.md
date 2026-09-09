## 2026-09-10T01:20:25Z
You are Worker 1 (`worker_m1_1`) for Milestone 1 (Core Feature Implementation) of the Tanta Delivery Telegram Bot project.

Your working directory is: `/home/engebrahimahmed/new-whatsapp-project/.agents/worker_m1_1/`.
Project root is: `/home/engebrahimahmed/new-whatsapp-project`.
Authoritative user request: `/home/engebrahimahmed/new-whatsapp-project/ORIGINAL_REQUEST.md`. MUST READ FIRST!
Project scope: `/home/engebrahimahmed/new-whatsapp-project/.agents/orchestrator_1/PROJECT.md`.
Read Explorer reports:
- `/home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_1/handoff.md`
- `/home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_2/handoff.md`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your exclusive file write ownership:
- `config.js`
- `db.js`
- `keyboards.js`
- `handlers/customer.js`
- `handlers/admin.js`
- `index.js`

Detailed Implementation Requirements (Method 1: Points & Wallet System):
1. `config.js`:
   - Add:
     `const POINTS_PER_ORDER = process.env.POINTS_PER_ORDER ? parseInt(process.env.POINTS_PER_ORDER, 10) : 10;`
     `const EXCHANGE_PACKAGES = [`
       `{ id: 'balad', points: 80, egp: 20, label: 'تكلفة مشوار البلد (20 ج)' },`
       `{ id: 'tanta', points: 150, egp: 60, label: 'تكلفة مشوار طنطا (60 ج)' }`
     `];`
   - Export both.
2. `db.js`:
   - In `CREATE TABLE IF NOT EXISTS users`, add `points INTEGER NOT NULL DEFAULT 0, wallet_balance INTEGER NOT NULL DEFAULT 0`.
   - Directly after `CREATE TABLE IF NOT EXISTS users`, add safe idempotent migration via `PRAGMA table_info(users)`:
     If `points` is missing, `ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0`.
     If `wallet_balance` is missing, `ALTER TABLE users ADD COLUMN wallet_balance INTEGER NOT NULL DEFAULT 0`.
   - Add prepared statements and exportable helpers:
     - `getUserPoints(chatId)` -> integer
     - `getUserWallet(chatId)` -> integer
     - `addPoints(chatId, amount)` -> atomic `points = points + ?`
     - `deductPoints(chatId, amount)` -> atomic `points = MAX(0, points - ?)`
     - `addWalletBalance(chatId, amount)` -> atomic `wallet_balance = wallet_balance + ?`
     - `deductWalletBalance(chatId, amount)` -> atomic `wallet_balance = MAX(0, wallet_balance - ?)`
     - `exchangePointsForWallet(chatId, packagePoints, packageEgp)`:
       Using a SQLite transaction (`db.transaction`):
       Verify `user.points >= packagePoints`. If false, return `{ success: false, error: 'INSUFFICIENT_POINTS' }`.
       If true, deduct `packagePoints` from `points`, add `packageEgp` to `wallet_balance`.
       Return `{ success: true, points: newPoints, wallet: newWallet }`.
     - `getUserOrderStats(chatId)`:
       Returns `{ totalOrders, completedCount }` counting orders where `status != 'cancelled'`.
3. `keyboards.js`:
   - In `buildMainMenuKeyboard()`: add button `[Markup.button.callback('💰 محفظتي ونقاطي', 'user_wallet')]`.
   - Add `buildWalletKeyboard(points, walletBalance)`:
     Dynamic buttons for `EXCHANGE_PACKAGES` (only show exchange button if user has `points >= pkg.points`).
     Always include `🔙 العودة للقائمة الرئيسية` (`back_to_menu`).
   - Add `confirmWithWalletKeyboard(hasWalletBalance)`:
     If customer has `wallet_balance > 0`, offer:
     `💳 تأكيد مع خصم من المحفظة` (`confirm_use_wallet`)
     `💵 تأكيد ودفع كاش كامل` (`confirm_cash`)
     `✏️ تعديل الطلب` (`edit_order`)
     `❌ إلغاء الطلب` (`cancel_order`)
     If customer does not have wallet balance (`wallet_balance === 0`), use standard confirm (`confirm`).
4. `handlers/customer.js`:
   - Handle callback `user_wallet`:
     Fetch points and wallet balance, display nicely in Arabic with current balances, available exchange packages, how points are earned (+10 on confirmation), and keyboard.
   - Handle callback `exchange_pkg:<id>`:
     Find package by id from `EXCHANGE_PACKAGES`.
     Call `exchangePointsForWallet(chatId, pkg.points, pkg.egp)`.
     If success, reply with celebratory message in Arabic showing deducted points, added EGP, and new balances.
     If failure, reply stating insufficient points.
   - Handle order confirmation:
     Support both `confirm_use_wallet` and `confirm` / `confirm_cash`.
     If `confirm_use_wallet` and user has `wallet_balance > 0`:
       Discount amount = `user.wallet_balance`.
       Deduct discount from `wallet_balance` via `deductWalletBalance(chatId, discount)`.
       Append `\n💳 [خصم من المحفظة: ${discount} ج]` to order details string before inserting into DB.
       Record `wallet_discount: discount` in `ctx.orderToNotify`.
     Award `POINTS_PER_ORDER` (+10) via `addPoints(chatId, POINTS_PER_ORDER)`.
     Query `totalOrders` via `getUserOrderStats(chatId)`.
     Customer classification: `totalOrders <= 1 ? 'عميل جديد 🆕' : 'عميل سابق 🌟 (إجمالي طلباته: ' + totalOrders + ')'`.
     Customer confirmation reply:
       Show order ID, `+POINTS_PER_ORDER نقاط ولاء`, current points balance, current wallet balance, and if wallet discount was applied, show discount details.
     Attach customerBadge, points, wallet balance, walletDiscount to `ctx.orderToNotify`.
5. `handlers/admin.js`:
   - In `notifyAdmins(bot, order)`:
     Display customer classification: `${customerBadge}`.
     Display `⭐ نقاط الولاء: ${points} نقطة`.
     Display `💰 رصيد المحفظة: ${walletBalance} ج`.
     If `order.walletDiscount > 0` or parsed details has wallet discount:
       Prominently display: `💳 تنبيه للمندوب: تم خصم ${walletDiscount} ج من محفظة العميل! المطلوب كاش: بعد الخصم.`
   - In `set_status:*:cancelled`:
     Ensure idempotency: `if (newStatus === 'cancelled' && order.status !== 'cancelled')`:
       Deduct points: `deductPoints(order.chat_id, POINTS_PER_ORDER)`.
       Check if order details contained wallet discount (e.g. regex `خصم من المحفظة: (\\d+) ج`).
       If wallet discount found, restore it: `addWalletBalance(order.chat_id, restoredAmount)`.
       Notify customer: send message explaining cancellation, points deduction, and wallet balance restoration (if any) with updated balances.
   - In `admin_orders`:
     On each order card, display customer classification, points, and wallet balance.
6. `index.js`:
   - Add commands `/wallet`, `/points`, `/profile` and text triggers ('محفظتي', 'نقاطي', 'رصيدي') displaying the wallet overview.
   - In `/start` and `/menu`, display current points and wallet balance in the greeting message.
7. Verification:
   Run `node --check` across `config.js`, `db.js`, `keyboards.js`, `handlers/customer.js`, `handlers/admin.js`, `index.js`.
   Ensure no syntax errors exist.
8. Document all changes in `/home/engebrahimahmed/new-whatsapp-project/.agents/worker_m1_1/handoff.md` and send message to parent upon completion.
