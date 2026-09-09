// ==========================================
// index.js — نقطة الدخول الرئيسية للبوت
// هنا بس: HTTP server، تسجيل الـ handlers، تشغيل البوت
// لو عايز تضيف ميزة جديدة: اذهب للملف المناسب في handlers/
// ==========================================

const http     = require('http');
const { Telegraf } = require('telegraf');

const { BOT_TOKEN, PORT, PRIMARY_ADMIN_CHAT_ID } = require('./config');
const { stmts, adminMultiPhotos, adminNewCategory } = require('./db');
const { buildMainMenuKeyboard } = require('./keyboards');
const { notifyAdmins, triggerAdminAuth, handleAdminText, handleAdminCallback } = require('./handlers/admin');
const { handleCustomerPhoto, handleCustomerText, handleCustomerCallback } = require('./handlers/customer');
const { handleRestaurantPhoto, handleRestaurantText, handleRestaurantCallback } = require('./handlers/restaurants');
const { handleCategoryPhoto, handleCategoryText, handleCategoryCallback } = require('./handlers/categories');

// ─── HTTP Health Check (مطلوب لـ Render) ─────────────────────────────────────

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🛵 بوت دليفري طنطا يعمل بنجاح في الخلفية!');
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 سيرفر فحص الحالة يعمل على المنفذ: ${PORT}`);
  });
}

// ─── Bot Instance ─────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

// ─── Middleware: تسجيل كل مستخدم وترقية الأدمن الأساسي ────────────────────────

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();
  stmts.upsertUser.run(chatId);
  if (chatId === PRIMARY_ADMIN_CHAT_ID) stmts.setAdmin.run(1, chatId);
  ctx.dbUser = stmts.getUser.get(chatId);
  return next();
});

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command(['start', 'menu'], async (ctx) => {
  stmts.resetUser.run(ctx.chat.id);
  adminMultiPhotos.delete(ctx.chat.id);
  adminNewCategory.delete(ctx.chat.id);
  await ctx.reply(
    '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها من الأقسام التالية:',
    { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
  );
});

bot.command(['admin', 'ادمن'], (ctx) => triggerAdminAuth(ctx));
bot.command(['id', 'myid'], (ctx) =>
  ctx.reply(`🆔 معرف حسابك (Chat ID): <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
);

// ─── Photo Handler (بالترتيب: مطاعم → أقسام → عميل) ─────────────────────────

bot.on('photo', async (ctx, next) => {
  await handleRestaurantPhoto(ctx, () =>
    handleCategoryPhoto(ctx, () =>
      handleCustomerPhoto(ctx, next)
    )
  );
});

// ─── Text Handler ─────────────────────────────────────────────────────────────

bot.on('text', async (ctx, next) => {
  const text  = ctx.message.text.trim();
  const lower = text.toLowerCase();

  // دعم الأوامر بدون سلاش
  if (['/admin', 'admin', 'ادمن', 'الادمن', 'الأدمن', '/ادمن'].includes(lower))
    return triggerAdminAuth(ctx);

  if (['/start', 'start', 'ابدأ', 'ابدا', 'القائمة', 'menu'].includes(lower)) {
    stmts.resetUser.run(ctx.chat.id);
    adminMultiPhotos.delete(ctx.chat.id);
    adminNewCategory.delete(ctx.chat.id);
    return ctx.reply(
      '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها من الأقسام التالية:',
      { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
    );
  }

  // حماية: رفض رسائل طويلة جداً
  if (text.length > 1000) return ctx.reply('⚠️ التفاصيل طويلة جداً (الحد 1000 حرف)، يرجى التلخيص.');

  // تسلسل الـ handlers (مطاعم → أقسام → أدمن → عميل → fallback)
  await handleRestaurantText(ctx, () =>
    handleCategoryText(ctx, () =>
      handleAdminText(ctx, () =>
        handleCustomerText(ctx, () => {
          // fallback: حالة غير معروفة
          stmts.resetUser.run(ctx.chat.id);
          return ctx.reply('حدث خطأ، تم إعادة تشغيل الجلسة.', buildMainMenuKeyboard());
        })
      )
    )
  );
});

// ─── Callback Query Handler (بالترتيب: أدمن → مطاعم → أقسام → عميل) ─────────

bot.on('callback_query', async (ctx, next) => {
  await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  await handleAdminCallback(ctx, () =>
    handleRestaurantCallback(ctx, () =>
      handleCategoryCallback(ctx, () =>
        handleCustomerCallback(ctx, () => {
          // fallback: callback غير معروف
          stmts.resetUser.run(chatId);
          return ctx.reply('حدث خطأ، ابدأ من جديد.', buildMainMenuKeyboard());
        })
      )
    )
  );

  // إشعار الأدمن بعد تأكيد طلب العميل
  if (ctx.orderToNotify) notifyAdmins(bot, ctx.orderToNotify);
});

// ─── Error Handling ───────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[Bot Error] update_id=${ctx?.update?.update_id}`, err);
  ctx?.reply('حدث خطأ، يرجى المحاولة مرة أخرى.').catch(() => {});
});

// ─── Launch & Graceful Shutdown ───────────────────────────────────────────────

if (require.main === module) {
  bot.launch({ dropPendingUpdates: true })
    .then(() => console.log('🚀 Tanta Delivery Bot is running...'))
    .catch(err => { console.error('Failed to launch bot:', err); process.exit(1); });

  process.once('SIGINT',  () => { bot.stop('SIGINT');  server.close(); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
}

module.exports = { bot, stmts, buildMainMenuKeyboard };
