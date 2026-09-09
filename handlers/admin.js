// ==========================================
// handlers/admin.js — لوحة الأدمن الرئيسية
// يشمل: المصادقة، الطلبات، الإحصائيات، تغيير حالة الطلب
// لو عايز تضيف ميزة جديدة للأدمن (مش مطاعم أو أقسام)، ابدأ هنا
// ==========================================

const { PRIMARY_ADMIN_CHAT_ID, ADMIN_PASS, STATUS_LABELS, CUSTOMER_STATUS_NOTIFICATIONS } = require('../config');
const { stmts } = require('../db');
const { parseOrderDetails } = require('../db');
const { adminKeyboard, getOrderActionKeyboard, buildMainMenuKeyboard } = require('../keyboards');

// ─── إشعار الأدمن عند وصول طلب جديد ────────────────────────────────────────

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

// ─── دخول لوحة الأدمن (من أمر أو زر) ───────────────────────────────────────

async function triggerAdminAuth(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  if (chatId === PRIMARY_ADMIN_CHAT_ID) {
    stmts.setAdmin.run(1, chatId);
    stmts.setState.run('ADMIN_PANEL', chatId);
    return ctx.reply('👑 أهلاً بك يا كابتن! هذه لوحة تحكم الإدارة والمناديب:', adminKeyboard);
  }
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (user && user.is_admin === 1) {
    stmts.setState.run('ADMIN_PANEL', chatId);
    return ctx.reply('👑 مرحباً في لوحة تحكم الإدارة والمناديب:', adminKeyboard);
  }
  stmts.setState.run('ADMIN_AUTH', chatId);
  await ctx.reply('🔐 أدخل كلمة مرور الإدارة:');
}

// ─── معالجة رسائل النصية الخاصة بالأدمن ─────────────────────────────────────
// يُستدعى من الـ text handler الرئيسي في index.js

async function handleAdminText(ctx, next) {
  const chatId = ctx.chat?.id;
  const text   = ctx.message.text.trim();
  const user   = ctx.dbUser || stmts.getUser.get(chatId);

  if (user.state === 'ADMIN_AUTH') {
    if (text === ADMIN_PASS || chatId === PRIMARY_ADMIN_CHAT_ID) {
      stmts.setAdmin.run(1, chatId);
      stmts.setState.run('ADMIN_PANEL', chatId);
      return ctx.reply('✅ تم تسجيل الدخول كمدير بنجاح!\n\n👑 لوحة الإدارة:', adminKeyboard);
    }
    stmts.setState.run('IDLE', chatId);
    return ctx.reply('❌ كلمة مرور خاطئة.');
  }

  if (user.state === 'ADMIN_PANEL') {
    return ctx.reply('👑 لوحة الإدارة:', adminKeyboard);
  }

  return next();
}

// ─── معالجة الـ callback_query الخاصة بالأدمن ───────────────────────────────

async function handleAdminCallback(ctx, next) {
  const chatId      = ctx.chat?.id;
  const data        = ctx.callbackQuery.data;
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // ── تغيير حالة الطلب مع إشعار العميل ──
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

  // ── عرض آخر الطلبات ──
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

  // ── الإحصائيات الشاملة ──
  if (data === 'admin_stats') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const statsMsg = `📊 *إحصائيات بوت دليفري طنطا:*
━━━━━━━━━━━━━━━━━
👥 إجمالي العملاء المسجلين: ${stmts.countUsers.get().total}
📂 إجمالي الأقسام والخدمات: ${stmts.countCategories.get().total}
🏪 إجمالي المحلات والعناصر: ${stmts.countAllItems.get().total}
📦 إجمالي كافة الطلبات: ${stmts.countOrders.get().total}
─────────────────
⏳ طلبات قيد الانتظار: ${stmts.countPending.get().total}
🛵 طلبات جاري توصيلها: ${stmts.countDelivering.get().total}
✅ طلبات تم تسليمها بنجاح: ${stmts.countCompleted.get().total}
❌ طلبات ملغاة: ${stmts.countCancelled.get().total}`;
    return ctx.reply(statsMsg, { parse_mode: 'Markdown', ...adminKeyboard });
  }

  // ── رجوع للوحة الإدارة ──
  if (data === 'admin_panel_back') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_PANEL', chatId);
    return ctx.reply('👑 لوحة تحكم الإدارة:', adminKeyboard);
  }

  // ── تسجيل الخروج ──
  if (data === 'admin_logout') {
    stmts.setAdmin.run(0, chatId);
    stmts.setState.run('IDLE', chatId);
    return ctx.reply('🚪 تم تسجيل الخروج بنجاح.', buildMainMenuKeyboard());
  }

  return next();
}

module.exports = { notifyAdmins, triggerAdminAuth, handleAdminText, handleAdminCallback };
