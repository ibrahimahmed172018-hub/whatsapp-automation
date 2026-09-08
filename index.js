const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');

// Constants & Hardcoded Config
const BOT_TOKEN              = process.env.BOT_TOKEN || '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
const ADMIN_PASS             = process.env.ADMIN_PASS || 'admin123';
const DB_PATH                = process.env.DB_PATH || './delivery_bot.db';
const PORT                   = process.env.PORT || 3000;
const PRIMARY_ADMIN_CHAT_ID  = 5766938827; // حساب المندوب والأدمن الأساسي (رقم 01143264206)

// HTTP Health Check Server (Required for Render Web Services & Cloud Deployments)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🛵 بوت دليفري طنطا يعمل بنجاح في الخلفية!');
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 سيرفر فحص الحالة يعمل بنجاح على المنفذ: ${PORT}`);
  });
}

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

CREATE TABLE IF NOT EXISTS restaurants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  menu_image_id  TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

// Prepared Statements
const stmts = {
  getUser:           db.prepare('SELECT * FROM users WHERE chat_id = ?'),
  upsertUser:        db.prepare(`
    INSERT INTO users (chat_id, state) VALUES (?, 'IDLE')
    ON CONFLICT(chat_id) DO NOTHING
  `),
  setState:          db.prepare('UPDATE users SET state = ? WHERE chat_id = ?'),
  setCategory:       db.prepare('UPDATE users SET selected_category = ?, state = ? WHERE chat_id = ?'),
  setPending:        db.prepare('UPDATE users SET pending_details = ?, state = ? WHERE chat_id = ?'),
  resetUser:         db.prepare(`
    UPDATE users SET state='IDLE', selected_category=NULL, pending_details=NULL
    WHERE chat_id = ?
  `),
  setAdmin:          db.prepare('UPDATE users SET is_admin = ? WHERE chat_id = ?'),
  getAdmins:         db.prepare('SELECT chat_id FROM users WHERE is_admin = 1'),
  insertOrder:       db.prepare(`
    INSERT INTO orders (chat_id, username, category, details, status)
    VALUES (?, ?, ?, ?, 'pending')
  `),
  getOrder:          db.prepare('SELECT * FROM orders WHERE id = ?'),
  updateOrderStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),
  lastOrders:        db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10'),
  countOrders:       db.prepare('SELECT COUNT(*) as total FROM orders'),
  countUsers:        db.prepare('SELECT COUNT(*) as total FROM users'),
  countPending:      db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='pending'"),
  countDelivering:   db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('accepted', 'delivering')"),
  countCompleted:    db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='completed'"),
  countCancelled:    db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='cancelled'"),

  // Restaurants
  insertRestaurant:  db.prepare('INSERT INTO restaurants (name, menu_image_id) VALUES (?, ?)'),
  getRestaurants:    db.prepare('SELECT * FROM restaurants ORDER BY id ASC'),
  getRestaurant:     db.prepare('SELECT * FROM restaurants WHERE id = ?'),
  deleteRestaurant:  db.prepare('DELETE FROM restaurants WHERE id = ?'),
  countRestaurants:  db.prepare('SELECT COUNT(*) as total FROM restaurants'),
};

// تثبيت حساب المندوب الأساسي تلقائياً في قاعدة البيانات
stmts.upsertUser.run(PRIMARY_ADMIN_CHAT_ID);
stmts.setAdmin.run(1, PRIMARY_ADMIN_CHAT_ID);

// Categories & Status Configuration
const STATUS_LABELS = {
  pending:    '⏳ قيد الانتظار',
  accepted:   '🛵 مقبول وجاري التجهيز',
  delivering: '🚀 جاري التوصيل مع المندوب',
  completed:  '✅ تم التسليم بنجاح',
  cancelled:  '❌ ملغي / اعتذار'
};

const CUSTOMER_STATUS_NOTIFICATIONS = {
  accepted:   (id) => `🛵 *تحديث بخصوص طلبك #${id}:*\nتم قبول طلبك وجاري تجهيزه حالياً من قبل المندوب! 💨`,
  delivering: (id) => `🚀 *تحديث بخصوص طلبك #${id}:*\nالمندوب استلم طلبك وهو في الطريق إليك الآن! 🛵💨`,
  completed:  (id) => `🎉 *تم تسليم طلبك #${id} بنجاح!*\nشكراً لتعاملك معنا في دليفري طنطا، نسعد بخدمتك دائماً! 🙏❤️`,
  cancelled:  (id) => `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب حالياً. للتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`
};

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

// Keyboards
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
  [Markup.button.callback('📦 آخر الطلبات والتحكم فيها', 'admin_orders')],
  [Markup.button.callback('🍽️ إدارة المطاعم والمنيو',   'admin_restaurants')],
  [Markup.button.callback('📊 إحصائيات شاملة',           'admin_stats')],
  [Markup.button.callback('🚪 تسجيل الخروج',             'admin_logout')],
]);

const adminRestaurantsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ إضافة مطعم ومنيو جديد', 'admin_add_rest')],
  [Markup.button.callback('📋 قائمة المطاعم الحالية', 'admin_list_rest')],
  [Markup.button.callback('🔙 رجوع للوحة الإدارة',     'admin_panel_back')],
]);

function getOrderActionKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🛵 قبول وتجهيز', `set_status:${orderId}:accepted`),
      Markup.button.callback('🚀 جاري التوصيل', `set_status:${orderId}:delivering`)
    ],
    [
      Markup.button.callback('✅ تم التسليم', `set_status:${orderId}:completed`),
      Markup.button.callback('❌ إلغاء واعتذار', `set_status:${orderId}:cancelled`)
    ]
  ]);
}

// Helper: Notify Admins & Primary Driver
function notifyAdmins(botInstance, order) {
  const dbAdmins = stmts.getAdmins.all().map(a => a.chat_id);
  const targetAdminIds = Array.from(new Set([PRIMARY_ADMIN_CHAT_ID, ...dbAdmins]));

  const msg = `🔔 *طلب جديد #${order.id}*\n\n`
    + `📂 القسم: ${CATEGORY_LABELS[order.category] || order.category}\n`
    + `👤 العميل: @${order.username || 'بدون يوزر'} (ID: \`${order.chat_id}\`)\n`
    + `📝 التفاصيل:\n${order.details}\n`
    + `📅 ${order.created_at}\n`
    + `📊 الحالة: ${STATUS_LABELS.pending}\n\n`
    + `👇 تحكم في حالة الطلب مباشرة:`;

  for (const adminChatId of targetAdminIds) {
    botInstance.telegram.sendMessage(adminChatId, msg, {
      parse_mode: 'Markdown',
      ...getOrderActionKeyboard(order.id)
    }).catch((err) => {
      console.error(`فشل إرسال إشعار للأدمن ${adminChatId}:`, err.message);
    });
  }
}

// Bot Instance
const bot = new Telegraf(BOT_TOKEN);

// Middleware: Session tracking per user
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();
  stmts.upsertUser.run(chatId);

  // إذا كان حساب المندوب الأساسي (01143264206) يتم ترقيته تلقائياً دائماً
  if (chatId === PRIMARY_ADMIN_CHAT_ID) {
    stmts.setAdmin.run(1, chatId);
  }

  ctx.dbUser = stmts.getUser.get(chatId);
  return next();
});

// Admin handler logic
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

// Photo Message Handler (Used when admin uploads a restaurant menu photo)
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (!user) return;

  if (user.state === 'ADMIN_ADD_REST_IMAGE') {
    if (user.is_admin !== 1 && chatId !== PRIMARY_ADMIN_CHAT_ID) return ctx.reply('⛔ غير مصرح لك.');

    const photoArray = ctx.message.photo;
    const fileId = photoArray[photoArray.length - 1].file_id;
    const restName = user.pending_details || 'مطعم جديد';

    stmts.insertRestaurant.run(restName, fileId);
    stmts.resetUser.run(chatId);

    await ctx.reply(`✅ *تم بنجاح إضافة مطعم "${restName}" مع صورة المنيو الخاصة به!* 📸🍔\n\nأصبح متاحاً الآن في قسم المطاعم ليراه العملاء.`, {
      parse_mode: 'Markdown',
      ...adminRestaurantsKeyboard
    });
    return;
  }

  if (user.state === 'WAITING_DETAILS') {
    return ctx.reply('⚠️ يرجى إرسال تفاصيل طلبك كتابةً بنص واضح.');
  }
});

// Text Message Router
bot.on('text', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const text = ctx.message.text.trim();
  const lower = text.toLowerCase();
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (!user) return;

  // دعم نصوص الأوامر المكتوبة بدون سلاش
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

  // معالجة خطوة إدخال اسم المطعم من الأدمن
  if (user.state === 'ADMIN_ADD_REST_NAME') {
    if (user.is_admin !== 1 && chatId !== PRIMARY_ADMIN_CHAT_ID) return ctx.reply('⛔ غير مصرح.');
    if (text.length > 100) {
      return ctx.reply('⚠️ اسم المطعم طويل جداً، اكتب اسماً مختصراً.');
    }
    stmts.setPending.run(text, 'ADMIN_ADD_REST_IMAGE', chatId);
    return ctx.reply(
      `📸 ممتاز، اسم المطعم: *${text}*\n\nأرسل الآن *صورة المنيو* (أو اكتب "تخطي" إذا لم تتوفر صورة منيو حالياً):`,
      { parse_mode: 'Markdown' }
    );
  }

  // معالجة خطوة صورة المطعم إذا اختار الأدمن التخطي
  if (user.state === 'ADMIN_ADD_REST_IMAGE') {
    if (user.is_admin !== 1 && chatId !== PRIMARY_ADMIN_CHAT_ID) return ctx.reply('⛔ غير مصرح.');
    if (['تخطي', 'تخطي الصورة', 'skip', 'لا'].includes(lower)) {
      const restName = user.pending_details || 'مطعم جديد';
      stmts.insertRestaurant.run(restName, null);
      stmts.resetUser.run(chatId);
      return ctx.reply(`✅ *تمت إضافة مطعم "${restName}" بنجاح بدون صورة منيو.*`, {
        parse_mode: 'Markdown',
        ...adminRestaurantsKeyboard
      });
    } else {
      return ctx.reply('📸 يرجى إرسال صورة المنيو أو كتابة كلمة "تخطي".');
    }
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
      if (text === ADMIN_PASS || chatId === PRIMARY_ADMIN_CHAT_ID) {
        stmts.setAdmin.run(1, chatId);
        stmts.setState.run('ADMIN_PANEL', chatId);
        return ctx.reply('✅ تم تسجيل الدخول كمدير بنجاح!\n\n👑 لوحة الإدارة:', adminKeyboard);
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

  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // --- قسم المطاعم المخصص (عرض المطاعم المسجلة من الأدمن مع المنيو) ---
  if (data === 'cat_restaurants') {
    const restaurants = stmts.getRestaurants.all();
    if (restaurants.length > 0) {
      const restButtons = restaurants.map(r => [
        Markup.button.callback(`🍔 ${r.name}`, `select_rest:${r.id}`)
      ]);
      restButtons.push([Markup.button.callback('📝 طلب من مطعم آخر غير مسجل', 'rest_other')]);
      restButtons.push([Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_menu')]);

      return ctx.reply(
        '🍔 *مطاعم طنطا المتاحة:*\n\nاختر المطعم لعرض صورة المنيو الخاص به والطلب مباشرة، أو اختر مطعم آخر:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(restButtons)
        }
      );
    } else {
      stmts.setCategory.run('cat_restaurants', 'WAITING_DETAILS', chatId);
      return ctx.reply(CATEGORY_PROMPTS.cat_restaurants, { parse_mode: 'Markdown' });
    }
  }

  // العميل اختار مطعماً محدداً
  if (data.startsWith('select_rest:')) {
    const restId = Number(data.split(':')[1]);
    const rest = stmts.getRestaurant.get(restId);
    if (!rest) {
      return ctx.reply('مطعم غير موجود، اختر مطعماً آخر.', mainMenuKeyboard);
    }

    stmts.setCategory.run(`cat_restaurants:${rest.name}`, 'WAITING_DETAILS', chatId);

    const promptText = `🍔 *طلب من مطعم: ${rest.name}*\n\nاكتب تفاصيل طلبك كاملة:\n• الأصناف المطلوبة والكميات\n• عنوان التوصيل بالتفصيل\n• رقم للتواصل (اختياري)`;

    if (rest.menu_image_id) {
      return ctx.replyWithPhoto(rest.menu_image_id, {
        caption: promptText,
        parse_mode: 'Markdown'
      }).catch(async () => {
        await ctx.reply(promptText, { parse_mode: 'Markdown' });
      });
    } else {
      return ctx.reply(promptText, { parse_mode: 'Markdown' });
    }
  }

  // العميل اختار مطعم آخر غير مسجل
  if (data === 'rest_other') {
    stmts.setCategory.run('cat_restaurants', 'WAITING_DETAILS', chatId);
    return ctx.reply(CATEGORY_PROMPTS.cat_restaurants, { parse_mode: 'Markdown' });
  }

  // اختيار أي قسم آخر من الأقسام الخمسة
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

    // إشعار فوري للأدمن الأساسي (5766938827) وأي مدراء آخرين مع أزرار التحكم
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

  // رجوع للقائمة
  if (data === 'back_to_menu') {
    stmts.resetUser.run(chatId);
    return ctx.reply('👋 القائمة الرئيسية:', mainMenuKeyboard);
  }

  // --- لوحة الإدارة: تغيير حالة الطلب مع إشعار فوري للعميل ---
  if (data.startsWith('set_status:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');

    const [, orderIdStr, newStatus] = data.split(':');
    const orderId = Number(orderIdStr);
    const order = stmts.getOrder.get(orderId);

    if (!order) {
      return ctx.reply('⚠️ لم يتم العثور على هذا الطلب.');
    }

    stmts.updateOrderStatus.run(newStatus, orderId);
    const statusLabel = STATUS_LABELS[newStatus] || newStatus;

    await ctx.answerCbQuery(`تم تحديث الطلب #${orderId} إلى: ${statusLabel}`).catch(() => {});

    const originalText = ctx.callbackQuery.message?.text || '';
    const cleanText = originalText.split('\n━━━━━━━━━━━━━━━━━\n🔄')[0];
    await ctx.editMessageText(
      `${cleanText}\n━━━━━━━━━━━━━━━━━\n🔄 *تم التحديث بواسطة الأدمن:* ${statusLabel}`,
      {
        parse_mode: 'Markdown',
        ...getOrderActionKeyboard(orderId)
      }
    ).catch(() => {});

    // إرسال إشعار فوري للعميل صاحب الطلب
    const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
    if (notifyFn && order.chat_id) {
      bot.telegram.sendMessage(order.chat_id, notifyFn(orderId), { parse_mode: 'Markdown' })
        .catch((err) => console.error(`فشل إرسال إشعار للعميل ${order.chat_id}:`, err.message));
    }
    return;
  }

  // --- لوحة الإدارة: إدارة المطاعم والمنيو ---
  if (data === 'admin_restaurants') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const count = stmts.countRestaurants.get().total;
    return ctx.reply(
      `🍽️ *إدارة المطاعم والمنيو:*\n\nعدد المطاعم المسجلة حالياً: *${count}* مطعم.\nاختر الإجراء الذي تريده:`,
      {
        parse_mode: 'Markdown',
        ...adminRestaurantsKeyboard
      }
    );
  }

  if (data === 'admin_add_rest') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_NAME', chatId);
    return ctx.reply('📝 *أدخل اسم المطعم الجديد:*\n(مثال: كريب لافير، كرم الشام، بازوكا...)', { parse_mode: 'Markdown' });
  }

  if (data === 'admin_list_rest') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const rests = stmts.getRestaurants.all();
    if (!rests.length) {
      return ctx.reply('لا توجد مطاعم مسجلة بعد. اضغط "إضافة مطعم" لإضافة أول مطعم.', adminRestaurantsKeyboard);
    }

    await ctx.reply(`📋 *المطاعم المسجلة (${rests.length}):*`, { parse_mode: 'Markdown' });

    for (const r of rests) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`❌ حذف مطعم ${r.name}`, `del_rest:${r.id}`)]
      ]);

      if (r.menu_image_id) {
        await ctx.replyWithPhoto(r.menu_image_id, {
          caption: `🍽️ *${r.name}*\n📸 صورة المنيو مرفقة أعلاه.`,
          parse_mode: 'Markdown',
          ...keyboard
        }).catch(() => {});
      } else {
        await ctx.reply(`🍽️ *${r.name}* (بدون صورة منيو)`, {
          parse_mode: 'Markdown',
          ...keyboard
        });
      }
    }
    return;
  }

  if (data.startsWith('del_rest:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const restId = Number(data.split(':')[1]);
    stmts.deleteRestaurant.run(restId);
    await ctx.answerCbQuery('تم حذف المطعم بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف المطعم بنجاح من القائمة.', adminRestaurantsKeyboard);
  }

  if (data === 'admin_panel_back') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_PANEL', chatId);
    return ctx.reply('👑 لوحة تحكم الإدارة:', adminKeyboard);
  }

  // --- لوحة الإدارة: عرض آخر الطلبات مع أزرار التحكم ---
  if (data === 'admin_orders') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const orders = stmts.lastOrders.all();
    if (!orders.length) return ctx.reply('لا توجد طلبات مسجلة بعد.');

    await ctx.reply(`📦 *عرض آخر 5 طلبات مع إمكانية تغيير الحالة:*\n━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });

    for (const o of orders.slice(0, 5)) {
      const orderCard = `🔖 *طلب #${o.id}* | ${CATEGORY_LABELS[o.category] || o.category}\n`
        + `👤 العميل: @${o.username || 'بدون يوزر'} (ID: \`${o.chat_id}\`)\n`
        + `📅 ${o.created_at}\n`
        + `📊 الحالة الحالية: *${STATUS_LABELS[o.status] || o.status}*\n`
        + `📝 ${o.details}`;

      await ctx.reply(orderCard, {
        parse_mode: 'Markdown',
        ...getOrderActionKeyboard(o.id)
      }).catch(() => {});
    }
    return;
  }

  // --- لوحة الإدارة: الإحصائيات الشاملة ---
  if (data === 'admin_stats') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const totalOrders = stmts.countOrders.get().total;
    const totalUsers  = stmts.countUsers.get().total;
    const totalRests  = stmts.countRestaurants.get().total;
    const pending     = stmts.countPending.get().total;
    const delivering  = stmts.countDelivering.get().total;
    const completed   = stmts.countCompleted.get().total;
    const cancelled   = stmts.countCancelled.get().total;

    const statsMsg = `📊 *إحصائيات بوت دليفري طنطا:*
━━━━━━━━━━━━━━━━━
👥 إجمالي العملاء المسجلين: ${totalUsers}
🍽️ إجمالي المطاعم المضافة: ${totalRests}
📦 إجمالي كافة الطلبات: ${totalOrders}
─────────────────
⏳ طلبات قيد الانتظار: ${pending}
🛵 طلبات جاري توصيلها: ${delivering}
✅ طلبات تم تسليمها بنجاح: ${completed}
❌ طلبات ملغاة: ${cancelled}`;

    return ctx.reply(statsMsg, { parse_mode: 'Markdown', ...adminKeyboard });
  }

  // --- لوحة الإدارة: تسجيل الخروج ---
  if (data === 'admin_logout') {
    stmts.setAdmin.run(0, chatId);
    stmts.setState.run('IDLE', chatId);
    return ctx.reply('🚪 تم تسجيل الخروج بنجاح.', mainMenuKeyboard);
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

module.exports = { bot, db, stmts, CATEGORY_LABELS, CATEGORY_PROMPTS, STATUS_LABELS };
