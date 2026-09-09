const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');

// Constants & Hardcoded Config
const BOT_TOKEN              = process.env.BOT_TOKEN || '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
const ADMIN_PASS             = process.env.ADMIN_PASS || 'admin123';
const DB_PATH                = process.env.DB_PATH || './delivery_bot.db';
const PORT                   = process.env.PORT || 3000;
const PRIMARY_ADMIN_CHAT_ID  = 5766938827; // حساب المندوب والأدمن الأساسي (رقم 01143264206)

// تتبع رفع الصور المتعددة للمطاعم/العناصر أثناء جلسة الأدمن
const adminMultiPhotos = new Map(); // chatId -> { catId: string, itemName: string, photos: string[] }
// تتبع خطوة إضافة قسم جديد مؤقتاً
const adminNewCategory = new Map(); // chatId -> { name: string, input_type: string }

// مساعد تحليل ومعالجة صور المنيو
function parseMenuImages(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [raw];
  } catch (e) {
    return [raw];
  }
}

// مساعد تحليل تفاصيل الطلب (سواء نص فقط أو نص + صورة مرفقة من العميل)
function parseOrderDetails(raw) {
  if (!raw) return { text: '', photoId: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.type === 'photo') {
      return { text: parsed.text || 'صورة مرفقة من العميل', photoId: parsed.fileId };
    }
  } catch (e) {}
  return { text: raw, photoId: null };
}

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

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  input_type  TEXT NOT NULL DEFAULT 'text',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS category_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  image_ids    TEXT DEFAULT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  menu_image_id  TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

// Seed default categories if table is newly created
db.exec(`
INSERT OR IGNORE INTO categories (id, name, prompt, input_type, sort_order) VALUES
('cat_delivery', '🛵 دليفري وطلبات خاصة', '🛵 *دليفري وطلبات خاصة*\n\nاكتب تفاصيل طلبك كاملة:\n• العنوان (من أين؟ إلى أين؟)\n• وصف ما تريد إحضاره\n• أي ملاحظات إضافية', 'text', 1),
('cat_restaurants', '🍔 مطاعم طنطا', '🍔 *مطاعم طنطا*\n\nاكتب طلبك:\n• اسم المطعم (لو عندك تفضيل)\n• الأصناف المطلوبة\n• عنوان التوصيل', 'items', 2),
('cat_shopping', '🛒 تسوق من طنطا', '🛒 *تسوق من طنطا*\n\nاكتب تفاصيل مشترياتك أو أرسل صورة لقائمة المشتريات:\n• اسم المنتج أو المحل\n• الكمية\n• عنوان التوصيل', 'photo_or_text', 3),
('cat_pharmacy', '💊 صيدليات وأدوية طنطا', '💊 *صيدليات وأدوية طنطا*\n\nاكتب طلب الدواء أو أرسل صورة الروشتة:\n• اسم الدواء أو صورة الروشتة\n• عنوان التوصيل\n• رقم التواصل (اختياري)', 'photo_or_text', 4),
('cat_shops', '🏪 محلات المنطقة', '🏪 *محلات المنطقة*\n\nاكتب ما تريده من المحلات أو اختر المحل من القائمة:\n• اسم المحل أو المنطقة\n• المنتج المطلوب\n• عنوان التوصيل', 'items', 5),
('cat_support', '📞 خدمة العملاء', '📞 *خدمة العملاء*\n\nاكتب استفسارك أو مشكلتك وسيتواصل معك فريقنا في أقرب وقت.', 'text', 6);

-- Migrate legacy restaurants into category_items
INSERT INTO category_items (category_id, name, image_ids, created_at)
SELECT 'cat_restaurants', name, menu_image_id, created_at FROM restaurants
WHERE NOT EXISTS (SELECT 1 FROM category_items WHERE category_items.category_id = 'cat_restaurants' AND category_items.name = restaurants.name);
`);

// Prepared Statements
const stmts = {
  // Users
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

  // Orders
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

  // Categories
  getCategories:        db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC'),
  getCategory:          db.prepare('SELECT * FROM categories WHERE id = ?'),
  insertCategory:       db.prepare('INSERT INTO categories (id, name, prompt, input_type, sort_order) VALUES (?, ?, ?, ?, ?)'),
  deleteCategory:       db.prepare('DELETE FROM categories WHERE id = ?'),
  updateCategoryPrompt: db.prepare('UPDATE categories SET prompt = ? WHERE id = ?'),
  countCategories:      db.prepare('SELECT COUNT(*) as total FROM categories'),

  // Category Items (Restaurants, Shops, Services, etc.)
  getCategoryItems:   db.prepare('SELECT * FROM category_items WHERE category_id = ? ORDER BY id ASC'),
  getCategoryItem:    db.prepare('SELECT * FROM category_items WHERE id = ?'),
  insertCategoryItem: db.prepare('INSERT INTO category_items (category_id, name, image_ids) VALUES (?, ?, ?)'),
  deleteCategoryItem: db.prepare('DELETE FROM category_items WHERE id = ?'),
  countCategoryItems: db.prepare('SELECT COUNT(*) as total FROM category_items WHERE category_id = ?'),
  countAllItems:      db.prepare('SELECT COUNT(*) as total FROM category_items'),
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

const INPUT_TYPE_LABELS = {
  text:          '📝 نص فقط (تفاصيل وعنوان)',
  photo_or_text: '📸 صورة أو نص (روشتة / قائمة)',
  items:         '🏪 قسم محلات ومنيو (عناصر فرعية)'
};

const CUSTOMER_STATUS_NOTIFICATIONS = {
  accepted:   (id) => `🛵 *تحديث بخصوص طلبك #${id}:*\nتم قبول طلبك وجاري تجهيزه حالياً من قبل المندوب! 💨`,
  delivering: (id) => `🚀 *تحديث بخصوص طلبك #${id}:*\nالمندوب استلم طلبك وهو في الطريق إليك الآن! 🛵💨`,
  completed:  (id) => `🎉 *تم تسليم طلبك #${id} بنجاح!*\nشكراً لتعاملك معنا في دليفري طنطا، نسعد بخدمتك دائماً! 🙏❤️`,
  cancelled:  (id) => `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب حالياً. للتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`
};

// توليد لوحة القائمة الرئيسية تلقائياً من الأقسام المسجلة في قاعدة البيانات
function buildMainMenuKeyboard() {
  const cats = stmts.getCategories.all();
  const buttons = cats.map(c => [Markup.button.callback(c.name, `open_cat:${c.id}`)]);
  return Markup.inlineKeyboard(buttons);
}

// لوحات التحكم الثابتة
const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد الطلب',  'confirm')],
  [Markup.button.callback('✏️ تعديل التفاصيل', 'edit')],
  [Markup.button.callback('❌ إلغاء',          'cancel')],
]);

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📦 آخر الطلبات والتحكم فيها', 'admin_orders')],
  [Markup.button.callback('🍽️ إدارة المطاعم والمنيو',   'admin_restaurants')],
  [Markup.button.callback('⚙️ إدارة الأقسام والخدمات',   'admin_manage_categories')],
  [Markup.button.callback('📊 إحصائيات شاملة',           'admin_stats')],
  [Markup.button.callback('🚪 تسجيل الخروج',             'admin_logout')],
]);

const adminRestaurantsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ إضافة مطعم ومنيو جديد', 'admin_add_rest')],
  [Markup.button.callback('📋 قائمة المطاعم الحالية', 'admin_list_rest')],
  [Markup.button.callback('🔙 رجوع للوحة الإدارة',     'admin_panel_back')],
]);

function getRestImageChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🖼️ صورة واحدة فقط', 'rest_img_single')],
    [Markup.button.callback('📚 عدة صور (ألبوم منيو)', 'rest_img_multi')],
    [Markup.button.callback('⏭️ بدون صورة (تخطي)', 'rest_img_none')],
    [Markup.button.callback('🔙 إلغاء والعودة', 'admin_restaurants')]
  ]);
}

const adminCategoriesMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ إضافة قسم جديد',         'admin_add_cat_start')],
  [Markup.button.callback('📂 عرض وتعديل الأقسام الحالية', 'admin_list_categories')],
  [Markup.button.callback('🔙 رجوع للوحة الإدارة',     'admin_panel_back')],
]);

function getCategoryTypeChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 نص فقط (تفاصيل وعنوان)', 'choose_type:text')],
    [Markup.button.callback('📸 صورة أو نص (روشتة / قائمة طلبات)', 'choose_type:photo_or_text')],
    [Markup.button.callback('🏪 قسم محلات ومنيو (قائمة محلات فرعية)', 'choose_type:items')],
    [Markup.button.callback('🔙 إلغاء والعودة', 'admin_manage_categories')]
  ]);
}

function getItemImageChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🖼️ صورة واحدة فقط', 'item_img_single')],
    [Markup.button.callback('📚 عدة صور (ألبوم منيو)', 'item_img_multi')],
    [Markup.button.callback('⏭️ بدون صورة (تخطي)', 'item_img_none')],
    [Markup.button.callback('🔙 إلغاء والعودة', 'admin_manage_categories')]
  ]);
}

function getMultiPhotoKeyboard(count) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ حفظ الصور والانتهاء (${count} صور)`, 'item_img_multi_finish')],
    [Markup.button.callback('❌ إلغاء الإضافة', 'admin_manage_categories')]
  ]);
}

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

  const parsed = parseOrderDetails(order.details);
  const catObj = stmts.getCategory.get(order.category);
  const catName = catObj ? catObj.name : order.category;

  const msg = `🔔 *طلب جديد #${order.id}*\n\n`
    + `📂 القسم: ${catName}\n`
    + `👤 العميل: @${order.username || 'بدون يوزر'} (ID: \`${order.chat_id}\`)\n`
    + `📝 التفاصيل:\n${parsed.text}\n`
    + `📅 ${order.created_at}\n`
    + `📊 الحالة: ${STATUS_LABELS.pending}\n\n`
    + `👇 تحكم في حالة الطلب مباشرة:`;

  for (const adminChatId of targetAdminIds) {
    if (parsed.photoId) {
      // إرسال صورة الطلب (مثل الروشتة) مع الكابشن وأزرار التحكم
      botInstance.telegram.sendPhoto(adminChatId, parsed.photoId, {
        caption: msg,
        parse_mode: 'Markdown',
        ...getOrderActionKeyboard(order.id)
      }).catch(() => {
        botInstance.telegram.sendMessage(adminChatId, msg, {
          parse_mode: 'Markdown',
          ...getOrderActionKeyboard(order.id)
        }).catch(() => {});
      });
    } else {
      botInstance.telegram.sendMessage(adminChatId, msg, {
        parse_mode: 'Markdown',
        ...getOrderActionKeyboard(order.id)
      }).catch(() => {});
    }
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
  adminMultiPhotos.delete(ctx.chat.id);
  adminNewCategory.delete(ctx.chat.id);
  await ctx.reply(
    '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها من الأقسام التالية:',
    { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
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

// Photo Message Handler (Used when admin uploads item photo(s) OR when customer sends prescription/list)
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const user = ctx.dbUser || stmts.getUser.get(chatId);
  if (!user) return;

  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;
  const photoArray = ctx.message.photo;
  const fileId = photoArray[photoArray.length - 1].file_id;

  // 1. الأدمن يرفع صورة واحدة لمطعم
  if (user.state === 'ADMIN_ADD_REST_IMG_SINGLE') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const restName = user.pending_details || 'مطعم جديد';
    stmts.insertCategoryItem.run('cat_restaurants', restName, JSON.stringify([fileId]));
    stmts.resetUser.run(chatId);
    return ctx.reply(`✅ *تم بنجاح إضافة مطعم "${restName}" مع صورة المنيو!* 📸🍔\n\nأصبح متاحاً الآن في قسم المطاعم ليراه العملاء.`, {
      parse_mode: 'Markdown',
      ...adminRestaurantsKeyboard
    });
  }

  // 2. الأدمن يرفع عدة صور (ألبوم) لمنيو مطعم
  if (user.state === 'ADMIN_ADD_REST_MULTI_IMG') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    let session = adminMultiPhotos.get(chatId);
    if (!session) {
      session = { catId: 'cat_restaurants', itemName: user.pending_details || 'مطعم جديد', photos: [] };
      adminMultiPhotos.set(chatId, session);
    }
    session.photos.push(fileId);
    const count = session.photos.length;
    return ctx.reply(`📥 تم استلام صورة المنيو رقم (${count}). يمكنك إرسال المزيد من صور المنيو، أو الضغط على زر الحفظ أدناه عند الانتهاء:`, {
      ...getMultiPhotoKeyboard(count)
    });
  }

  // 3. الأدمن يرفع صورة واحدة لعنصر/محل بأي قسم
  if (user.state.startsWith('ADMIN_ITEM_IMG_SINGLE:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');

    const catId = user.state.split(':')[1];
    const itemName = user.pending_details || 'عنصر جديد';

    stmts.insertCategoryItem.run(catId, itemName, JSON.stringify([fileId]));
    stmts.resetUser.run(chatId);

    const cat = stmts.getCategory.get(catId);
    return ctx.reply(`✅ *تم بنجاح إضافة "${itemName}" في قسم [${cat?.name || catId}] مع صورة المنيو/المنتج!* 📸`, {
      parse_mode: 'Markdown',
      ...adminCategoriesMenuKeyboard
    });
  }

  // 4. الأدمن يرفع صور متعددة (ألبوم) لعنصر/محل بأي قسم
  if (user.state.startsWith('ADMIN_ITEM_IMG_MULTI:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');

    const catId = user.state.split(':')[1];
    let session = adminMultiPhotos.get(chatId);
    if (!session) {
      session = { catId, itemName: user.pending_details || 'عنصر جديد', photos: [] };
      adminMultiPhotos.set(chatId, session);
    }

    session.photos.push(fileId);
    const count = session.photos.length;

    return ctx.reply(`📥 تم استلام الصورة رقم (${count}). يمكنك إرسال المزيد، أو الضغط على زر الحفظ أدناه عند الانتهاء:`, {
      ...getMultiPhotoKeyboard(count)
    });
  }

  // 3. العميل يرسل صورة (روشتة صيدلية أو قائمة مشتريات) في الأقسام التي تدعم الصور
  if (user.state === 'WAITING_DETAILS' || user.state === 'WAITING_DETAILS_OR_PHOTO') {
    const caption = ctx.message.caption ? ctx.message.caption.trim() : 'طلب بالصورة المرفقة (روشتة / قائمة طلبات)';
    const storedDetails = JSON.stringify({ type: 'photo', fileId, text: caption });

    stmts.setPending.run(storedDetails, 'CONFIRMING', chatId);

    const catObj = stmts.getCategory.get(user.selected_category);
    const catLabel = catObj ? catObj.name : user.selected_category;

    await ctx.replyWithPhoto(fileId, {
      caption: `📋 *ملخص طلبك بالصورة:*\n\n📂 القسم: ${catLabel}\n📝 الملاحظات/التفاصيل:\n${caption}\n\nهل تريد تأكيد الطلب؟`,
      parse_mode: 'Markdown',
      ...confirmKeyboard
    });
    return;
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

  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // دعم نصوص الأوامر المكتوبة بدون سلاش
  if (['/admin', 'admin', 'ادمن', 'الادمن', 'الأدمن', '/ادمن'].includes(lower)) {
    return triggerAdminAuth(ctx);
  }

  if (['/start', 'start', 'ابدأ', 'ابدا', 'القائمة', 'menu'].includes(lower)) {
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);
    adminNewCategory.delete(chatId);
    return ctx.reply(
      '👋 أهلاً بك في *بوت دليفري طنطا*!\n\nاختر الخدمة التي تريدها من الأقسام التالية:',
      { parse_mode: 'Markdown', ...buildMainMenuKeyboard() }
    );
  }

  // معالجة خطوة إدخال اسم المطعم الجديد
  if (user.state === 'ADMIN_ADD_REST_NAME') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (text.length > 50) return ctx.reply('⚠️ اسم المطعم طويل، اكتب اسماً مختصراً.');

    stmts.setPending.run(text, 'ADMIN_ADD_REST_CHOOSE_IMG', chatId);
    return ctx.reply(
      `🍽️ اسم المطعم: *${text}*\n\n📸 هل تريد إضافة *صورة واحدة* للمنيو أم *ألبوم عدة صور*؟`,
      {
        parse_mode: 'Markdown',
        ...getRestImageChoiceKeyboard()
      }
    );
  }

  // معالجة خطوة إدخال اسم القسم الجديد من الأدمن
  if (user.state === 'ADMIN_ADD_CAT_NAME') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (text.length > 50) return ctx.reply('⚠️ اسم القسم طويل، يرجى كتابة اسم مختصر.');

    adminNewCategory.set(chatId, { name: text });
    stmts.setState.run('ADMIN_ADD_CAT_CHOOSE_TYPE', chatId);

    return ctx.reply(
      `📂 اسم القسم الجديد: *${text}*\n\n👇 *حدد الآن نوع البيانات التي سيطلبها البوت من العميل في هذا القسم:*`,
      {
        parse_mode: 'Markdown',
        ...getCategoryTypeChoiceKeyboard()
      }
    );
  }

  // معالجة إدخال نص التوجيه للقسم الجديد من الأدمن
  if (user.state === 'ADMIN_ADD_CAT_PROMPT') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catData = adminNewCategory.get(chatId);
    if (!catData) {
      stmts.resetUser.run(chatId);
      return ctx.reply('حدث خطأ، أعد إضافة القسم من البداية.', adminCategoriesMenuKeyboard);
    }

    const catId = `cat_custom_${Date.now()}`;
    const promptText = text;
    const count = stmts.countCategories.get().total + 1;

    stmts.insertCategory.run(catId, catData.name, promptText, catData.input_type, count);
    stmts.resetUser.run(chatId);
    adminNewCategory.delete(chatId);

    return ctx.reply(
      `🎉 *تم بنجاح إنشاء القسم الجديد!*
━━━━━━━━━━━━━━━━━
📂 الاسم: *${catData.name}*
📌 نوع بيانات العميل: *${INPUT_TYPE_LABELS[catData.input_type]}*
💬 رسالة التوجيه:
${promptText}
━━━━━━━━━━━━━━━━━
يظهر الآن فوراً في القائمة الرئيسية للعملاء.`,
      {
        parse_mode: 'Markdown',
        ...adminCategoriesMenuKeyboard
      }
    );
  }

  // معالجة تعديل رسالة التوجيه لقسم قائم
  if (user.state.startsWith('ADMIN_EDIT_PROMPT:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];
    stmts.updateCategoryPrompt.run(text, catId);
    stmts.resetUser.run(chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(`✅ *تم تحديث رسالة التوجيه لقسم [${cat?.name || catId}] بنجاح!*\n\nالرسالة الجديدة:\n${text}`, {
      parse_mode: 'Markdown',
      ...adminCategoriesMenuKeyboard
    });
  }

  // معالجة خطوة إدخال اسم عنصر/محل جديد داخل قسم
  if (user.state.startsWith('ADMIN_ADD_ITEM_NAME:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];
    if (text.length > 100) return ctx.reply('⚠️ الاسم طويل، اكتب اسماً مختصراً.');

    stmts.setPending.run(text, `ADMIN_ITEM_CHOOSE_IMG:${catId}`, chatId);
    return ctx.reply(
      `🏪 اسم المحل / العنصر: *${text}*\n\n📸 هل تريد إضافة *صورة واحدة* للمنيو أم *ألبوم عدة صور*؟`,
      {
        parse_mode: 'Markdown',
        ...getItemImageChoiceKeyboard()
      }
    );
  }

  // معالجة تأكيد حفظ الصور المتعددة لمنيو مطعم كتابياً
  if (user.state === 'ADMIN_ADD_REST_MULTI_IMG') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (['تم', 'حفظ', 'خلاص', 'done', 'save'].includes(lower)) {
      const session = adminMultiPhotos.get(chatId);
      const restName = session?.itemName || user.pending_details || 'مطعم جديد';
      const photos = session?.photos || [];

      if (photos.length === 0) {
        return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل صور المنيو أولاً أو اختر بدون صورة.');
      }

      stmts.insertCategoryItem.run('cat_restaurants', restName, JSON.stringify(photos));
      stmts.resetUser.run(chatId);
      adminMultiPhotos.delete(chatId);

      return ctx.reply(
        `✅ *تم بنجاح إضافة مطعم "${restName}" مع عدد (${photos.length}) صور للمنيو!* 📸🍔\n\nأصبح متاحاً الآن في قسم المطاعم ليراه العملاء.`,
        {
          parse_mode: 'Markdown',
          ...adminRestaurantsKeyboard
        }
      );
    }
  }

  // معالجة تأكيد حفظ الصور المتعددة كتابياً للعنصر
  if (user.state.startsWith('ADMIN_ITEM_IMG_MULTI:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];

    if (['تم', 'حفظ', 'خلاص', 'done', 'save'].includes(lower)) {
      const session = adminMultiPhotos.get(chatId);
      const itemName = session?.itemName || user.pending_details || 'عنصر جديد';
      const photos = session?.photos || [];

      if (photos.length === 0) {
        return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل صور المنيو أولاً أو اختر بدون صورة.');
      }

      stmts.insertCategoryItem.run(catId, itemName, JSON.stringify(photos));
      stmts.resetUser.run(chatId);
      adminMultiPhotos.delete(chatId);

      const cat = stmts.getCategory.get(catId);
      return ctx.reply(
        `✅ *تم بنجاح إضافة "${itemName}" في قسم [${cat?.name || catId}] مع عدد (${photos.length}) صور للمنيو!* 📸🍔`,
        {
          parse_mode: 'Markdown',
          ...adminCategoriesMenuKeyboard
        }
      );
    }
  }

  // حماية: رفض رسائل طويلة جداً
  if (text.length > 1000) {
    return ctx.reply('⚠️ التفاصيل طويلة جداً (الحد 1000 حرف)، يرجى التلخيص.');
  }

  switch (user.state) {
    case 'IDLE':
      return ctx.reply('👆 اختر من القائمة أو اكتب /start', buildMainMenuKeyboard());

    case 'WAITING_DETAILS':
    case 'WAITING_DETAILS_OR_PHOTO': {
      stmts.setPending.run(text, 'CONFIRMING', chatId);
      const catObj = stmts.getCategory.get(user.selected_category);
      const label = catObj ? catObj.name : user.selected_category || '';
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
      return ctx.reply('حدث خطأ، تم إعادة تشغيل الجلسة.', buildMainMenuKeyboard());
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

  // --- العميل يفتح أي قسم من الأقسام الديناميكية ---
  if (data.startsWith('open_cat:')) {
    const catId = data.split(':')[1];
    const cat = stmts.getCategory.get(catId);
    if (!cat) {
      return ctx.reply('القسم غير موجود حالياً، اختر قسماً آخر.', buildMainMenuKeyboard());
    }

    // 1. قسم من نوع محلات / منيو (عناصر فرعية)
    if (cat.input_type === 'items') {
      const items = stmts.getCategoryItems.all(catId);
      if (items.length > 0) {
        const itemButtons = items.map(it => [
          Markup.button.callback(`🏪 ${it.name}`, `select_item:${it.id}`)
        ]);
        itemButtons.push([Markup.button.callback('📝 طلب محل/عنصر آخر غير مسجل', `item_other:${catId}`)]);
        itemButtons.push([Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_menu')]);

        return ctx.reply(
          `📂 *${cat.name}*\n\nاختر من القائمة لعرض المنيو والطلب، أو اختر طلب آخر:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(itemButtons)
          }
        );
      } else {
        // لا توجد عناصر مسجلة بعد -> المسار المباشر
        stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
        return ctx.reply(cat.prompt, { parse_mode: 'Markdown' });
      }
    }

    // 2. قسم من نوع صورة أو نص (روشتات أدوية أو قوائم تسوق)
    if (cat.input_type === 'photo_or_text') {
      stmts.setCategory.run(catId, 'WAITING_DETAILS_OR_PHOTO', chatId);
      return ctx.reply(cat.prompt, { parse_mode: 'Markdown' });
    }

    // 3. قسم من نوع نص فقط
    stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
    return ctx.reply(cat.prompt, { parse_mode: 'Markdown' });
  }

  // العميل اختار عنصراً/محلاً محدداً
  if (data.startsWith('select_item:')) {
    const itemId = Number(data.split(':')[1]);
    const item = stmts.getCategoryItem.get(itemId);
    if (!item) {
      return ctx.reply('العنصر غير موجود، اختر غيره.', buildMainMenuKeyboard());
    }

    const catObj = stmts.getCategory.get(item.category_id);
    const catTitle = catObj ? catObj.name : 'القسم';
    stmts.setCategory.run(`${item.category_id}:${item.name}`, 'WAITING_DETAILS', chatId);

    const promptText = `🏪 *طلب من: ${item.name}* (${catTitle})\n\nاكتب تفاصيل طلبك كاملة:\n• الأصناف المطلوبة والكميات\n• عنوان التوصيل بالتفصيل\n• رقم للتواصل (اختياري)`;

    const photos = parseMenuImages(item.image_ids);

    if (photos.length === 1) {
      return ctx.replyWithPhoto(photos[0], {
        caption: promptText,
        parse_mode: 'Markdown'
      }).catch(async () => {
        await ctx.reply(promptText, { parse_mode: 'Markdown' });
      });
    } else if (photos.length > 1) {
      const mediaGroup = photos.slice(0, 10).map((fileId, idx) => ({
        type: 'photo',
        media: fileId,
        caption: idx === 0 ? `🏪 *منيو/صور: ${item.name}* (${photos.length} صور)` : undefined,
        parse_mode: idx === 0 ? 'Markdown' : undefined
      }));

      try {
        await ctx.replyWithMediaGroup(mediaGroup);
      } catch (err) {
        for (const p of photos) {
          await ctx.replyWithPhoto(p).catch(() => {});
        }
      }
      return ctx.reply(promptText, { parse_mode: 'Markdown' });
    } else {
      return ctx.reply(promptText, { parse_mode: 'Markdown' });
    }
  }

  // العميل اختار عنصر آخر غير مسجل في القسم
  if (data.startsWith('item_other:')) {
    const catId = data.split(':')[1];
    const cat = stmts.getCategory.get(catId);
    stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
    return ctx.reply(cat ? cat.prompt : 'اكتب تفاصيل طلبك وعنوان التوصيل:', { parse_mode: 'Markdown' });
  }

  // تأكيد الطلب
  if (data === 'confirm') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', buildMainMenuKeyboard());
    }
    const username = ctx.from?.username || '';
    const result = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
    const orderId = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    await ctx.reply(`✅ *تم تأكيد طلبك بنجاح!*\n\n🔖 رقم طلبك: *#${orderId}*\n\nسيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`, { parse_mode: 'Markdown' });

    // إشعار فوري للأدمن والمناديب
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
    const catObj = stmts.getCategory.get(user.selected_category);
    const label = catObj ? catObj.name : user.selected_category || '';
    return ctx.reply(`✏️ أعد إدخال تفاصيل طلبك (القسم: ${label}):`);
  }

  // إلغاء
  if (data === 'cancel') {
    stmts.resetUser.run(chatId);
    return ctx.reply('❌ تم إلغاء الطلب.', buildMainMenuKeyboard());
  }

  // رجوع للقائمة الرئيسية
  if (data === 'back_to_menu') {
    stmts.resetUser.run(chatId);
    return ctx.reply('👋 القائمة الرئيسية:', buildMainMenuKeyboard());
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

    // إشعار فوري للعميل صاحب الطلب
    const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
    if (notifyFn && order.chat_id) {
      bot.telegram.sendMessage(order.chat_id, notifyFn(orderId), { parse_mode: 'Markdown' })
        .catch((err) => console.error(`فشل إرسال إشعار للعميل ${order.chat_id}:`, err.message));
    }
    return;
  }

  // --- لوحة الإدارة: إدارة المطاعم والمنيو المخصصة ---
  if (data === 'admin_restaurants') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const count = stmts.countCategoryItems.get('cat_restaurants').total;
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

  if (data === 'rest_img_single') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_IMG_SINGLE', chatId);
    return ctx.reply('📸 أرسل الآن *صورة واحدة فقط* لمنيو المطعم:', { parse_mode: 'Markdown' });
  }

  if (data === 'rest_img_multi') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_MULTI_IMG', chatId);
    const restName = user.pending_details || 'مطعم جديد';
    adminMultiPhotos.set(chatId, { catId: 'cat_restaurants', itemName: restName, photos: [] });
    return ctx.reply(
      `📚 *إضافة عدة صور للمنيو (ألبوم):*\n\nأرسل صور المنيو الآن (يمكنك إرسالها دفعة واحدة كألبوم أو صورة تلو الأخرى).\n\nعند الانتهاء من إرسال كافة الصور، اضغط على زر *[ ✅ حفظ الصور والانتهاء ]* بالأسفل:`,
      {
        parse_mode: 'Markdown',
        ...getMultiPhotoKeyboard(0)
      }
    );
  }

  if (data === 'rest_img_none') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const restName = user.pending_details || 'مطعم جديد';
    stmts.insertCategoryItem.run('cat_restaurants', restName, null);
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);
    return ctx.reply(`✅ *تمت إضافة مطعم "${restName}" بنجاح بدون صورة منيو.*`, {
      parse_mode: 'Markdown',
      ...adminRestaurantsKeyboard
    });
  }

  if (data === 'admin_list_rest') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const rests = stmts.getCategoryItems.all('cat_restaurants');
    if (!rests.length) {
      return ctx.reply('لا توجد مطاعم مسجلة بعد. اضغط "إضافة مطعم" لإضافة أول مطعم.', adminRestaurantsKeyboard);
    }

    await ctx.reply(`📋 *المطاعم المسجلة (${rests.length}):*`, { parse_mode: 'Markdown' });

    for (const r of rests) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`❌ حذف مطعم ${r.name}`, `del_rest:${r.id}`)]
      ]);

      const photos = parseMenuImages(r.image_ids);

      if (photos.length === 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🍽️ *${r.name}*\n📸 صورة منيو واحدة مرفقة.`,
          parse_mode: 'Markdown',
          ...keyboard
        }).catch(() => {});
      } else if (photos.length > 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🍽️ *${r.name}*\n📸 ألبوم منيو يحتوي على *(${photos.length}) صور*.`,
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
    stmts.deleteCategoryItem.run(restId);
    await ctx.answerCbQuery('تم حذف المطعم بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف المطعم بنجاح من القائمة.', adminRestaurantsKeyboard);
  }

  // --- لوحة الإدارة العامة للأقسام ---
  if (data === 'admin_manage_categories') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const count = stmts.countCategories.get().total;
    const totalItems = stmts.countAllItems.get().total;
    return ctx.reply(
      `⚙️ *لوحة إدارة الأقسام والخدمات:*\n\nعدد الأقسام: *${count}* قسم\nإجمالي المحلات/العناصر: *${totalItems}* عنصر\n\nاختر ما تريد القيام به:`,
      {
        parse_mode: 'Markdown',
        ...adminCategoriesMenuKeyboard
      }
    );
  }

  // إضافة قسم جديد: طلب الاسم
  if (data === 'admin_add_cat_start') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_CAT_NAME', chatId);
    return ctx.reply('📝 *أدخل اسم القسم الجديد:*\n(مثال: 🥩 جزارة ولحوم، 🚗 مشاوير وتوصيل أفراد، 🎂 حلويات ومخبوزات...)', { parse_mode: 'Markdown' });
  }

  // اختيار نوع بيانات العميل للقسم الجديد
  if (data.startsWith('choose_type:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const inputType = data.split(':')[1];
    const catData = adminNewCategory.get(chatId) || {};
    catData.input_type = inputType;
    adminNewCategory.set(chatId, catData);

    stmts.setState.run('ADMIN_ADD_CAT_PROMPT', chatId);

    let defaultPromptSuggestion = '';
    if (inputType === 'text') defaultPromptSuggestion = `اكتب تفاصيل طلبك بالتفصيل وعنوان التوصيل ورقم الهاتف:`;
    if (inputType === 'photo_or_text') defaultPromptSuggestion = `أرسل صورة الروشتة أو قائمة المشتريات، أو اكتب تفاصيل طلبك وعنوانك بالتفصيل:`;
    if (inputType === 'items') defaultPromptSuggestion = `اختر المحل من القائمة واكتب الأصناف المطلوبة وعنوان التوصيل:`;

    return ctx.reply(
      `✍️ *الخطوة الأخيرة: رسالة توجيه العميل:*\nاكتب الرسالة التي ستظهر للعميل عند فتح هذا القسم.\n\n💡 *اقتراح جاهز:*\n_${defaultPromptSuggestion}_\n\nاكتب رسالتك الآن وأرسلها للشات:`,
      { parse_mode: 'Markdown' }
    );
  }

  // عرض قائمة الأقسام الحالية مع خيارات الإدارة
  if (data === 'admin_list_categories') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const cats = stmts.getCategories.all();
    if (!cats.length) {
      return ctx.reply('لا توجد أقسام مسجلة.', adminCategoriesMenuKeyboard);
    }

    await ctx.reply(`📂 *قائمة الأقسام الحالية (${cats.length}):*\nيمكنك إضافة عناصر لأي قسم، تعديل رسالته، أو حذفه:`, { parse_mode: 'Markdown' });

    for (const c of cats) {
      const itemCount = stmts.countCategoryItems.get(c.id).total;
      const card = `📌 *${c.name}*\n🔹 نوع مدخلات العميل: ${INPUT_TYPE_LABELS[c.input_type] || c.input_type}\n📦 عدد المحلات/العناصر: ${itemCount}\n💬 الرسالة:\n_${c.prompt.substring(0, 80)}..._`;

      const buttons = [
        [
          Markup.button.callback('➕ إضافة محل/عنصر/منيو', `cat_add_item:${c.id}`),
          Markup.button.callback(`📋 العناصر (${itemCount})`, `cat_view_items:${c.id}`)
        ],
        [
          Markup.button.callback('✏️ تعديل رسالة التوجيه', `cat_edit_prompt:${c.id}`),
          Markup.button.callback('❌ حذف القسم', `cat_del:${c.id}`)
        ]
      ];

      await ctx.reply(card, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      }).catch(() => {});
    }
    return;
  }

  // حذف قسم
  if (data.startsWith('cat_del:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.deleteCategory.run(catId);
    // حذف العناصر التابعة له
    db.prepare('DELETE FROM category_items WHERE category_id = ?').run(catId);
    await ctx.answerCbQuery('تم حذف القسم بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف القسم وكافة عناصره بنجاح.', adminCategoriesMenuKeyboard);
  }

  // تعديل رسالة توجيه قسم
  if (data.startsWith('cat_edit_prompt:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.setState.run(`ADMIN_EDIT_PROMPT:${catId}`, chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(`✏️ *أدخل الرسالة الجديدة لقسم [${cat?.name || catId}]:*`, { parse_mode: 'Markdown' });
  }

  // إضافة عنصر جديد لقسم معين
  if (data.startsWith('cat_add_item:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.setState.run(`ADMIN_ADD_ITEM_NAME:${catId}`, chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(`🏪 *أدخل اسم المحل أو العنصر الجديد لقسم [${cat?.name || catId}]:*\n(مثال: كريب لافير، صيدلية العزبي، سوبرماركت زهران...)`, { parse_mode: 'Markdown' });
  }

  // اختيار نوع صورة العنصر
  if (data === 'item_img_single') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    stmts.setState.run(`ADMIN_ITEM_IMG_SINGLE:${pendingCat}`, chatId);
    return ctx.reply('📸 أرسل الآن *صورة واحدة فقط* للمنيو أو المحل:', { parse_mode: 'Markdown' });
  }

  if (data === 'item_img_multi') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    stmts.setState.run(`ADMIN_ITEM_IMG_MULTI:${pendingCat}`, chatId);

    const itemName = user.pending_details || 'عنصر جديد';
    adminMultiPhotos.set(chatId, { catId: pendingCat, itemName, photos: [] });

    return ctx.reply(
      `📚 *إضافة عدة صور (ألبوم منيو):*\n\nأرسل الصور الآن (يمكنك إرسالها معاً كألبوم أو واحدة تلو الأخرى).\n\nعند الانتهاء اضغط زر *[ ✅ حفظ الصور والانتهاء ]* بالأسفل:`,
      {
        parse_mode: 'Markdown',
        ...getMultiPhotoKeyboard(0)
      }
    );
  }

  if (data === 'item_img_none') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    const itemName = user.pending_details || 'عنصر جديد';

    stmts.insertCategoryItem.run(pendingCat, itemName, null);
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);

    const cat = stmts.getCategory.get(pendingCat);
    return ctx.reply(`✅ *تمت إضافة "${itemName}" في قسم [${cat?.name || pendingCat}] بنجاح بدون صور.*`, {
      parse_mode: 'Markdown',
      ...adminCategoriesMenuKeyboard
    });
  }

  if (data === 'item_img_multi_finish') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const session = adminMultiPhotos.get(chatId);
    const catId = session?.catId || 'cat_restaurants';
    const itemName = session?.itemName || user.pending_details || 'عنصر جديد';
    const photos = session?.photos || [];

    if (photos.length === 0) {
      return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل الصور أولاً أو اختر بدون صورة.');
    }

    stmts.insertCategoryItem.run(catId, itemName, JSON.stringify(photos));
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);

    const isRest = catId === 'cat_restaurants';
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(
      `✅ *تم بنجاح إضافة "${itemName}" في ${isRest ? 'قسم المطاعم' : `قسم [${cat?.name || catId}]`} مع عدد (${photos.length}) صور للمنيو!* 📸🍔`,
      {
        parse_mode: 'Markdown',
        ...(isRest ? adminRestaurantsKeyboard : adminCategoriesMenuKeyboard)
      }
    );
  }

  // عرض عناصر قسم معين مع إمكانية حذف أي عنصر
  if (data.startsWith('cat_view_items:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    const cat = stmts.getCategory.get(catId);
    const items = stmts.getCategoryItems.all(catId);

    if (!items.length) {
      return ctx.reply(`لا توجد محلات أو عناصر مضافة في قسم [${cat?.name || catId}]. اضغط "إضافة محل/عنصر" لإضافة أول عنصر.`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ إضافة محل/عنصر الآن', `cat_add_item:${catId}`)],
          [Markup.button.callback('🔙 رجوع للأقسام', 'admin_list_categories')]
        ])
      });
    }

    await ctx.reply(`📋 *عناصر ومحلات قسم [${cat?.name || catId}] (${items.length}):*`, { parse_mode: 'Markdown' });

    for (const it of items) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`❌ حذف ${it.name}`, `del_item:${it.id}`)]
      ]);

      const photos = parseMenuImages(it.image_ids);

      if (photos.length === 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🏪 *${it.name}*\n📸 صورة واحدة مرفقة.`,
          parse_mode: 'Markdown',
          ...keyboard
        }).catch(() => {});
      } else if (photos.length > 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🏪 *${it.name}*\n📸 ألبوم يحتوي على *(${photos.length}) صور*.`,
          parse_mode: 'Markdown',
          ...keyboard
        }).catch(() => {});
      } else {
        await ctx.reply(`🏪 *${it.name}* (بدون صور)`, {
          parse_mode: 'Markdown',
          ...keyboard
        });
      }
    }
    return;
  }

  // حذف عنصر من قسم
  if (data.startsWith('del_item:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const itemId = Number(data.split(':')[1]);
    stmts.deleteCategoryItem.run(itemId);
    await ctx.answerCbQuery('تم حذف العنصر بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف العنصر بنجاح.', adminCategoriesMenuKeyboard);
  }

  // رجوع للوحة الإدارة
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
      const parsed = parseOrderDetails(o.details);
      const catObj = stmts.getCategory.get(o.category);
      const catTitle = catObj ? catObj.name : o.category;

      const orderCard = `🔖 *طلب #${o.id}* | ${catTitle}\n`
        + `👤 العميل: @${o.username || 'بدون يوزر'} (ID: \`${o.chat_id}\`)\n`
        + `📅 ${o.created_at}\n`
        + `📊 الحالة الحالية: *${STATUS_LABELS[o.status] || o.status}*\n`
        + `📝 التفاصيل:\n${parsed.text}`;

      if (parsed.photoId) {
        await ctx.replyWithPhoto(parsed.photoId, {
          caption: orderCard,
          parse_mode: 'Markdown',
          ...getOrderActionKeyboard(o.id)
        }).catch(() => {
          ctx.reply(orderCard, {
            parse_mode: 'Markdown',
            ...getOrderActionKeyboard(o.id)
          });
        });
      } else {
        await ctx.reply(orderCard, {
          parse_mode: 'Markdown',
          ...getOrderActionKeyboard(o.id)
        }).catch(() => {});
      }
    }
    return;
  }

  // --- لوحة الإدارة: الإحصائيات الشاملة ---
  if (data === 'admin_stats') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const totalOrders = stmts.countOrders.get().total;
    const totalUsers  = stmts.countUsers.get().total;
    const totalCats   = stmts.countCategories.get().total;
    const totalItems  = stmts.countAllItems.get().total;
    const pending     = stmts.countPending.get().total;
    const delivering  = stmts.countDelivering.get().total;
    const completed   = stmts.countCompleted.get().total;
    const cancelled   = stmts.countCancelled.get().total;

    const statsMsg = `📊 *إحصائيات بوت دليفري طنطا:*
━━━━━━━━━━━━━━━━━
👥 إجمالي العملاء المسجلين: ${totalUsers}
📂 إجمالي الأقسام والخدمات: ${totalCats}
🏪 إجمالي المحلات والعناصر: ${totalItems}
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
    return ctx.reply('🚪 تم تسجيل الخروج بنجاح.', buildMainMenuKeyboard());
  }

  // Fallback
  stmts.resetUser.run(chatId);
  ctx.reply('حدث خطأ، ابدأ من جديد.', buildMainMenuKeyboard());
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
      console.log('🚀 Tanta Delivery Bot is running with Dynamic Categories CMS...');
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

module.exports = {
  bot,
  db,
  stmts,
  STATUS_LABELS,
  INPUT_TYPE_LABELS,
  parseMenuImages,
  parseOrderDetails,
  buildMainMenuKeyboard
};
