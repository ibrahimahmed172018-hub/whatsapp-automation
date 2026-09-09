# Handoff Report: Order Lifecycle, Notifications, Admin Panel & User Profile UI Survey

## 1. Observation

Direct observations from the codebase investigation:

### 1.1 Architecture & File Mapping
- **Project Structure**:
  - `index.js`: Main Telegraf bot instance, command routing (`/start`, `/menu`, `/admin`), text router, callback query dispatcher, and admin notification trigger (`lines 129-131: if (ctx.orderToNotify) notifyAdmins(bot, ctx.orderToNotify);`).
  - `handlers/customer.js`: Contains customer interaction logic, photo/text handling, category selection, and order confirmation flow (`line 148: if (data === 'confirm')`).
  - `handlers/admin.js`: Contains admin authentication, notification dispatcher (`lines 14-43: notifyAdmins(bot, order)`), order status callbacks (`lines 98-115: if (data.startsWith('set_status:'))`), order browsing (`lines 118-144: if (data === 'admin_orders')`), and overall stats.
  - `keyboards.js`: Inline keyboards including `buildMainMenuKeyboard()` (line 11), `confirmKeyboard` (line 19), `getOrderActionKeyboard(orderId)` (line 25), and `adminKeyboard` (line 41).
  - `config.js`: Constants including `BOT_TOKEN`, `PRIMARY_ADMIN_CHAT_ID` (line 12: `5766938827`), `STATUS_LABELS` (lines 15-21), and `CUSTOMER_STATUS_NOTIFICATIONS` (lines 31-36).
  - `db.js`: SQLite schema, tables (`users`, `orders`, `categories`, `category_items`, `restaurants`), and prepared statements (`stmts`).

### 1.2 Order Confirmation Flow (`handlers/customer.js`)
- Currently at `handlers/customer.js:148-170`:
```javascript
  if (data === 'confirm') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', buildMainMenuKeyboard());
    }
    const username = ctx.from?.username || '';
    const result   = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
    const orderId  = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    await ctx.reply(
      `✅ *تم تأكيد طلبك بنجاح!*\n\n🔖 رقم طلبك: *#${orderId}*\n\nسيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`,
      { parse_mode: 'Markdown' }
    );

    // إشعار فوري للأدمن — يتم من index.js عبر notifyAdmins
    ctx.orderToNotify = {
      id: orderId, chat_id: chatId, username,
      category: user.selected_category, details: user.pending_details,
      created_at: new Date().toLocaleString('ar-EG'),
    };
    return;
  }
```
- Observations:
  1. Points are **not** currently awarded or tracked.
  2. The reply message contains only the order number, with no points balance or milestone info.
  3. `ctx.orderToNotify` contains basic order fields, but lacks customer classification, points, and free ride milestone flags.

### 1.3 Admin & Courier New Order Notification (`handlers/admin.js`)
- Currently at `handlers/admin.js:14-43`:
```javascript
function notifyAdmins(bot, order) {
  const dbAdmins = stmts.getAdmins.all().map(a => a.chat_id);
  const targets  = Array.from(new Set([PRIMARY_ADMIN_CHAT_ID, ...dbAdmins]));
  const parsed   = parseOrderDetails(order.details);
  const catObj   = stmts.getCategory.get(order.category);
  const catName  = catObj ? catObj.name : order.category;

  const msg = `🔔 *طلب جديد #${order.id}*\n\n`
    + `📂 القسم: ${catName}\n`
    + `👤 العميل: @${order.username || 'بدون يوزر'} (ID: \`${order.chat_id}\`)\n`
    + `📝 التفاصيل:\n${parsed.text}\n`
    + `📅 ${order.created_at}\n`
    + `📊 الحالة: ${STATUS_LABELS.pending}\n\n`
    + `👇 تحكم في حالة الطلب مباشرة:`;
...
```
- Observations:
  1. Recipient list targets `PRIMARY_ADMIN_CHAT_ID` (`5766938827`) and any database admins (`dbAdmins`).
  2. The message text does not display customer classification (`عميل جديد` vs `عميل سابق`), points balance, or free ride reminders.

### 1.4 Admin Cancellation & Status Updating Flow (`handlers/admin.js`)
- Currently at `handlers/admin.js:98-115`:
```javascript
  if (data.startsWith('set_status:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const [, orderIdStr, newStatus] = data.split(':');
    const orderId = Number(orderIdStr);
    const order   = stmts.getOrder.get(orderId);
    if (!order) return ctx.reply('⚠️ لم يتم العثور على هذا الطلب.');

    stmts.updateOrderStatus.run(newStatus, orderId);
    const label = STATUS_LABELS[newStatus] || newStatus;
    await ctx.answerCbQuery(`تم تحديث الطلب #${orderId} إلى: ${label}`).catch(() => {});

    const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
    if (notifyFn && order.chat_id) {
      ctx.telegram.sendMessage(order.chat_id, notifyFn(orderId), { parse_mode: 'Markdown' })
        .catch(err => console.error(`فشل إرسال إشعار للعميل ${order.chat_id}:`, err.message));
    }
    return;
  }
```
- In `config.js:35`:
```javascript
  cancelled:  (id) => `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب حالياً. للتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`,
```
- Observations:
  1. No points rollback is triggered when `newStatus === 'cancelled'`.
  2. No check whether `order.status` was already `'cancelled'` (risk of double deduction if clicked repeatedly).
  3. `CUSTOMER_STATUS_NOTIFICATIONS.cancelled` does not accept or display points deduction or new balance.

### 1.5 Admin Order Viewing Flow (`handlers/admin.js`)
- Currently at `handlers/admin.js:118-144`:
```javascript
  if (data === 'admin_orders') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const orders = stmts.lastOrders.all();
    if (!orders.length) return ctx.reply('لا توجد طلبات مسجلة بعد.');

    await ctx.reply(`📦 *عرض آخر 5 طلبات مع إمكانية تغيير الحالة:*\n━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });

    for (const o of orders.slice(0, 5)) {
      const parsed   = parseOrderDetails(o.details);
      const catObj   = stmts.getCategory.get(o.category);
      const catTitle = catObj ? catObj.name : o.category;
      const card = `🔖 *طلب #${o.id}* | ${catTitle}\n`
        + `👤 العميل: @${o.username || 'بدون يوزر'} (ID: \`${o.chat_id}\`)\n`
        + `📅 ${o.created_at}\n`
        + `📊 الحالة الحالية: *${STATUS_LABELS[o.status] || o.status}*\n`
        + `📝 التفاصيل:\n${parsed.text}`;
...
```
- Observations:
  1. The card does not display customer classification, points, or free ride eligibility.

### 1.6 User Profile / Main Menu Display
- Currently at `index.js:48-56`:
```javascript
bot.command(['start', 'menu'], async (ctx) => {
  stmts.resetUser.run(ctx.chat.id);
  adminMultiPhotos.delete(ctx.chat.id);
  adminNewCategory.delete(ctx.chat.id);
  await ctx.reply(
    '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها من الأقسام التالية:',
    { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
  );
});
```
- In `keyboards.js:11-15`:
```javascript
function buildMainMenuKeyboard() {
  const cats = stmts.getCategories.all();
  const buttons = cats.map(c => [Markup.button.callback(c.name, `open_cat:${c.id}`)]);
  return Markup.inlineKeyboard(buttons);
}
```
- Observations:
  1. No user points balance or progress is displayed on `/start` or `/menu`.
  2. No dedicated `/profile`, `/points`, or inline button exists for checking customer points and free ride progress.

---

## 2. Logic Chain

From the observations and authoritative user requirements in `ORIGINAL_REQUEST.md`:

1. **Step 1: Point Awarding Timing & Method**:
   - Observation 1.2 shows that when the customer confirms, `stmts.insertOrder.run` commits the order.
   - Immediately following this insert, `addPoints(chatId, POINTS_PER_ORDER)` must be called (R1).
   - Then, querying `getUserPoints(chatId)` returns the exact updated balance, and `getUserOrderStats(chatId)` returns `totalOrders` (all non-cancelled orders including this newly inserted one).

2. **Step 2: Milestone Calculations for All Order Categories**:
   - The user clarification explicitly stated: *"All order types/categories count toward the milestones... Every 15 orders (any category) = free ride from Tanta... Every 3 orders (any category) = free ride from the local town / El-Balad."*
   - Therefore, `totalOrders` (count of orders with `status != 'cancelled'`) governs both milestones:
     - Tanta free ride milestone reached: `totalOrders > 0 && totalOrders % 15 === 0`.
     - El-Balad free ride milestone reached: `totalOrders > 0 && totalOrders % 3 === 0`.
     - Tanta countdown: `15 - (totalOrders % 15)`.
     - El-Balad countdown: `3 - (totalOrders % 3)`.
   - When a milestone is reached, the celebration banner is displayed. Otherwise, the progress countdown lines are displayed.

3. **Step 3: Customer Classification**:
   - Non-cancelled orders count (`totalOrders`) includes the newly inserted order.
   - If `totalOrders <= 1` (meaning 0 prior orders): Customer is classified as `عميل جديد 🆕`.
   - If `totalOrders > 1`: Customer is classified as `عميل سابق 🌟 (إجمالي طلباته: ${totalOrders})`.
   - This badge is passed to `notifyAdmins` and displayed on `admin_orders`.

4. **Step 4: Courier / Admin New Order Notification**:
   - Observation 1.3 shows `notifyAdmins(bot, order)`.
   - `order` can pass or `notifyAdmins` can query:
     - `customerBadge`: `عميل جديد 🆕` or `عميل سابق 🌟 (إجمالي طلباته: X)`.
     - `points`: Current loyalty points balance.
     - `freeRideNotice`: If milestone triggered, highlights `🎁 تذكير للمندوب: هذا العميل يستحق مشوار مجاني من طنطا! (أكمل 15 طلباً)` and/or `🎁 تذكير للمندوب: هذا العميل يستحق مشوار مجاني من البلد! (أكمل 3 مشاوير)`.

5. **Step 5: Admin Order Cancellation & Idempotent Points Rollback**:
   - Observation 1.4 shows `set_status:*:cancelled` in `handlers/admin.js`.
   - To ensure idempotency and prevent double-deduction:
     Only trigger rollback when `newStatus === 'cancelled' && order.status !== 'cancelled'`.
   - Action: `deductPoints(order.chat_id, POINTS_PER_ORDER)`. (In SQLite: `UPDATE users SET points = MAX(0, points - ?) WHERE chat_id = ?`).
   - Query new balance `newBalance = getUserPoints(order.chat_id)`.
   - Pass `pointsDeducted = POINTS_PER_ORDER` and `newBalance` to `CUSTOMER_STATUS_NOTIFICATIONS.cancelled(orderId, pointsDeducted, newBalance)`.

6. **Step 6: Admin Order Viewing (`admin_orders`)**:
   - Observation 1.5 shows `admin_orders` iterating over `orders.slice(0, 5)`.
   - For each order `o`: query `getUserPoints(o.chat_id)` and `getUserOrderStats(o.chat_id)`.
   - Add classification badge, points balance, and free ride milestone alert (if `totalOrders % 15 === 0` or `totalOrders % 3 === 0`) to each card.

7. **Step 7: Customer Profile & Menu UI**:
   - Observation 1.6 shows `/start` and `buildMainMenuKeyboard()`.
   - Enhance `buildMainMenuKeyboard()` to include `[Markup.button.callback('⭐ نقاطي وحسابي 🎁', 'user_profile')]`.
   - In `index.js`:
     - Show current points balance in the `/start` and `/menu` greeting message.
     - Add command handlers for `/profile`, `/points`, `حسابي`, `نقاطي`.
   - In `handlers/customer.js`:
     - Handle `data === 'user_profile'` to show a full account summary (points, total completed orders, countdown to Tanta & El-Balad free rides, explanatory reward guide, and back button).

---

## 3. Caveats

1. **Category Scope**:
   - `ORIGINAL_REQUEST.md` initially suggested `cat_delivery` for the 3-order milestone, but the user's explicit follow-up ("الطلبات مش نوع محدد كل الانواع فاهم") overrode this to count **all** categories. Our design adheres strictly to the authoritative clarification: all order categories count toward both the 15-order and 3-order milestones.
2. **Order Insertion vs Query Ordering**:
   - When checking order stats immediately after `stmts.insertOrder.run`, the new order is already in the database with status `'pending'`. Therefore, `getUserOrderStats(chatId)` includes the new order.
   - Hence, `totalOrders === 1` means it is their 1st order (`عميل جديد 🆕`). `totalOrders > 1` means they are returning (`عميل سابق 🌟`).
3. **Admin Actions Idempotency**:
   - If an admin clicks `❌ إلغاء واعتذار` multiple times on the same order, checking `order.status !== 'cancelled'` prevents draining the customer's points repeatedly.
4. **No Dependencies on External Libraries**:
   - Standard telegraf markup and better-sqlite3 are sufficient. No extra npm packages needed.

---

## 4. Conclusion & Exact Proposed Implementation

### 4.1 Required Config & DB Imports
In `handlers/customer.js` and `handlers/admin.js`:
```javascript
const { POINTS_PER_ORDER } = require('../config');
const { getUserPoints, addPoints, deductPoints, getUserOrderStats } = require('../db');
```

### 4.2 Exact Arabic Templates & Code Snippets

#### A. Customer Order Confirmation (`handlers/customer.js` lines 148-170)
```javascript
  if (data === 'confirm') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', buildMainMenuKeyboard());
    }
    const username = ctx.from?.username || '';
    const result   = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
    const orderId  = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    // 1. Award loyalty points
    addPoints(chatId, POINTS_PER_ORDER);
    const currentPoints = getUserPoints(chatId);

    // 2. Query order statistics & calculate milestones
    const orderStats  = getUserOrderStats(chatId);
    const totalOrders = orderStats.totalOrders;

    const isTantaMilestone = totalOrders > 0 && (totalOrders % 15 === 0);
    const isBaladMilestone = totalOrders > 0 && (totalOrders % 3 === 0);
    const tantaRemaining   = 15 - (totalOrders % 15);
    const baladRemaining   = 3 - (totalOrders % 3);

    // 3. Build milestone & progress text
    let milestoneLines = '';
    if (isTantaMilestone && isBaladMilestone) {
      milestoneLines = `🎁 *مبروك دبل! استحققت مشوارين مجانيين:* 🎁\n`
        + `• 🎁 *مشوار مجاني من طنطا!* (إنجاز ${totalOrders} طلباً)\n`
        + `• 🛵 *مشوار مجاني من البلد!*`;
    } else if (isTantaMilestone) {
      milestoneLines = `🎁 *ألف مبروك! استحققت مشوار مجاني من طنطا!* (إنجاز ${totalOrders} طلباً) 🎁\n`
        + `🛵 باقي لك *${baladRemaining}* ${baladRemaining === 1 ? 'طلب' : 'طلبات'} لمشوار البلد القادم.`;
    } else if (isBaladMilestone) {
      milestoneLines = `🛵 *ألف مبروك! استحققت مشوار مجاني من البلد!* 🎁\n`
        + `🎯 باقي لك *${tantaRemaining}* ${tantaRemaining === 1 ? 'طلب' : 'طلبات'} للحصول على مشوار مجاني من طنطا 🎁`;
    } else {
      milestoneLines = `🎯 *تقدمك نحو المشاوير المجانية:*\n`
        + `• مشوار مجاني من البلد: باقي لك *${baladRemaining}* ${baladRemaining === 1 ? 'طلب' : 'طلبات'} 🛵\n`
        + `• مشوار مجاني من طنطا: باقي لك *${tantaRemaining}* ${tantaRemaining === 1 ? 'طلب' : 'طلبات'} 🎁`;
    }

    // 4. Send customer confirmation message
    const confirmMsg = `✅ *تم تأكيد طلبك بنجاح!*\n\n`
      + `🔖 رقم طلبك: *#${orderId}*\n\n`
      + `⭐ *نقاط الولاء:*\n`
      + `• حصلت على: *+${POINTS_PER_ORDER} نقاط* لهذا الطلب\n`
      + `• إجمالي رصيدك الحالي: *${currentPoints} نقطة*\n\n`
      + `${milestoneLines}\n\n`
      + `سيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لثقتك بنا! 🙏❤️`;

    await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });

    // 5. Customer classification for admin/courier notification
    const customerBadge = totalOrders <= 1
      ? 'عميل جديد 🆕'
      : `عميل سابق 🌟 (إجمالي طلباته: ${totalOrders})`;

    // 6. Notification payload for admins & courier
    ctx.orderToNotify = {
      id: orderId,
      chat_id: chatId,
      username,
      category: user.selected_category,
      details: user.pending_details,
      created_at: new Date().toLocaleString('ar-EG'),
      customerBadge,
      points: currentPoints,
      totalOrders,
      isTantaMilestone,
      isBaladMilestone,
    };
    return;
  }
```

#### B. Admin & Primary Courier New Order Notification (`handlers/admin.js:14-43`)
```javascript
function notifyAdmins(bot, order) {
  const dbAdmins = stmts.getAdmins.all().map(a => a.chat_id);
  const targets  = Array.from(new Set([PRIMARY_ADMIN_CHAT_ID, ...dbAdmins]));
  const parsed   = parseOrderDetails(order.details);
  const catObj   = stmts.getCategory.get(order.category);
  const catName  = catObj ? catObj.name : order.category;

  // Retrieve customer data if not already attached on order object
  const points = order.points !== undefined ? order.points : getUserPoints(order.chat_id);
  const totalOrders = order.totalOrders !== undefined ? order.totalOrders : getUserOrderStats(order.chat_id).totalOrders;
  const customerBadge = order.customerBadge || (totalOrders <= 1 ? 'عميل جديد 🆕' : `عميل سابق 🌟 (إجمالي طلباته: ${totalOrders})`);

  let freeRideNotice = '';
  if (totalOrders > 0 && totalOrders % 15 === 0) {
    freeRideNotice += `🎁 *تذكير للمندوب:* هذا العميل يستحق مشوار مجاني من طنطا! (أكمل ${totalOrders} طلباً) 🎁\n`;
  }
  if (totalOrders > 0 && totalOrders % 3 === 0) {
    freeRideNotice += `🛵 *تذكير للمندوب:* هذا العميل يستحق مشوار مجاني من البلد! (أكمل ${totalOrders} مشاوير) 🎁\n`;
  }

  const msg = `🔔 *طلب جديد #${order.id}*\n\n`
    + `📂 القسم: ${catName}\n`
    + `👤 العميل: @${order.username || 'بدون يوزر'} (ID: \`${order.chat_id}\`)\n`
    + `🏷️ تصنيف العميل: ${customerBadge}\n`
    + `⭐ نقاط الولاء: *${points} نقطة*\n`
    + (freeRideNotice ? `\n${freeRideNotice}` : '')
    + `📝 التفاصيل:\n${parsed.text}\n`
    + `📅 ${order.created_at}\n`
    + `📊 الحالة: ${STATUS_LABELS.pending}\n\n`
    + `👇 تحكم في حالة الطلب مباشرة:`;

  for (const adminId of targets) {
    if (parsed.photoId) {
      bot.telegram.sendPhoto(adminId, parsed.photoId, {
        caption: msg, parse_mode: 'Markdown',
        ...getOrderActionKeyboard(order.id),
      }).catch(() => bot.telegram.sendMessage(adminId, msg, {
        parse_mode: 'Markdown', ...getOrderActionKeyboard(order.id),
      }).catch(() => {}));
    } else {
      bot.telegram.sendMessage(adminId, msg, {
        parse_mode: 'Markdown', ...getOrderActionKeyboard(order.id),
      }).catch(() => {});
    }
  }
}
```

#### C. Admin Order Cancellation & Points Rollback (`handlers/admin.js:98-115` & `config.js`)
In `handlers/admin.js`:
```javascript
  if (data.startsWith('set_status:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const [, orderIdStr, newStatus] = data.split(':');
    const orderId = Number(orderIdStr);
    const order   = stmts.getOrder.get(orderId);
    if (!order) return ctx.reply('⚠️ لم يتم العثور على هذا الطلب.');

    // Check if transitioning to cancelled to rollback points idempotently
    const wasNotCancelled = order.status !== 'cancelled';
    let pointsDeducted = 0;
    let newBalance = 0;

    if (newStatus === 'cancelled' && wasNotCancelled) {
      deductPoints(order.chat_id, POINTS_PER_ORDER);
      pointsDeducted = POINTS_PER_ORDER;
      newBalance = getUserPoints(order.chat_id);
    }

    stmts.updateOrderStatus.run(newStatus, orderId);
    const label = STATUS_LABELS[newStatus] || newStatus;
    await ctx.answerCbQuery(`تم تحديث الطلب #${orderId} إلى: ${label}`).catch(() => {});

    const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
    if (notifyFn && order.chat_id) {
      const customerMsg = newStatus === 'cancelled'
        ? notifyFn(orderId, pointsDeducted, newBalance)
        : notifyFn(orderId);

      ctx.telegram.sendMessage(order.chat_id, customerMsg, { parse_mode: 'Markdown' })
        .catch(err => console.error(`فشل إرسال إشعار للعميل ${order.chat_id}:`, err.message));
    }
    return;
  }
```

In `config.js` (`CUSTOMER_STATUS_NOTIFICATIONS.cancelled`):
```javascript
  cancelled: (id, pointsDeducted, currentBalance) => {
    let msg = `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب من قبل الإدارة.`;
    if (pointsDeducted) {
      msg += `\n\n⚠️ *تحديث رصيد النقاط:*\n• تم خصم: *-${pointsDeducted} نقطة*\n• رصيدك الحالي: *${currentBalance} نقطة*`;
    }
    msg += `\n\nللتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`;
    return msg;
  },
```

#### D. Admin Order Cards (`handlers/admin.js:118-144` `admin_orders`)
```javascript
  if (data === 'admin_orders') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const orders = stmts.lastOrders.all();
    if (!orders.length) return ctx.reply('لا توجد طلبات مسجلة بعد.');

    await ctx.reply(`📦 *عرض آخر 5 طلبات مع إمكانية تغيير الحالة:*\n━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });

    for (const o of orders.slice(0, 5)) {
      const parsed   = parseOrderDetails(o.details);
      const catObj   = stmts.getCategory.get(o.category);
      const catTitle = catObj ? catObj.name : o.category;

      const userPoints  = getUserPoints(o.chat_id);
      const stats       = getUserOrderStats(o.chat_id);
      const totalOrders = stats.totalOrders;
      const customerBadge = totalOrders <= 1
        ? 'عميل جديد 🆕'
        : `عميل سابق 🌟 (إجمالي طلباته: ${totalOrders})`;

      let freeRideBadge = '';
      if (totalOrders > 0 && totalOrders % 15 === 0) {
        freeRideBadge += `🎁 يستحق مشوار مجاني من طنطا! (طلب #${totalOrders})\n`;
      }
      if (totalOrders > 0 && totalOrders % 3 === 0) {
        freeRideBadge += `🛵 يستحق مشوار مجاني من البلد! (طلب #${totalOrders})\n`;
      }

      const card = `🔖 *طلب #${o.id}* | ${catTitle}\n`
        + `👤 العميل: @${o.username || 'بدون يوزر'} (ID: \`${o.chat_id}\`)\n`
        + `🏷️ تصنيف: ${customerBadge}\n`
        + `⭐ نقاط الولاء: *${userPoints} نقطة*\n`
        + (freeRideBadge ? `${freeRideBadge}` : '')
        + `📅 ${o.created_at}\n`
        + `📊 الحالة الحالية: *${STATUS_LABELS[o.status] || o.status}*\n`
        + `📝 التفاصيل:\n${parsed.text}`;

      if (parsed.photoId) {
        await ctx.replyWithPhoto(parsed.photoId, {
          caption: card, parse_mode: 'Markdown', ...getOrderActionKeyboard(o.id),
        }).catch(() => ctx.reply(card, { parse_mode: 'Markdown', ...getOrderActionKeyboard(o.id) }));
      } else {
        await ctx.reply(card, { parse_mode: 'Markdown', ...getOrderActionKeyboard(o.id) }).catch(() => {});
      }
    }
    return;
  }
```

#### E. User Profile & Main Menu (`keyboards.js`, `index.js`, `handlers/customer.js`)
In `keyboards.js`:
```javascript
function buildMainMenuKeyboard() {
  const cats = stmts.getCategories.all();
  const buttons = cats.map(c => [Markup.button.callback(c.name, `open_cat:${c.id}`)]);
  buttons.push([Markup.button.callback('⭐ نقاطي وحسابي 🎁', 'user_profile')]);
  return Markup.inlineKeyboard(buttons);
}
```

In `handlers/customer.js` (`handleCustomerCallback`):
```javascript
  if (data === 'user_profile') {
    const points = getUserPoints(chatId);
    const stats  = getUserOrderStats(chatId);
    const total  = stats.totalOrders;
    const remBalad = total > 0 && total % 3 === 0 ? 0 : (3 - (total % 3));
    const remTanta = total > 0 && total % 15 === 0 ? 0 : (15 - (total % 15));

    const profileText = `👤 *ملف حسابك في دليفري طنطا*\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `⭐ *رصيد نقاط الولاء:* *${points} نقطة*\n`
      + `📦 *إجمالي طلباتك المؤكدة:* *${total} طلب*\n\n`
      + `🎁 *مكافآت المشاوير المجانية:*\n`
      + `• 🛵 *مشوار مجاني من البلد:* ${remBalad === 0 ? '🎉 *مؤهل لمشوار مجاني الآن!*' : `باقي لك *${remBalad}* طلبات`}\n`
      + `• 🎁 *مشوار مجاني من طنطا:* ${remTanta === 0 ? '🎉 *مؤهل لمشوار مجاني الآن!*' : `باقي لك *${remTanta}* طلبات`}\n\n`
      + `💡 *كيف تكسب المكافآت؟*\n`
      + `• كل طلب تقوم بتأكيده يمنحك *+${POINTS_PER_ORDER} نقاط ولاء*.\n`
      + `• كل *3 طلبات* تحصل على مشوار مجاني من البلد 🛵.\n`
      + `• كل *15 طلباً* تحصل على مشوار مجاني من طنطا 🎁.`;

    const { Markup } = require('telegraf');
    return ctx.reply(profileText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_menu')],
      ]),
    });
  }
```

In `index.js` (`/start`, `/menu`, `/profile`, text handlers):
```javascript
bot.command(['start', 'menu'], async (ctx) => {
  const chatId = ctx.chat.id;
  stmts.resetUser.run(chatId);
  adminMultiPhotos.delete(chatId);
  adminNewCategory.delete(chatId);
  const points = getUserPoints(chatId);
  await ctx.reply(
    `👋 أهلاً بك في *بوت دليفري طنطا*!\n\n`
    + `⭐ رصيد نقاطك: *${points} نقطة*\n\n`
    + `اختر الخدمة التي تريدها من الأقسام التالية:`,
    { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
  );
});

bot.command(['profile', 'points'], async (ctx) => {
  const chatId = ctx.chat.id;
  const points = getUserPoints(chatId);
  const stats  = getUserOrderStats(chatId);
  const total  = stats.totalOrders;
  const remBalad = total > 0 && total % 3 === 0 ? 0 : (3 - (total % 3));
  const remTanta = total > 0 && total % 15 === 0 ? 0 : (15 - (total % 15));

  const text = `👤 *ملف حسابك في دليفري طنطا*\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `⭐ *رصيد نقاط الولاء:* *${points} نقطة*\n`
    + `📦 *إجمالي طلباتك المؤكدة:* *${total} طلب*\n\n`
    + `🎁 *مكافآت المشاوير المجانية:*\n`
    + `• 🛵 *مشوار مجاني من البلد:* ${remBalad === 0 ? '🎉 *مؤهل لمشوار مجاني الآن!*' : `باقي لك *${remBalad}* طلبات`}\n`
    + `• 🎁 *مشوار مجاني من طنطا:* ${remTanta === 0 ? '🎉 *مؤهل لمشوار مجاني الآن!*' : `باقي لك *${remTanta}* طلبات`}`;

  return ctx.reply(text, { parse_mode: 'Markdown', ...buildMainMenuKeyboard() });
});
```

---

## 5. Verification Method

To verify these findings and implementations:

1. **Syntax Check**:
   ```bash
   node --check /home/engebrahimahmed/new-whatsapp-project/index.js
   node --check /home/engebrahimahmed/new-whatsapp-project/handlers/customer.js
   node --check /home/engebrahimahmed/new-whatsapp-project/handlers/admin.js
   node --check /home/engebrahimahmed/new-whatsapp-project/keyboards.js
   node --check /home/engebrahimahmed/new-whatsapp-project/config.js
   ```

2. **Database Helper Contract Validation**:
   Inspect `db.js` to ensure the following functions are exported and callable:
   - `getUserPoints(chatId)` -> returns integer points (default 0).
   - `addPoints(chatId, amount)` -> increments points by amount.
   - `deductPoints(chatId, amount)` -> decrements points by amount (clamped to 0).
   - `getUserOrderStats(chatId)` -> returns `{ totalOrders }` counting all non-cancelled orders (`status != 'cancelled'`).

3. **Lifecycle Simulation Script**:
   Create and execute a standalone test script that simulates:
   - Inserting an order and verifying `addPoints` adds 10 points.
   - Verifying `totalOrders` increments by 1.
   - Verifying classification returns `عميل جديد 🆕` on order 1, and `عميل سابق 🌟` on order 2+.
   - Verifying milestone triggers at order 3 (El-Balad free ride) and order 15 (Tanta free ride).
   - Cancelling order via `set_status:*:cancelled` and verifying `deductPoints` reduces points by 10 (clamped to 0) and `totalOrders` excludes the cancelled order.

4. **Invalidation Conditions**:
   - If `getUserOrderStats` filters by category rather than counting all confirmed orders, the clarification condition ("الطلبات مش نوع محدد كل الانواع") would be invalidated.
   - If points can go below 0 upon cancellation, the clamping invariant would be violated.
