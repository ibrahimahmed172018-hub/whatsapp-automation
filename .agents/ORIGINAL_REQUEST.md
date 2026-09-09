# Original User Request

## 2026-09-09T21:47:53Z

Implement a Loyalty Points & Free Rides Milestone System and Customer Classification (New vs. Returning Customer with Badges & Points Display) for the Tanta Delivery Telegram Bot ("بوت دليفري طنطا").

Working directory: /home/engebrahimahmed/new-whatsapp-project
Integrity mode: development

## Requirements

### R1. Loyalty Points Configuration & Persistence
- Configurable `POINTS_PER_ORDER = process.env.POINTS_PER_ORDER || 10` in `config.js`.
- Store and track user points in SQLite (`points` column in `users` table with default `0`).
- Immediately award points to the customer's balance upon order confirmation (`confirm`).
- If an order is later cancelled by an admin (`set_status:*:cancelled`), immediately deduct the points awarded for that order (clamped to 0 minimum) and inform the customer about the points deduction in their cancellation message.
- Show the customer their updated points balance upon order confirmation and when checking their profile/menu.

### R2. Free Ride Milestones (طنطا & البلد)
- **كل 15 طلب إجمالي لأي عميل = مشوار مجاني من طنطا 🎁**:
  - حساب عدد الطلبات المؤكدة الناجحة للعميل (`total_completed_orders` أو `total_orders`).
  - عند وصول العميل للطلب رقم 15، 30، 45... (كل مضاعف لـ 15)، يُمنح إشعار بارز للعميل وللإدارة/المندوب بأن هذا الطلب مؤهل لـ "مشوار مجاني من طنطا 🎁".
  - إظهار عدّاد التقدم للعميل (مثال: "باقي لك X طلبات للحصول على مشوار مجاني من طنطا").
- **كل 3 طلبات دليفري/مشاوير (قسم دليفري وطلبات خاصة `cat_delivery`) = مشوار مجاني من البلد 🎁**:
  - حساب عدد طلبات قسم الدليفري والمشاوير المؤكدة للعميل.
  - عند كل 3 مشاوير (الطلب رقم 3، 6، 9...)، يُمنح إشعار بارز بأن العميل استحق "مشوار مجاني من البلد 🛵🎁".
  - إظهار عدّاد التقدم لمشاوير البلد.

### R3. Customer Classification (New vs. Returning Customer)
- When a customer places an order, query their non-cancelled orders count.
- If 0 previous orders: classify as `عميل جديد 🆕`.
- If >= 1 previous orders: classify as `عميل سابق 🌟` (مع إظهار عدد طلباته السابقة).

### R4. Admin & Courier Notification UI Enhancement
- In the new order alert sent to the primary courier (`PRIMARY_ADMIN_CHAT_ID`) and all admins:
  - Display the customer classification (`عميل جديد 🆕` أو `عميل سابق 🌟 (إجمالي طلباته: X)`).
  - Display current loyalty points (`⭐ نقاط الولاء: Y نقطة`).
  - Display if this order qualifies for a free ride:
    - `🎁 تذكير للمندوب: هذا العميل يستحق مشوار مجاني من طنطا! (أكمل 15 طلباً)`
    - أو `🎁 تذكير للمندوب: هذا العميل يستحق مشوار مجاني من البلد! (أكمل 3 مشاوير)`
- Reflect these details also in the admin panel's order view (`admin_orders`).

### R5. Architecture Integrity & Repository Mirroring
- Maintain the clean modular architecture (`config.js`, `db.js`, `keyboards.js`, `handlers/`, `index.js`).
- Mirror all changes completely to `/home/engebrahimahmed/delivery-bot`.
- Commit and push to both GitHub remotes (`whatsapp-automation` and `delivery-bot`) on both `main` and `master` branches.

## Acceptance Criteria

### Data & Logic
- [ ] Safe migration adding `points INTEGER NOT NULL DEFAULT 0` to `users` without data loss.
- [ ] Helper queries in `db.js` for:
  - `getUserPoints(chatId)`
  - `addPoints(chatId, amount)`
  - `deductPoints(chatId, amount)`
  - `getUserOrderStats(chatId)` returning total orders count and delivery category (`cat_delivery`) orders count.
- [ ] Logic checks if `(totalOrders % 15 === 0)` for Tanta free ride and `(deliveryOrders % 3 === 0)` for El-Balad free ride.

### Customer Experience & Notifications
- [ ] Customer confirmation message displays:
  - Points earned (+10).
  - Total points balance.
  - Free ride banner if milestone reached, otherwise progress toward next free ride.
- [ ] Admin/courier notification contains full customer status, points, and free ride eligibility notice.
- [ ] Cancellation properly rolls back points and notifies the customer.

### Quality & Tests
- [ ] `node --check` passes on all files without syntax errors.
- [ ] Automated end-to-end test script verifies:
  1. Points addition and deduction.
  2. Classification of new vs returning user.
  3. Milestone triggering for 15th total order (Tanta free ride).
  4. Milestone triggering for 3rd delivery order (El-Balad free ride).
- [ ] Both local workspaces and both git remotes (`whatsapp-automation` & `delivery-bot`) pushed and synchronized on `main` and `master`.

## Follow-up — 2026-09-09T21:49:26Z

Clarification from user:
"الطلبات مش نوع محدد كل الانواع فاهم"
All order types/categories count toward the milestones! Do NOT restrict the "3 orders for free ride from El-Balad" to `cat_delivery`. Every order across ALL categories counts toward both milestones:
1. Every 15 orders (any category) = free ride from Tanta (مشوار مجاني من طنطا 🎁).
2. Every 3 orders (any category) = free ride from the local town / El-Balad (مشوار مجاني من البلد 🎁).

Please ensure the order counters count ALL confirmed orders regardless of category.

## Follow-up — 2026-09-09T22:07:27Z

HOLD / REQUIREMENT CHANGE:
The user has requested to change the mechanism:
Cancel the "free ride every X trips" milestone logic. Instead, the user wants a pure Points & Wallet (محفظة الرصيد) system where points convert to money (e.g., 80 points = 20 EGP, 150 points = 60 EGP).
Please hold and do not push code changes until the user selects their preferred wallet interaction flow from the options being presented.

## Follow-up — 2026-09-09T22:11:33Z

RESUME EXECUTION - METHOD 1 SELECTED:

The user has explicitly chosen Method 1 (نظام باقات الاستبدال اليدوي):
1. Loyalty points: 10 points per confirmed order (configurable in `config.js`). Cancelled orders deduct the points.
2. Users table stores `points` (default 0) and `wallet_balance` (default 0).
3. Wallet UI for customer:
   - Button in main menu: `💰 محفظتي ونقاطي` (`user_wallet`).
   - Displays points and wallet balance in EGP.
   - Exchange packages:
     - 80 points -> 20 EGP (تكلفة مشوار البلد)
     - 150 points -> 60 EGP (تكلفة مشوار طنطا)
     - Only show exchange buttons if customer has enough points.
     - On exchange: deduct points, add EGP to wallet balance.
4. Order Confirmation:
   - If customer has `wallet_balance > 0`, offer option to use wallet balance toward the delivery, or pay full cash.
   - If wallet balance used: deduct from `wallet_balance`, record discount in order details.
   - On admin cancellation: restore used wallet balance and deduct awarded points.
5. Courier / Admin alert & recent orders view:
   - Classification: `عميل جديد 🆕` (0 previous orders) or `عميل سابق 🌟 (إجمالي طلباته: X)`.
   - Show points and wallet balance.
   - If wallet discount used: prominently notify courier (e.g. `💳 خصم من المحفظة: X ج | المطلوب كاش: بعد الخصم`).
6. Dual repo sync (`/home/engebrahimahmed/delivery-bot`) and push to both GitHub remotes on `main` and `master`.
7. E2E verification test script.
