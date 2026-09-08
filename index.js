const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');

// Constants & Hardcoded Config
const BOT_TOKEN  = process.env.BOT_TOKEN || '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DB_PATH    = process.env.DB_PATH || './delivery_bot.db';
const PORT       = process.env.PORT || 3000;

// HTTP Health Check Server (Required for Render Web Services & Cloud Deployments)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🛵 بوت دليفري طنطا يعمل بنجاح في الخلفية!');
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 سيرفر فحص الحالة يعمل بنجاح على المنفذ: ${PORT}`);
});

// Database Initialization
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  chat_id           INTEGER PRIMARY KEY,
  state             TEXT    NOT NULL DEFAULT 'IDLE',
  selected_category TEXT    DEFAULT NULL,
  pending_details   TEXT    DEFAULT NULL,
  is_admin          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  username    TEXT    DEFAULT '',
  category    TEXT    NOT NULL,
  details     TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

// Prepared Statements
const stmts = {
  getUser:     db.prepare('SELECT * FROM users WHERE chat_id = ?'),
  upsertUser:  db.prepare(`
    INSERT INTO users (chat_id, state) VALUES (?, 'IDLE')
    ON CONFLICT(chat_id) DO NOTHING
  `),
  setState:    db.prepare('UPDATE users SET state = ? WHERE chat_id = ?'),
  setCategory: db.prepare('UPDATE users SET selected_category = ?, state = ? WHERE chat_id = ?'),
  setPending:  db.prepare('UPDATE users SET pending_details = ?, state = ? WHERE chat_id = ?'),
  resetUser:   db.prepare(`
    UPDATE users SET state='IDLE', selected_category=NULL, pending_details=NULL
    WHERE chat_id = ?
  `),
  setAdmin:    db.prepare('UPDATE users SET is_admin = ? WHERE chat_id = ?'),
  insertOrder: db.prepare(`
    INSERT INTO orders (chat_id, username, category, details)
    VALUES (?, ?, ?, ?)
  `),
  getAdmins:   db.prepare('SELECT chat_id FROM users WHERE is_admin = 1'),
  lastOrders:  db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10'),
  countOrders: db.prepare('SELECT COUNT(*) as total FROM orders'),
  countPending:db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='pending'"),
};

// Keyboards and Prompts
const CATEGORY_PROMPTS = {
  cat_delivery:     '🛵 *دليفري وطلبات خاصة*\n\nاكتب تفاصيل طلبك كاملة:\n• العنوان (من أين؟ إلى أين؟)\n• وصف ما تريد إحضاره\n• أي ملاحظات إضافية',
  cat_restaurants:  '🍔 *مطاعم طنطا*\n\nاكتب طلبك:\n• اسم المطعم (لو عندك تفضيل)\n• الأصناف المطلوبة\n• عنوان التوصيل',
  cat_shopping:     '🛒 *تسوق من طنطا*\n\nاكتب تفاصيل مشترياتك:\n• اسم المنتج أو المحل\n• الكمية\n• عنوان التوصيل',
  cat_pharmacy:     '💊 *صيدليات وأدوية طنطا*\n\nاكتب طلب الدواء:\n• اسم الدواء أو الوصفة\n• عنوان التوصيل\n• رقم التواصل (اختياري)',
  cat_shops:        '🏪 *محلات المنطقة*\n\nاكتب ما تريده من المحلات:\n• اسم المحل أو المنطقة\n• المنتج المطلوب\n• عنوان التوصيل',
  cat_support:      '📞 *خدمة العملاء*\n\nاكتب استفسارك أو مشكلتك وسيتواصل معك فريقنا في أقرب وقت.',
};

const CATEGORY_LABELS = {
  cat_delivery:    '🛵 دليفري وطلبات خاصة',
  cat_restaurants: '🍔 مطاعم طنطا',
  cat_shopping:    '🛒 تسوق من طنطا',
  cat_pharmacy:    '💊 صيدليات وأدوية طنطا',
  cat_shops:       '🏪 محلات المنطقة',
  cat_support:     '📞 خدمة العملاء',
};

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🛵 دليفري وطلبات خاصة', 'cat_delivery')],
  [Markup.button.callback('🍔 مطاعم طنطا',          'cat_restaurants')],
  [Markup.button.callback('🛒 تسوق من طنطا',        'cat_shopping')],
  [Markup.button.callback('💊 صيدليات وأدوية طنطا', 'cat_pharmacy')],
  [Markup.button.callback('🏪 محلات المنطقة',       'cat_shops')],
  [Markup.button.callback('📞 خدمة العملاء',        'cat_support')],
]);

const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد الطلب',  'confirm')],
  [Markup.button.callback('✏️ تعديل التفاصيل', 'edit')],
  [Markup.button.callback('❌ إلغاء',          'cancel')],
]);

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📦 آخر 10 طلبات',  'admin_orders')],
  [Markup.button.callback('📊 إحصائيات',       'admin_stats')],
  [Markup.button.callback('🚪 تسجيل الخروج',   'admin_logout')],
]);

// Helper: Notify Admins
function notifyAdmins(botInstance, order) {
  const admins = stmts.getAdmins.all();
  const msg = `🔔 *طلب جديد #${order.id}*\n\n`
    + `📂 القسم: ${CATEGORY_LABELS[order.category] || order.category}\n`
    + `👤 العميل: @${order.username || 'بدون يوزر'} (${order.chat_id})\n`
    + `📝 التفاصيل:\n${order.details}\n`
    + `📅 ${order.created_at}`;

  for (const admin of admins) {
    botInstance.telegram.sendMessage(admin.chat_id, msg, { parse_mode: 'Markdown' })
      .catch(() => {});
  }
}

// Bot Instance
const bot = new Telegraf(BOT_TOKEN);

// Middleware: Session tracking per user
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();
  stmts.upsertUser.run(chatId);
  ctx.dbUser = stmts.getUser.get(chatId);
  return next();
});

// Admin handler logic
async function triggerAdminAuth(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (user && user.is_admin === 1) {
    stmts.setState.run('ADMIN_PANEL', chatId);
    return ctx.reply('👑 مرحباً في لوحة الإدارة:', adminKeyboard);
  }
  stmts.setState.run('ADMIN_AUTH', chatId);
  await ctx.reply('🔐 أدخل كلمة مرور الإدارة:');
}

// Command: /start & /menu
bot.command(['start', 'menu'], async (ctx) => {
  stmts.resetUser.run(ctx.chat.id);
  await ctx.reply(
    '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها:',
    { parse_mode: 'Markdown', ...mainMenuKeyboard }
  );
});

// Command: /admin & /ادمن
bot.command(['admin', 'ادمن'], async (ctx) => {
  await triggerAdminAuth(ctx);
});

// Command: /id
bot.command(['id', 'myid'], async (ctx) => {
  await ctx.reply(`🆔 معرف حسابك (Chat ID): <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
});

// Text Message Router
bot.on('text', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const text = ctx.message.text.trim();
  const lower = text.toLowerCase();
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (!user) return;

  // حماية: دعم نصوص الأوامر المكتوبة بدون سلاش
  if (['/admin', 'admin', 'ادمن', 'الادمن', 'الأدمن', '/ادمن'].includes(lower)) {
    return triggerAdminAuth(ctx);
  }

  if (['/start', 'start', 'ابدأ', 'ابدا', 'القائمة', 'menu'].includes(lower)) {
    stmts.resetUser.run(chatId);
    return ctx.reply(
      '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها:',
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
  }

  // رفض رسائل طويلة جداً
  if (text.length > 1000) {
    return ctx.reply('⚠️ التفاصيل طويلة جداً (الحد 1000 حرف)، يرجى التلخيص.');
  }

  switch (user.state) {
    case 'IDLE':
      return ctx.reply('👆 اختر من القائمة أو اكتب /start', mainMenuKeyboard);

    case 'WAITING_DETAILS': {
      stmts.setPending.run(text, 'CONFIRMING', chatId);
      const label = CATEGORY_LABELS[user.selected_category] || user.selected_category || '';
      return ctx.reply(
        `📋 *ملخص طلبك:*\n\n📂 القسم: ${label}\n📝 التفاصيل:\n${text}\n\nهل تريد تأكيد الطلب؟`,
        { parse_mode: 'Markdown', ...confirmKeyboard }
      );
    }

    case 'CONFIRMING':
      return ctx.reply('👆 الرجاء الضغط على أحد الأزرار أدناه.', confirmKeyboard);

    case 'ADMIN_AUTH': {
      if (text === ADMIN_PASS) {
        stmts.setAdmin.run(1, chatId);
        stmts.setState.run('ADMIN_PANEL', chatId);
        return ctx.reply('✅ تم تسجيل الدخول كمدير!\n\n👑 لوحة الإدارة:', adminKeyboard);
      } else {
        stmts.setState.run('IDLE', chatId);
        return ctx.reply('❌ كلمة مرور خاطئة.');
      }
    }

    case 'ADMIN_PANEL':
      return ctx.reply('👑 لوحة الإدارة:', adminKeyboard);

    default:
      stmts.resetUser.run(chatId);
      return ctx.reply('حدث خطأ، تم إعادة تشغيل الجلسة.', mainMenuKeyboard);
  }
});

// Callback Query Router
bot.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const data = ctx.callbackQuery.data;
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (!user) return;

  // اختيار قسم
  if (data.startsWith('cat_')) {
    stmts.setCategory.run(data, 'WAITING_DETAILS', chatId);
    const prompt = CATEGORY_PROMPTS[data];
    if (!prompt) {
      stmts.resetUser.run(chatId);
      return ctx.reply('قسم غير معروف.', mainMenuKeyboard);
    }
    return ctx.reply(prompt, { parse_mode: 'Markdown' });
  }

  // تأكيد الطلب
  if (data === 'confirm') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', mainMenuKeyboard);
    }
    const username = ctx.from?.username || '';
    const result = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
    const orderId = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    await ctx.reply(`✅ *تم تأكيد طلبك بنجاح!*\n\n🔖 رقم طلبك: *#${orderId}*\n\nسيتواصل معك فريقنا قريباً. شكراً! 🙏`, { parse_mode: 'Markdown' });

    // إشعار الأدمن
    const order = {
      id: orderId,
      chat_id: chatId,
      username,
      category: user.selected_category,
      details: user.pending_details,
      created_at: new Date().toLocaleString('ar-EG')
    };
    notifyAdmins(bot, order);
    return;
  }

  // تعديل
  if (data === 'edit') {
    stmts.setState.run('WAITING_DETAILS', chatId);
    const label = CATEGORY_LABELS[user.selected_category] || '';
    return ctx.reply(`✏️ أعد إدخال تفاصيل طلبك (القسم: ${label}):`);
  }

  // إلغاء
  if (data === 'cancel') {
    stmts.resetUser.run(chatId);
    return ctx.reply('❌ تم إلغاء الطلب.', mainMenuKeyboard);
  }

  // لوحة الإدارة: عرض الطلبات
  if (data === 'admin_orders') {
    if (user.is_admin !== 1) return ctx.reply('⛔ غير مصرح.');
    const orders = stmts.lastOrders.all();
    if (!orders.length) return ctx.reply('لا توجد طلبات بعد.');
    const lines = orders.map(o =>
      `🔖 #${o.id} | ${CATEGORY_LABELS[o.category] || o.category}\n`
      + `👤 @${o.username || 'بدون يوزر'} | 📅 ${o.created_at}\n`
      + `📝 ${o.details.substring(0, 100)}${o.details.length > 100 ? '...' : ''}`
    );
    return ctx.reply(`📦 *آخر 10 طلبات:*\n━━━━━━━━━━━━━━━━\n${lines.join('\n─────────────────\n')}`, { parse_mode: 'Markdown' });
  }

  // لوحة الإدارة: الإحصائيات
  if (data === 'admin_stats') {
    if (user.is_admin !== 1) return ctx.reply('⛔ غير مصرح.');
    const total = stmts.countOrders.get().total;
    const pending = stmts.countPending.get().total;
    return ctx.reply(`📊 *إحصائيات البوت:*\n━━━━━━━━━━━━━━━━━\n📦 إجمالي الطلبات: ${total}\n⏳ طلبات معلقة: ${pending}`, { parse_mode: 'Markdown' });
  }

  // لوحة الإدارة: تسجيل الخروج
  if (data === 'admin_logout') {
    stmts.setAdmin.run(0, chatId);
    stmts.setState.run('IDLE', chatId);
    return ctx.reply('🚪 تم تسجيل الخروج.', mainMenuKeyboard);
  }

  // Fallback
  stmts.resetUser.run(chatId);
  ctx.reply('حدث خطأ، ابدأ من جديد.', mainMenuKeyboard);
});

// Global Error Handling
bot.catch((err, ctx) => {
  console.error(`[Bot Error] update_id=${ctx?.update?.update_id}`, err);
  ctx?.reply('حدث خطأ، يرجى المحاولة مرة أخرى.').catch(() => {});
});

// Launch & Graceful Shutdown
if (require.main === module) {
  bot.launch({ dropPendingUpdates: true })
    .then(() => {
      console.log('🚀 Tanta Delivery Bot is running...');
    })
    .catch((err) => {
      console.error('Failed to launch bot:', err);
    });

  process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
  });
}

module.exports = { bot, db, stmts, CATEGORY_LABELS, CATEGORY_PROMPTS };
