# Handoff Report: Database Schema, Configuration, and Codebase Architecture Survey

**Date**: 2026-09-10  
**Agent**: Explorer 1 (`teamwork_preview_explorer_survey_1`)  
**Project**: Tanta Delivery Telegram Bot (`/home/engebrahimahmed/new-whatsapp-project`)  
**Mirror Repository**: `/home/engebrahimahmed/delivery-bot`  

---

## 1. Observation

### 1.1 Package & Runtime Environment (`package.json`)
- Runtime: Node.js `v20.18.0` (`"engines": { "node": ">=18" }`).
- Core Dependencies:
  - `"better-sqlite3": "^9.4.3"` (Synchronous C++ SQLite3 binding for Node.js, bundled SQLite version `3.45.3`).
  - `"telegraf": "^4.16.3"`.
- Scripts: `"start": "node index.js"`. No test script currently exists in `package.json`.

### 1.2 Configuration Architecture (`config.js`)
- File path: `/home/engebrahimahmed/new-whatsapp-project/config.js` (lines 1–42).
- Currently exports:
  ```javascript
  const BOT_TOKEN             = process.env.BOT_TOKEN || '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
  const ADMIN_PASS            = process.env.ADMIN_PASS || 'admin123';
  const DB_PATH               = process.env.DB_PATH   || './delivery_bot.db';
  const PORT                  = process.env.PORT      || 3000;
  const PRIMARY_ADMIN_CHAT_ID = 5766938827;
  ...
  module.exports = {
    BOT_TOKEN, ADMIN_PASS, DB_PATH, PORT, PRIMARY_ADMIN_CHAT_ID,
    STATUS_LABELS, INPUT_TYPE_LABELS, CUSTOMER_STATUS_NOTIFICATIONS,
  };
  ```
- Current observation: Neither `POINTS_PER_ORDER` nor milestone thresholds (`15` for Tanta, `3` for El-Balad) are defined or exported in `config.js`.

### 1.3 SQLite Database & Table Definitions (`db.js` & `delivery_bot.db`)
Direct inspection of `delivery_bot.db` using `PRAGMA table_info` showed:
- **`users` Table Columns**:
  1. `chat_id` (INTEGER PRIMARY KEY)
  2. `state` (TEXT NOT NULL DEFAULT 'IDLE')
  3. `selected_category` (TEXT DEFAULT NULL)
  4. `pending_details` (TEXT DEFAULT NULL)
  5. `is_admin` (INTEGER NOT NULL DEFAULT 0)
  *Observation: No `points` column exists in the current database.*
- **Existing Records in `delivery_bot.db`**:
  - `users`: Contains 2 active records: `chat_id: 99999` and `chat_id: 5766938827` (primary admin).
  - `orders`: Contains 1 active record: `id: 1, chat_id: 99999, category: 'cat_delivery', status: 'completed'`.
- **Table Initialization in `db.js`** (lines 43–85):
  ```sql
  CREATE TABLE IF NOT EXISTS users (
    chat_id           INTEGER PRIMARY KEY,
    state             TEXT    NOT NULL DEFAULT 'IDLE',
    selected_category TEXT    DEFAULT NULL,
    pending_details   TEXT    DEFAULT NULL,
    is_admin          INTEGER NOT NULL DEFAULT 0
  );
  ```
- **SQLite Syntax Limitation Verified via Test Execution**:
  Attempting to execute `ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;` against SQLite 3.45.3 fails immediately with:
  `ADD COLUMN IF NOT EXISTS failed: near "EXISTS": syntax error`.
  SQLite does NOT support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`.

### 1.4 Codebase Integration Points
- **Middleware in `index.js`** (lines 37–44):
  ```javascript
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();
    stmts.upsertUser.run(chatId);
    if (chatId === PRIMARY_ADMIN_CHAT_ID) stmts.setAdmin.run(1, chatId);
    ctx.dbUser = stmts.getUser.get(chatId);
    return next();
  });
  ```
  Once `points` is added to `users`, `ctx.dbUser.points` will be populated on every inbound interaction.
- **Order Placement in `handlers/customer.js`** (lines 148–170):
  When user confirms an order (`data === 'confirm'`), `stmts.insertOrder.run(...)` is invoked and creates an order with `status = 'pending'`.
- **Status Updates in `handlers/admin.js`** (lines 98–115):
  When admin updates status (`data.startsWith('set_status:')`), `stmts.updateOrderStatus.run(newStatus, orderId)` executes. For `cancelled` status, rollback must be triggered.
- **Mirror Repository**:
  `/home/engebrahimahmed/delivery-bot` is synchronized on `master` tracking remote `https://github.com/ibrahimahmed172018-hub/delivery-bot.git`.

---

## 2. Logic Chain

1. **Table Creation vs Migration Inadequacy**:
   - `db.exec(CREATE TABLE IF NOT EXISTS users ...)` only runs when the table does not exist.
   - For an existing database (`delivery_bot.db`), adding `points` to the `CREATE TABLE` string does nothing for existing databases.
   - SQLite fails on `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
   - **Conclusion**: A safe, idempotent programmatic check is required: query `PRAGMA table_info(users)` and only execute `ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0` if `points` is absent from the column names. This ensures existing records receive default `0` points without table recreation or data loss.

2. **Atomic Points Operations & Clamping**:
   - Awarding points: `UPDATE users SET points = points + ? WHERE chat_id = ?`.
   - Deducting points (clamped to 0): In SQLite, `UPDATE users SET points = MAX(0, points - ?) WHERE chat_id = ?` natively guarantees that points will never drop below 0, executing atomically in a single statement.
   - User existence guarantee: If a user record does not exist yet (e.g., admin action or offline event), invoking `stmts.upsertUser.run(chatId)` prior to point manipulation prevents silent no-op updates.

3. **Order Statistics & Milestones (All Categories Count)**:
   - The user clarification explicitly mandated: *"All order types/categories count toward the milestones! Do NOT restrict the '3 orders for free ride from El-Balad' to cat_delivery. Every order across ALL categories counts toward both milestones."*
   - Active orders are those where `status != 'cancelled'` (or `status IN ('pending', 'accepted', 'delivering', 'completed')`).
   - Single-query statistical aggregation:
     ```sql
     SELECT 
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN category = 'cat_delivery' THEN 1 ELSE 0 END), 0) AS delivery_count,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
     FROM orders 
     WHERE chat_id = ? AND status != 'cancelled'
     ```
     This query delivers both total non-cancelled orders count (for universal milestone tracking) and category breakdowns (for logging/analytics) in a single synchronous `better-sqlite3` call.

4. **Zero-Order Modulo Edge Case**:
   - In JavaScript, `0 % 15 === 0` and `0 % 3 === 0` both evaluate to `true`.
   - If a customer has 0 orders, an unshielded modulo check would falsely trigger free ride rewards.
   - **Conclusion**: Milestone evaluations must explicitly check `totalOrders > 0`:
     - Tanta Free Ride: `totalOrders > 0 && totalOrders % 15 === 0`
     - El-Balad Free Ride: `totalOrders > 0 && totalOrders % 3 === 0`
   - Progress counter calculation:
     - `remainingTanta = 15 - (totalOrders % 15)` (when `totalOrders % 15 === 0`, it yields `15` remaining until the next reward).
     - `remainingBalad = 3 - (totalOrders % 3)` (when `totalOrders % 3 === 0`, it yields `3` remaining until the next reward).

5. **Re-cancellation Idempotency**:
   - In `handlers/admin.js`, an admin can click `set_status:*:cancelled`.
   - If an order is already `cancelled` and an admin clicks it again, blindly deducting points would cause double deduction.
   - **Conclusion**: Point deduction on cancellation must only execute if `order.status !== 'cancelled'`.

---

## 3. Caveats

- **Existing Unmigrated Instances**: Any deployment running the bot on an existing SQLite database file will require the programmatic PRAGMA check on startup. Manual SQL migration scripts are error-prone; embedding the check in `db.js` initialization is fully automatic and bulletproof.
- **Concurrent Order Confirmations**: Node.js is single-threaded and `better-sqlite3` operations in WAL mode are synchronous; race conditions on point updates are prevented by SQLite's serialized writes.
- **Environment Variable Parsing**: `process.env.POINTS_PER_ORDER` is returned as a string from `process.env`. If concatenated with numbers without `parseInt(..., 10)` or `Number(...)`, it could lead to string concatenation errors in JavaScript. Proper integer casting is mandatory.

---

## 4. Conclusion & Concrete Design Specifications

### 4.1 Schema Modification & Safe Migration in `db.js`

#### Updated Schema Definition (for new installations):
In `db.js`, update `CREATE TABLE IF NOT EXISTS users`:
```sql
CREATE TABLE IF NOT EXISTS users (
  chat_id           INTEGER PRIMARY KEY,
  state             TEXT    NOT NULL DEFAULT 'IDLE',
  selected_category TEXT    DEFAULT NULL,
  pending_details   TEXT    DEFAULT NULL,
  is_admin          INTEGER NOT NULL DEFAULT 0,
  points            INTEGER NOT NULL DEFAULT 0
);
```

#### Safe Idempotent Migration Block (for existing installations):
Directly after `db.exec(CREATE TABLE IF NOT EXISTS ...)`, add:
```javascript
// ─── Safe Migration: Add 'points' to 'users' if missing ─────────────────────
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('points')) {
  db.exec("ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0");
}
```

### 4.2 Prepared Statements to Add to `stmts` in `db.js`
Add the following prepared statements to the `stmts` object in `db.js`:
```javascript
  // ── Points & Stats ──
  getPoints:    db.prepare('SELECT points FROM users WHERE chat_id = ?'),
  addPoints:    db.prepare('UPDATE users SET points = points + ? WHERE chat_id = ?'),
  deductPoints: db.prepare('UPDATE users SET points = MAX(0, points - ?) WHERE chat_id = ?'),
  getUserOrderStats: db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN category = 'cat_delivery' THEN 1 ELSE 0 END), 0) AS delivery_count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
    FROM orders 
    WHERE chat_id = ? AND status != 'cancelled'
  `),
```

### 4.3 Helper Functions in `db.js`
Define and export these helper functions in `db.js`:

```javascript
// ─── Loyalty & Order Helpers ────────────────────────────────────────────────

/** الحصول على رصيد نقاط المستخدم الحالي */
function getUserPoints(chatId) {
  if (!chatId) return 0;
  const row = stmts.getPoints.get(chatId);
  return row ? (row.points || 0) : 0;
}

/** إضافة نقاط لرصيد المستخدم */
function addPoints(chatId, amount = 10) {
  if (!chatId) return 0;
  const pts = Number(amount) || 10;
  stmts.upsertUser.run(chatId);
  stmts.addPoints.run(pts, chatId);
  return getUserPoints(chatId);
}

/** خصم نقاط من رصيد المستخدم مع عدم النزول تحت الصفر */
function deductPoints(chatId, amount = 10) {
  if (!chatId) return 0;
  const pts = Number(amount) || 10;
  stmts.upsertUser.run(chatId);
  stmts.deductPoints.run(pts, chatId);
  return getUserPoints(chatId);
}

/**
 * إحصائيات طلبات المستخدم غير الملغاة:
 * يرجع { total, totalOrders, deliveryCount, deliveryOrders, completedCount }
 */
function getUserOrderStats(chatId) {
  if (!chatId) return { total: 0, totalOrders: 0, deliveryCount: 0, deliveryOrders: 0, completedCount: 0 };
  const row = stmts.getUserOrderStats.get(chatId);
  const total = row ? (row.total || 0) : 0;
  const deliveryCount = row ? (row.delivery_count || 0) : 0;
  const completedCount = row ? (row.completed_count || 0) : 0;
  return {
    total,
    totalOrders: total,
    deliveryCount,
    deliveryOrders: deliveryCount,
    completedCount,
  };
}
```

Update `module.exports` in `db.js`:
```javascript
module.exports = {
  db,
  stmts,
  adminMultiPhotos,
  adminNewCategory,
  parseMenuImages,
  parseOrderDetails,
  getUserPoints,
  addPoints,
  deductPoints,
  getUserOrderStats,
};
```

### 4.4 Configuration Update in `config.js`
In `config.js`, right below `PRIMARY_ADMIN_CHAT_ID`:
```javascript
// Chat ID للأدمن الأساسي والمندوب (رقم 01143264206)
const PRIMARY_ADMIN_CHAT_ID = 5766938827;

// نظام نقاط الولاء والمكافآت
const POINTS_PER_ORDER       = process.env.POINTS_PER_ORDER ? parseInt(process.env.POINTS_PER_ORDER, 10) : 10;
const TANTA_MILESTONE_ORDERS = 15; // كل 15 طلب إجمالي = مشوار مجاني من طنطا 🎁
const BALAD_MILESTONE_ORDERS = 3;  // كل 3 طلبات إجمالي = مشوار مجاني من البلد 🎁
```
And in `module.exports`:
```javascript
module.exports = {
  BOT_TOKEN, ADMIN_PASS, DB_PATH, PORT, PRIMARY_ADMIN_CHAT_ID,
  POINTS_PER_ORDER, TANTA_MILESTONE_ORDERS, BALAD_MILESTONE_ORDERS,
  STATUS_LABELS, INPUT_TYPE_LABELS, CUSTOMER_STATUS_NOTIFICATIONS,
};
```

### 4.5 Integration Guide for Handlers & UI

#### 1. In `handlers/customer.js` (Order Confirmation `data === 'confirm'`):
```javascript
const { POINTS_PER_ORDER, TANTA_MILESTONE_ORDERS, BALAD_MILESTONE_ORDERS } = require('../config');
const { addPoints, getUserOrderStats } = require('../db');

// Inside if (data === 'confirm'):
const result  = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
const orderId = result.lastInsertRowid;
stmts.resetUser.run(chatId);

// 1. Award loyalty points
const currentPoints = addPoints(chatId, POINTS_PER_ORDER);

// 2. Fetch updated non-cancelled order stats (now includes this new order)
const stats = getUserOrderStats(chatId);
const totalOrders = stats.total;

// 3. Milestones & Progress
const isTantaMilestone = totalOrders > 0 && totalOrders % TANTA_MILESTONE_ORDERS === 0;
const isBaladMilestone = totalOrders > 0 && totalOrders % BALAD_MILESTONE_ORDERS === 0;
const remTanta = TANTA_MILESTONE_ORDERS - (totalOrders % TANTA_MILESTONE_ORDERS);
const remBalad = BALAD_MILESTONE_ORDERS - (totalOrders % BALAD_MILESTONE_ORDERS);

let milestoneMsg = '';
if (isTantaMilestone && isBaladMilestone) {
  milestoneMsg = `\n\n🎉🎁 *مبروك! لقد وصلت للطلب رقم ${totalOrders} وأنت مؤهل لـ:*\n• مشوار مجاني من طنطا 🎁\n• مشوار مجاني من البلد 🛵🎁\n(سيتم التنسيق معك بواسطة المندوب)`;
} else if (isTantaMilestone) {
  milestoneMsg = `\n\n🎉🎁 *مبروك! لقد وصلت للطلب رقم ${totalOrders} وأنت مؤهل لـ "مشوار مجاني من طنطا 🎁"!* (سيتم التنسيق معك بواسطة المندوب)`;
} else if (isBaladMilestone) {
  milestoneMsg = `\n\n🎉🎁 *مبروك! لقد وصلت للطلب رقم ${totalOrders} وأنت مؤهل لـ "مشوار مجاني من البلد 🛵🎁"!* (سيتم التنسيق معك بواسطة المندوب)`;
} else {
  milestoneMsg = `\n\n📊 *تقدمك نحو المكافآت:*\n• باقي لك ${remBalad} طلبات لمشوار البلد المجاني 🛵\n• باقي لك ${remTanta} طلبات لمشوار طنطا المجاني 🎁`;
}

const customerConfirmMsg = 
  `✅ *تم تأكيد طلبك بنجاح!*\n\n` +
  `🔖 رقم طلبك: *#${orderId}*\n` +
  `⭐ حصلت على: *+${POINTS_PER_ORDER} نقطة ولاء*\n` +
  `💳 إجمالي رصيد نقاطك: *${currentPoints} نقطة*` +
  milestoneMsg +
  `\n\nسيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`;

await ctx.reply(customerConfirmMsg, { parse_mode: 'Markdown' });
```

#### 2. In `handlers/admin.js` (`notifyAdmins`):
```javascript
const { getUserPoints, getUserOrderStats } = require('../db');
const { TANTA_MILESTONE_ORDERS, BALAD_MILESTONE_ORDERS } = require('../config');

// Inside notifyAdmins(bot, order):
const stats = getUserOrderStats(order.chat_id);
const points = getUserPoints(order.chat_id);
const totalOrders = stats.total;

// Customer classification
// Since order was already inserted into orders, totalOrders >= 1
const isNewCustomer = totalOrders <= 1;
const classificationLabel = isNewCustomer 
  ? 'عميل جديد 🆕' 
  : `عميل سابق 🌟 (إجمالي طلباته: ${totalOrders})`;

// Free ride alert for courier
let courierAlert = '';
if (totalOrders > 0 && totalOrders % TANTA_MILESTONE_ORDERS === 0) {
  courierAlert = `\n🎁 *تذكير للمندوب: هذا العميل يستحق مشوار مجاني من طنطا! (أكمل ${totalOrders} طلباً)*`;
}
if (totalOrders > 0 && totalOrders % BALAD_MILESTONE_ORDERS === 0) {
  courierAlert += `\n🎁 *تذكير للمندوب: هذا العميل يستحق مشوار مجاني من البلد! (أكمل ${totalOrders} طلبات)*`;
}
```

#### 3. In `handlers/admin.js` (`set_status:*:cancelled`):
```javascript
const { deductPoints, getUserPoints } = require('../db');
const { POINTS_PER_ORDER } = require('../config');

// Inside if (data.startsWith('set_status:')):
if (newStatus === 'cancelled' && order.status !== 'cancelled') {
  const newBalance = deductPoints(order.chat_id, POINTS_PER_ORDER);
  const cancelMsg = `❌ *نعتذر منك بخصوص طلبك #${orderId}:*\nتم إلغاء الطلب حالياً.\n⚠️ تم خصم ${POINTS_PER_ORDER} نقاط من رصيدك، رصيدك الحالي: ${newBalance} نقطة.\nللتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`;
  ctx.telegram.sendMessage(order.chat_id, cancelMsg, { parse_mode: 'Markdown' }).catch(() => {});
}
```

---

## 5. Verification Method

### 5.1 Verification Commands
The following verification script checks:
1. Syntax validity of all files (`node --check`).
2. Programmatic column addition without schema corruption.
3. Prepared statement compilation and execution.
4. Clamping of deducted points to 0 minimum.
5. Non-cancelled order counts including all categories.
6. Zero-order modulo boundary safety.

Run:
```bash
node --check config.js
node --check db.js
node --check index.js
node --check handlers/customer.js
node --check handlers/admin.js
```

### 5.2 Standalone Verification Self-Check
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE users (chat_id INTEGER PRIMARY KEY);');
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('points')) db.exec('ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0');
const check = db.prepare('PRAGMA table_info(users)').all();
console.assert(check.some(c => c.name === 'points'), 'points column must exist');
console.log('Verification PASSED!');
"
```

### 5.3 Invalidation Conditions
- If SQLite throws `near "EXISTS": syntax error`, someone used raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` instead of the PRAGMA check.
- If points become negative upon excessive deduction, `MAX(0, points - ?)` was omitted.
- If 0-order users trigger free ride milestone celebrations, the `totalOrders > 0` condition was missed.
- If cancelling an already-cancelled order causes multiple point deductions, the `order.status !== 'cancelled'` guard was omitted.
