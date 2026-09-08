import sqlite3 from 'sqlite3';
import axios from 'axios';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. التوكن مدمج مباشرة في الكود بدون ملف .env
const BOT_TOKEN = '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// إعداد وكيل HTTPS يدعم IPv4 لضمان استقرار الاتصال على Linux
const agent = new https.Agent({ family: 4, keepAlive: true });
const tg = axios.create({
  baseURL: TELEGRAM_API,
  httpsAgent: agent,
  timeout: 60000
});

// بيانات المندوب الأساسي لاستقبال كافة إشعارات وطلبات البوت فوراً
const PRIMARY_DRIVER_PHONE = '01143264206';
const PRIMARY_DRIVER_CHAT_ID = '8257935481'; // حساب التيليجرام للمندوب الأساسي (01143264206)

// 2. إعداد قاعدة بيانات SQLite (delivery_bot.db)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'delivery_bot.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ خطأ في فتح قاعدة البيانات SQLite:', err.message);
  } else {
    console.log(`📦 متصل بقاعدة بيانات SQLite: ${DB_PATH}`);
  }
});

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// تهيئة الجداول في قاعدة البيانات
async function initDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      state TEXT DEFAULT 'IDLE',
      category TEXT,
      pending_details TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT,
      phone TEXT,
      category TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ تم تجهيز جداول قاعدة البيانات (users, orders) بنجاح.');
}

// استخراج رقم الهاتف إن وجد في النص
function extractPhone(text) {
  if (!text) return null;
  const match = text.match(/(?:(?:\+?20)|0)?1[0125][0-9]{8}/);
  return match ? match[0] : null;
}

// جلب أو إنشاء حالة المستخدم
async function getUser(userId, from = {}) {
  let user = await dbGet('SELECT * FROM users WHERE user_id = ?', [String(userId)]);
  if (!user) {
    await dbRun(
      'INSERT INTO users (user_id, username, first_name, state) VALUES (?, ?, ?, ?)',
      [String(userId), from.username || '', from.first_name || '', 'IDLE']
    );
    user = {
      user_id: String(userId),
      username: from.username || '',
      first_name: from.first_name || '',
      state: 'IDLE',
      category: null,
      pending_details: null
    };
  }
  return user;
}

// تحديث حالة المستخدم
async function updateUserState(userId, state, category = null, pending_details = null) {
  await dbRun(
    'UPDATE users SET state = ?, category = ?, pending_details = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    [state, category, pending_details, String(userId)]
  );
}

// 3. أزرار القائمة الرئيسية
const MAIN_MENU_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🛴 اسكوتر توصيلة (مشاوير)', callback_data: 'cat_scooter' },
      { text: '🛵 دليفري وطلبات خاصة', callback_data: 'cat_delivery' }
    ],
    [
      { text: '🍔 مطاعم طنطا', callback_data: 'cat_restaurants' },
      { text: '🛒 تسوق من طنطا', callback_data: 'cat_shopping' }
    ],
    [
      { text: '💊 صيدليات وأدوية طنطا', callback_data: 'cat_pharmacy' },
      { text: '🏪 محلات المنطقة', callback_data: 'cat_stores' }
    ],
    [
      { text: '📞 خدمة العملاء', callback_data: 'cat_support' }
    ]
  ]
};

const MAIN_MENU_TEXT = `أهلاً بك في خدمة دليفري طنطا 🛵💨
أسرع وأوفر توصيل في جميع مناطق طنطا!

اختر الخدمة المطلوبة من القائمة أدناه:`;

// إرسال رسالة تيليجرام
async function sendMessage(chatId, text, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await tg.post('/sendMessage', payload);
  } catch (err) {
    console.error(`❌ فشل إرسال رسالة إلى ${chatId}:`, err?.response?.data || err.message);
  }
}

// تأكيد نقرة الزر (Answer Callback Query)
async function answerCallback(callbackQueryId, text = null) {
  try {
    await tg.post('/answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || undefined
    });
  } catch (err) {
    // تجاهل أخطاء النقر البسيطة
  }
}

// معالجة اختيار الأقسام
async function handleCategorySelection(chatId, userId, categoryKey) {
  if (categoryKey === 'cat_scooter') {
    await updateUserState(userId, 'WAITING_DETAILS', '🛴 اسكوتر توصيلة');
    const msg = `🛴 <b>خدمة اسكوتر توصيلة (مشاوير طنطا السريعة 💨):</b>\nمشوارك أسرع وأوفر، زي أوبر بس على اسكوتر!\n\nمن فضلك اكتب:\n1️⃣ مكان الانطلاق (هتركب منين بالتحديد في طنطا؟)\n2️⃣ الوجهة (رايح فين؟)\n3️⃣ رقم التليفون للتواصل والتأكيد:`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (categoryKey === 'cat_pharmacy') {
    // 4. تفاصيل قسم الصيدليات
    await updateUserState(userId, 'WAITING_DETAILS', '💊 صيدليات وأدوية');
    const pharmacyPrompt = `من فضلك اكتب اسم الصيدلية المطلوبة وقائمة الأدوية أو النواقص بالتفصيل، مع عنوان التوصيل ورقم التليفون:`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]
      ]
    };
    await sendMessage(chatId, pharmacyPrompt, keyboard);
    return;
  }

  if (categoryKey === 'cat_delivery') {
    await updateUserState(userId, 'WAITING_DETAILS', '🛵 دليفري وطلبات خاصة');
    const msg = `🛵 <b>دليفري وطلبات خاصة في طنطا:</b>\n\nمن فضلك اكتب:\n1️⃣ مكان الاستلام\n2️⃣ مكان التسليم\n3️⃣ تفاصيل الطلب أو الطرد بالتفصيل\nمع رقم التليفون:`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (categoryKey === 'cat_restaurants') {
    await updateUserState(userId, 'WAITING_DETAILS', '🍔 مطاعم طنطا');
    const msg = `🍔 <b>طلب من مطاعم طنطا:</b>\n\nمن فضلك اكتب اسم المطعم وقائمة الوجبات المطلوبة بالتفصيل، مع عنوان التوصيل ورقم التليفون:`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (categoryKey === 'cat_shopping') {
    await updateUserState(userId, 'WAITING_DETAILS', '🛒 تسوق من طنطا');
    const msg = `🛒 <b>تسوق من طنطا:</b>\n\nمن فضلك اكتب اسم السوبر ماركت أو المتجر وقائمة المشتريات بالتفصيل، مع عنوان التوصيل ورقم التليفون:`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (categoryKey === 'cat_stores') {
    await updateUserState(userId, 'WAITING_DETAILS', '🏪 محلات المنطقة');
    const msg = `🏪 <b>محلات المنطقة:</b>\n\nمن فضلك اكتب اسم المحل أو النشاط (مخبز، خضار، جزارة...) والطلبات بالتفصيل، مع عنوان التوصيل ورقم التليفون:`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (categoryKey === 'cat_support') {
    await updateUserState(userId, 'IDLE');
    const msg = `📞 <b>خدمة العملاء والتواصل مع المندوب الأساسي:</b>\n\nنسعد دائماً بخدمتكم في دليفري طنطا 🛵\nللتواصل المباشر مع المندوب الأساسي:\n📱 هاتف / واتساب: <code>01143264206</code>\n\nأو أرسل رسالتك هنا وسيقوم المندوب بالرد عليك فوراً!`;
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }
}

// إرسال ملخص الطلب مع أزرار التأكيد والتعديل
async function sendOrderSummary(chatId, category, details) {
  const summaryText = `📋 <b>ملخص طلبك:</b>
━━━━━━━━━━━━━━━━━
🔹 <b>القسم:</b> ${category}
🔹 <b>التفاصيل:</b>
${details}
━━━━━━━━━━━━━━━━━
هل تريد تأكيد الطلب وإرساله لمناديب طنطا؟`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ تأكيد الطلب', callback_data: 'confirm_order' },
        { text: '✏️ تعديل الطلب', callback_data: 'edit_order' }
      ],
      [
        { text: '❌ إلغاء الطلب', callback_data: 'cancel_order' }
      ]
    ]
  };

  await sendMessage(chatId, summaryText, keyboard);
}

// معالجة الرسائل النصية
async function handleTextMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text || '').trim();

  const user = await getUser(userId, message.from);

  // أوامر إعادة التعيين والبداية
  if (['/start', '/menu', 'start', 'القائمة', 'menu', 'رجوع', 'إلغاء'].includes(text.toLowerCase())) {
    await updateUserState(userId, 'IDLE');
    await sendMessage(chatId, MAIN_MENU_TEXT, MAIN_MENU_KEYBOARD);
    return;
  }

  // دعم التعرف على نصوص الأزرار المكتوبة مباشرة
  if (text.includes('اسكوتر') || text.includes('سكوتر') || text.includes('اوبر')) {
    await handleCategorySelection(chatId, userId, 'cat_scooter');
    return;
  }
  if (text.includes('صيدلية') || text.includes('أدوية') || text.includes('ادوية')) {
    await handleCategorySelection(chatId, userId, 'cat_pharmacy');
    return;
  }
  if (text.includes('دليفري') || text.includes('طرد') || text.includes('مشوار')) {
    await handleCategorySelection(chatId, userId, 'cat_delivery');
    return;
  }
  if (text.includes('مطعم') || text.includes('مطاعم') || text.includes('أكل') || text.includes('اكل')) {
    await handleCategorySelection(chatId, userId, 'cat_restaurants');
    return;
  }
  if (text.includes('تسوق') || text.includes('سوبر ماركت') || text.includes('ماركت')) {
    await handleCategorySelection(chatId, userId, 'cat_shopping');
    return;
  }
  if (text.includes('محلات') || text.includes('محل')) {
    await handleCategorySelection(chatId, userId, 'cat_stores');
    return;
  }
  if (text.includes('خدمة العملاء') || text.includes('الدعم')) {
    await handleCategorySelection(chatId, userId, 'cat_support');
    return;
  }

  // إذا كان المستخدم في حالة إدخال تفاصيل الطلب (WAITING_DETAILS)
  if (user.state === 'WAITING_DETAILS') {
    const category = user.category || '💊 صيدليات وأدوية';
    // حفظ التفاصيل وتحويل الحالة لانتظار التأكيد
    await updateUserState(userId, 'CONFIRMING_ORDER', category, text);
    await sendOrderSummary(chatId, category, text);
    return;
  }

  // إذا كان المستخدم في حالة تأكيد الطلب وكتب تأكيد أو إلغاء كتابياً
  if (user.state === 'CONFIRMING_ORDER') {
    if (['تأكيد', '1', 'نعم', 'تمام', 'أكد'].includes(text.toLowerCase())) {
      await confirmAndSaveOrder(chatId, user);
      return;
    }
    if (['تعديل', 'عدل'].includes(text.toLowerCase())) {
      await updateUserState(userId, 'WAITING_DETAILS', user.category);
      await sendMessage(chatId, '✏️ أعد كتابة تفاصيل الطلب مع العنوان ورقم التليفون بالتفصيل:');
      return;
    }
    if (['إلغاء', 'الغاء', '0', 'لا'].includes(text.toLowerCase())) {
      await updateUserState(userId, 'IDLE');
      await sendMessage(chatId, '❌ تم إلغاء الطلب.', MAIN_MENU_KEYBOARD);
      return;
    }
  }

  // في حال كانت الحالة IDLE وأرسل أي نص آخر
  await sendMessage(chatId, MAIN_MENU_TEXT, MAIN_MENU_KEYBOARD);
}

// حفظ الطلب في قاعدة البيانات SQLite عند التأكيد
async function confirmAndSaveOrder(chatId, user) {
  const category = user.category || 'طلب عام';
  const details = user.pending_details || '';
  const phone = extractPhone(details) || '';

  try {
    const res = await dbRun(
      `INSERT INTO orders (user_id, username, phone, category, details, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [user.user_id, user.username || user.first_name || '', phone, category, details]
    );

    const orderId = res.lastID;
    console.log(`📦 [طلب جديد #${orderId}] من المستخدم: ${user.user_id} (${user.username || 'بدون يوزر'}) - القسم: ${category}`);

    // إعادة تعيين حالة المستخدم
    await updateUserState(user.user_id, 'IDLE');

    const successMessage = `🙏 <b>شكراً لك! تم تأكيد طلبك بنجاح.</b>
━━━━━━━━━━━━━━━━━
📦 <b>رقم الطلب:</b> #${orderId}
🔹 <b>القسم:</b> ${category}
${phone ? `📞 <b>رقم الهاتف المسجل:</b> ${phone}\n` : ''}━━━━━━━━━━━━━━━━━
🛵 تم إرسال تفاصيل طلبك للمندوب الأساسي (01143264206) فوراً، وهيتم التواصل والتحرك في أسرع وقت! 💨`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🛵 طلب جديد / القائمة الرئيسية', callback_data: 'back_to_menu' }]
      ]
    };

    // إرسال تنبيه فوري للمندوب الأساسي على تيليجرام
    await notifyAdmin(orderId, user, category, details, phone);

    await sendMessage(chatId, successMessage, keyboard);
  } catch (err) {
    console.error('❌ خطأ أثناء حفظ الطلب في قاعدة البيانات:', err.message);
    await sendMessage(chatId, '⚠️ حدث خطأ أثناء حفظ طلبك، يرجى المحاولة مرة أخرى لاحقاً.');
  }
}

// إرسال إشعار فوري للمندوب الأساسي (01143264206) عند ورود أي طلب جديد
async function notifyAdmin(orderId, user, category, details, phone) {
  if (!PRIMARY_DRIVER_CHAT_ID) return;

  const now = new Date().toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour12: true,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  });

  const adminMsg = `🚨 <b>وصلك أوردر جديد يا كابتن (المندوب الأساسي)!</b> 🛵💨
━━━━━━━━━━━━━━━━━
📦 <b>رقم الطلب:</b> #${orderId}
🔹 <b>القسم:</b> ${category}
👤 <b>اسم العميل:</b> ${user.first_name || 'عميل'} ${user.username ? `(@${user.username})` : ''}
📞 <b>تليفون العميل:</b> ${phone ? `<code>${phone}</code>` : 'لم يُذكر بالتفصيل'}
⏰ <b>الوقت:</b> ${now}

📝 <b>التفاصيل والعنوان:</b>
${details}
━━━━━━━━━━━━━━━━━`;

  let replyMarkup = null;
  if (phone) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const waPhone = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
    replyMarkup = {
      inline_keyboard: [
        [{ text: '💬 فتح واتساب العميل فوراً', url: `https://wa.me/${waPhone}` }]
      ]
    };
  }

  try {
    await sendMessage(PRIMARY_DRIVER_CHAT_ID, adminMsg, replyMarkup);
    console.log(`📢 تم إرسال إشعار الأوردر #${orderId} للمندوب الأساسي بنجاح.`);
  } catch (err) {
    console.error('❌ فشل إرسال تنبيه للمندوب الأساسي:', err?.message || err);
  }
}

// معالجة نقرات الأزرار التفاعلية (Callback Query)
async function handleCallbackQuery(callbackQuery) {
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;

  await answerCallback(callbackId);

  const user = await getUser(userId, callbackQuery.from);

  if (data.startsWith('cat_')) {
    await handleCategorySelection(chatId, userId, data);
    return;
  }

  if (data === 'confirm_order') {
    await confirmAndSaveOrder(chatId, user);
    return;
  }

  if (data === 'edit_order') {
    const category = user.category || '💊 صيدليات وأدوية';
    await updateUserState(userId, 'WAITING_DETAILS', category);
    let msg = '✏️ أعد كتابة تفاصيل الطلب مع العنوان ورقم التليفون بالتفصيل:';
    if (category === '💊 صيدليات وأدوية') {
      msg = '✏️ أعد كتابة اسم الصيدلية وقائمة الأدوية أو النواقص مع عنوان التوصيل ورقم التليفون:';
    } else if (category === '🛴 اسكوتر توصيلة') {
      msg = '✏️ أعد كتابة مكان الانطلاق والوجهة ورقم التليفون بالتفصيل:';
    }
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 إلغاء والعودة للقائمة', callback_data: 'back_to_menu' }]]
    };
    await sendMessage(chatId, msg, keyboard);
    return;
  }

  if (data === 'cancel_order') {
    await updateUserState(userId, 'IDLE');
    await sendMessage(chatId, '❌ تم إلغاء الطلب والعودة للقائمة الرئيسية.', MAIN_MENU_KEYBOARD);
    return;
  }

  if (data === 'back_to_menu') {
    await updateUserState(userId, 'IDLE');
    await sendMessage(chatId, MAIN_MENU_TEXT, MAIN_MENU_KEYBOARD);
    return;
  }
}

// معالجة كل تحديث وارد من تيليجرام
async function handleUpdate(update) {
  try {
    if (update.message && update.message.text) {
      await handleTextMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error('❌ خطأ في معالجة التحديث:', err?.message || err);
  }
}

// حلقة Long-Polling لجلب التحديثات
let offset = 0;
let isPolling = true;

async function startPolling() {
  console.log('🚀 جاري بدء الاستماع لتحديثات البوت (Long Polling)...');
  while (isPolling) {
    try {
      const res = await tg.post(
        '/getUpdates',
        {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query']
        },
        { timeout: 35000 }
      );

      if (res.data && res.data.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      }
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        // انتهاء مهلة استطلاع عادية، المتابعة فوراً
      } else {
        console.error('⚠️ خطأ في الاستطلاع:', err?.message || err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}

// بدء التشغيل
async function main() {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 جاري التحقق من اتصال بوت دليفري طنطا...');
    const meRes = await tg.get('/getMe');
    const botInfo = meRes.data.result;
    console.log(`✅ البوت متصل بنجاح: @${botInfo.username} (${botInfo.first_name})`);

    // حذف أي Webhook نشط لضمان عمل getUpdates بسلاسة
    await tg.post('/deleteWebhook', { drop_pending_updates: false });

    // تهيئة قاعدة بيانات SQLite
    await initDatabase();

    // بدء الاستماع
    console.log('🛵 بوت دليفري طنطا جاهز وشغال الآن لاستقبال الطلبات!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await startPolling();
  } catch (err) {
    console.error('❌ فشل تشغيل البوت:', err?.message || err);
    process.exit(1);
  }
}

// إيقاف آمن
process.on('SIGINT', () => {
  console.log('\n🛑 جاري إيقاف البوت...');
  isPolling = false;
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  isPolling = false;
  db.close();
  process.exit(0);
});

main();
