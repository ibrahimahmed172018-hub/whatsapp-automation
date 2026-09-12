const path = require('path');
const fs = require('fs');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { PORT, ADMIN_PHONE, STATUS_LABELS, CUSTOMER_STATUS_NOTIFICATIONS } = require('./config');
const { stmts } = require('./db');

// ─── Express App & Uploads Setup ─────────────────────────────────────────────

const app = express();
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.json());

let latestQR = null;
let isConnected = false;

// Health Check
app.get('/', (req, res) => {
  res.send('🛵 بوت دليفري طنطا يعمل بنجاح في الخلفية!');
});

// Live QR Web Endpoint
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>WhatsApp Status - Tanta Delivery</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 60px 20px; background: #0b141a; color: #e9edef; }
          .card { max-width: 440px; margin: 0 auto; background: #111b21; padding: 36px 24px; border-radius: 16px; border: 1px solid #202c33; box-shadow: 0 4px 24px rgba(0,0,0,0.6); }
          h1 { color: #25d366; font-size: 24px; margin-bottom: 12px; }
          p { color: #8696a0; font-size: 16px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>WhatsApp Connected Successfully ✅</h1>
          <p>بوت دليفري طنطا متصل وجاهز للعمل واستقبال الطلبات على مدار الساعة 🛵💨</p>
        </div>
      </body>
      </html>
    `);
  }

  if (latestQR) {
    try {
      const qrDataUrl = await qrcode.toDataURL(latestQR, { width: 320, margin: 2 });
      return res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="refresh" content="5">
          <title>Scan WhatsApp QR - Tanta Delivery</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px 20px; background: #0b141a; color: #e9edef; }
            .card { max-width: 440px; margin: 0 auto; background: #111b21; padding: 32px 20px; border-radius: 16px; border: 1px solid #202c33; box-shadow: 0 4px 24px rgba(0,0,0,0.6); }
            h2 { color: #00a884; font-size: 22px; margin-bottom: 8px; }
            p { color: #8696a0; font-size: 14px; margin-bottom: 20px; }
            img { width: 280px; height: 280px; border-radius: 12px; background: white; padding: 10px; }
            .badge { display: inline-block; background: #202c33; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #00a884; margin-top: 18px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>📱 مسح رمز QR لربط واتساب</h2>
            <p>افتح واتساب ➔ الأجهزة المرتبطة ➔ ربط جهاز، وامسح الرمز أدناه:</p>
            <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
            <br/>
            <div class="badge">🔄 يتم التحديث تلقائياً كل 5 ثوانٍ</div>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      return res.status(500).send('خطأ في توليد صورة QR: ' + err.message);
    }
  }

  return res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="5">
      <title>WhatsApp Starting - Tanta Delivery</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 60px 20px; background: #0b141a; color: #e9edef; }
        .card { max-width: 440px; margin: 0 auto; background: #111b21; padding: 36px 24px; border-radius: 16px; border: 1px solid #202c33; box-shadow: 0 4px 24px rgba(0,0,0,0.6); }
        h2 { color: #e9edef; font-size: 20px; margin-bottom: 12px; }
        p { color: #8696a0; font-size: 15px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>⏳ جاري بدء عميل واتساب...</h2>
        <p>يتم تحضير رمز QR، سيتم تحديث الصفحة تلقائياً خلال 5 ثوانٍ.</p>
      </div>
    </body>
    </html>
  `);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 سيرفر الويب يعمل على المنفذ: ${PORT}`);
  console.log(`📱 رابط صفحة الـ QR بالمتصفح: http://localhost:${PORT}/qr`);
});

// ─── WhatsApp Client Setup ───────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
  }
});

client.on('qr', async (qr) => {
  latestQR = qr;
  isConnected = false;
  console.log('\n======================================================');
  console.log('📱 رمز QR جاهز للمسح! يمكنك مسحه من التيرمينال أو من:');
  console.log(`👉 http://localhost:${PORT}/qr`);
  console.log('======================================================\n');
  try {
    const ascii = await qrcode.toString(qr, { type: 'terminal', small: true });
    console.log(ascii);
  } catch {
    console.log('QR Raw Data:', qr);
  }
});

client.on('ready', () => {
  isConnected = true;
  latestQR = null;
  console.log('\n======================================================');
  console.log('🚀 WhatsApp Connected Successfully ✅');
  console.log('🛵 بوت دليفري طنطا جاهز الآن لاستقبال الرسائل والطلبات.');
  console.log('======================================================\n');
});

client.on('authenticated', () => {
  console.log('🔐 تم توثيق جلسة واتساب بنجاح.');
});

client.on('auth_failure', (msg) => {
  console.error('❌ فشل توثيق جلسة واتساب:', msg);
});

client.on('disconnected', (reason) => {
  console.log('⚠️ انقطع الاتصال بواتساب:', reason);
  isConnected = false;
  latestQR = null;
});

// ─── Verbatim Constants & Copy ───────────────────────────────────────────────

const MAIN_MENU_TEXT = `👋 أهلاً بك في *بوت دليفري طنطا*!

اختر الخدمة التي تريدها من الأقسام التالية:
1️⃣ 🛵 دليفري وطلبات خاصة
2️⃣ 🍔 مطاعم طنطا
3️⃣ 🛒 تسوق من طنطا
4️⃣ 💊 صيدليات وأدوية طنطا
5️⃣ 🏪 محلات المنطقة
6️⃣ 📞 خدمة العملاء

👇 أرسل رقم القسم المطلوب (1 - 6):`;

const PROMPT_DELIVERY = `🛵 *دليفري وطلبات خاصة*

اكتب تفاصيل طلبك كاملة:
• العنوان (من أين؟ إلى أين؟)
• وصف ما تريد إحضاره
• أي ملاحظات إضافية
• رقم بديل للتواصل (اختياري)`;

const PROMPT_SHOPPING = `🛒 *تسوق من طنطا*

اكتب تفاصيل مشترياتك أو أرسل صورة لقائمة المشتريات:
• اسم المنتج أو المحل
• الكمية
• عنوان التوصيل بالتفصيل
• رقم بديل للتواصل (اختياري)`;

const PROMPT_PHARMACY = `💊 *صيدليات وأدوية طنطا*

اكتب طلب الدواء أو أرسل صورة الروشتة:
• اسم الدواء أو صورة الروشتة
• عنوان التوصيل
• رقم التواصل (اختياري)`;

const PROMPT_SHOPS = `🏪 *محلات المنطقة*

اكتب ما تريده من المحلات أو اختر المحل من القائمة:
• اسم المحل أو المنطقة
• المنتج المطلوب
• عنوان التوصيل
• رقم بديل للتواصل (اختياري)`;

const PROMPT_SUPPORT = `📞 *خدمة العملاء*

اكتب استفسارك أو مشكلتك وسيتواصل معك فريقنا في أقرب وقت.
للتواصل المباشر مع الإدارة والمندوب: 01143264206`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDigits(text) {
  if (!text) return '';
  return text.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
}

function normalizePhone(p) {
  if (!p) return '';
  let clean = p.replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) clean = '20' + clean.slice(1);
  return clean;
}

function isAdmin(phone, user) {
  if (user && user.is_admin === 1) return true;
  const adminTarget = normalizePhone(ADMIN_PHONE);
  const senderPhone = normalizePhone(phone);
  return senderPhone === adminTarget || senderPhone === '201143264206';
}

function getAdminJid() {
  const norm = normalizePhone(ADMIN_PHONE);
  return `${norm || '201143264206'}@c.us`;
}

async function forwardOrderToAdmin(orderId, orderData, imageRelPath) {
  try {
    const adminJid = getAdminJid();
    const adminMsg = `🔔 *طلب جديد #${orderId}*\n\n`
      + `📂 القسم: ${orderData.category}\n`
      + (orderData.restaurant ? `🏪 المطعم: ${orderData.restaurant}\n` : '')
      + `👤 العميل: +${orderData.phone}\n`
      + `📝 التفاصيل:\n${orderData.details}\n`
      + `📅 ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}\n`
      + `📊 الحالة: ⏳ قيد الانتظار (NEW)`;

    if (imageRelPath) {
      const fullPath = path.join(__dirname, 'public', imageRelPath.replace(/^\//, ''));
      if (fs.existsSync(fullPath)) {
        const media = MessageMedia.fromFilePath(fullPath);
        await client.sendMessage(adminJid, media, { caption: adminMsg });
        return;
      }
    }
    await client.sendMessage(adminJid, adminMsg);
  } catch (err) {
    console.error('⚠️ فشل في إرسال إشعار الطلب للأدمن:', err.message);
  }
}

// ─── WhatsApp Message Handler ────────────────────────────────────────────────

client.on('message', async (msg) => {
  try {
    // Ignore status broadcasts & group messages
    if (msg.from === 'status@broadcast' || msg.from.includes('@g.us')) return;

    const phone = msg.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    stmts.upsertUser.run(phone);
    const user = stmts.getUser.get(phone);

    const isSenderAdmin = isAdmin(phone, user);
    if (isSenderAdmin && user.is_admin !== 1) {
      stmts.setAdmin.run(1, phone);
    }

    const rawText = msg.body?.trim() || '';
    const text = normalizeDigits(rawText);
    const lower = text.toLowerCase();

    // ─── STEP 6: In-Chat Admin Commands ───────────────────────────────────────
    if (isSenderAdmin) {
      // 1. /add_restaurant <name>
      if (lower.startsWith('/add_restaurant')) {
        const restName = rawText.replace(/^\/add_restaurant/i, '').trim();
        if (!restName) {
          return msg.reply('⚠️ يرجى كتابة اسم المطعم مع الأمر:\nمثال: /add_restaurant كريب لافير');
        }
        stmts.setSelectedRestaurant.run(restName, 'ADMIN_WAITING_MENU_IMAGE', phone);
        return msg.reply(`📸 أرسل الآن صورة منيو مطعم "${restName}":`);
      }

      // Handler for 'ADMIN_WAITING_MENU_IMAGE' state
      if (user.state === 'ADMIN_WAITING_MENU_IMAGE') {
        if (lower === '/cancel' || lower === 'الغاء' || lower === 'إلغاء') {
          stmts.resetUser.run(phone);
          return msg.reply('❌ تم إلغاء إضافة المطعم.');
        }

        if (msg.hasMedia) {
          const media = await msg.downloadMedia();
          if (media) {
            const mime = media.mimetype || 'image/jpeg';
            const ext = mime.split('/')[1]?.split(';')[0] || 'jpg';
            const fileName = `menu_${Date.now()}.${ext}`;
            const destPath = path.join(uploadsDir, fileName);
            fs.writeFileSync(destPath, Buffer.from(media.data, 'base64'));
            const menuUrl = `/uploads/${fileName}`;
            const restName = user.selected_restaurant || 'مطعم جديد';
            stmts.insertRestaurant.run(restName, menuUrl);
            stmts.resetUser.run(phone);
            return msg.reply(`✅ تم بنجاح إضافة مطعم "${restName}" مع صورة المنيو! 📸🍔`);
          }
        }
        return msg.reply('⚠️ يرجى إرسال صورة المنيو، أو أرسل /cancel للإلغاء.');
      }

      // 2. /restaurants
      if (lower === '/restaurants') {
        const rests = stmts.getRestaurants.all();
        if (rests.length === 0) {
          return msg.reply('لا توجد مطاعم مسجلة حالياً.');
        }
        let reply = `📋 *قائمة المطاعم المسجلة (${rests.length}):*\n━━━━━━━━━━━━━━━━━\n`;
        for (const r of rests) {
          reply += `🆔 [${r.id}] ${r.name} ${r.menu_url ? '📸' : ''}\n`;
        }
        reply += `\n💡 لحذف مطعم: /del_restaurant <ID>\n💡 لإضافة مطعم: /add_restaurant <الاسم>`;
        return msg.reply(reply);
      }

      // 3. /del_restaurant <id>
      if (lower.startsWith('/del_restaurant')) {
        const idStr = lower.replace(/^\/del_restaurant/i, '').trim();
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          return msg.reply('⚠️ يرجى تحديد رقم المطعم:\nمثال: /del_restaurant 1');
        }
        const res = stmts.deleteRestaurant.run(id);
        if (res.changes > 0) {
          return msg.reply(`🗑️ تم حذف المطعم رقم (${id}) بنجاح.`);
        } else {
          return msg.reply(`⚠️ لم يتم العثور على مطعم برقم (${id}).`);
        }
      }

      // 4. /orders
      if (lower === '/orders') {
        const orders = stmts.lastOrders.all();
        if (orders.length === 0) {
          return msg.reply('لا توجد طلبات مسجلة بعد.');
        }
        let reply = `📦 *آخر 10 طلبات مسجلة:*\n━━━━━━━━━━━━━━━━━\n`;
        for (const o of orders) {
          const statusLabel = STATUS_LABELS[o.status] || o.status;
          reply += `🔖 *طلب #${o.id}* | ${o.category}${o.restaurant ? ` (${o.restaurant})` : ''}\n`
            + `👤 العميل: +${o.phone}\n`
            + `📊 الحالة: ${statusLabel}\n`
            + `📅 ${o.created_at}\n`
            + `📝 التفاصيل: ${o.details}\n`
            + `─────────────────\n`;
        }
        reply += `💡 لتغيير حالة طلب: /status <order_id> <new_status>`;
        return msg.reply(reply);
      }

      // 5. /status <order_id> <new_status>
      if (lower.startsWith('/status')) {
        const parts = lower.split(/\s+/);
        if (parts.length < 3) {
          return msg.reply('⚠️ الاستخدام: /status <order_id> <new_status>\nمثال: /status 5 accepted\nالحالات: accepted, delivering, completed, cancelled');
        }
        const orderId = parseInt(parts[1], 10);
        const newStatus = parts[2].toLowerCase();
        const validStatuses = ['new', 'pending', 'accepted', 'delivering', 'completed', 'cancelled'];
        if (!validStatuses.includes(newStatus)) {
          return msg.reply(`⚠️ حالة غير صالحة. الحالات المتاحة:\n${validStatuses.join(', ')}`);
        }
        const order = stmts.getOrder.get(orderId);
        if (!order) {
          return msg.reply(`⚠️ لم يتم العثور على الطلب #${orderId}.`);
        }
        stmts.updateOrderStatus.run(newStatus, orderId);
        const label = STATUS_LABELS[newStatus] || newStatus;
        await msg.reply(`✅ تم تحديث حالة الطلب #${orderId} إلى: ${label}`);

        // Notify customer
        if (order.phone) {
          const custJid = `${normalizePhone(order.phone)}@c.us`;
          const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
          if (notifyFn) {
            client.sendMessage(custJid, notifyFn(orderId)).catch((err) => {
              console.error(`فشل إشعار العميل ${order.phone}:`, err.message);
            });
          }
        }
        return;
      }

      // 6. /stats
      if (lower === '/stats') {
        const statsMsg = `📊 *إحصائيات بوت دليفري طنطا:*
━━━━━━━━━━━━━━━━━
👥 إجمالي العملاء المسجلين: ${stmts.countUsers.get().total}
🍽️ إجمالي المطاعم: ${stmts.countRestaurants.get().total}
📦 إجمالي كافة الطلبات: ${stmts.countOrders.get().total}
─────────────────
⏳ طلبات قيد الانتظار: ${stmts.countPending.get().total}
🛵 طلبات جاري توصيلها: ${stmts.countDelivering.get().total}
✅ طلبات تم تسليمها بنجاح: ${stmts.countCompleted.get().total}
❌ طلبات ملغاة: ${stmts.countCancelled.get().total}`;
        return msg.reply(statsMsg);
      }
    }

    // ─── STEP 7: Customer FSM (1:1 Telegram Replication) ──────────────────────

    // Command to restart or return to main menu
    if (['/start', 'start', 'menu', 'القائمة', 'قائمة', 'ابدأ', 'ابدا', 'الرئيسية'].includes(lower)) {
      stmts.resetUser.run(phone);
      stmts.setState.run('WAITING_CATEGORY', phone);
      return msg.reply(MAIN_MENU_TEXT);
    }

    // 1. 'IDLE' state
    if (user.state === 'IDLE') {
      stmts.setState.run('WAITING_CATEGORY', phone);
      return msg.reply(MAIN_MENU_TEXT);
    }

    // 2. 'WAITING_CATEGORY' state
    if (user.state === 'WAITING_CATEGORY') {
      // Option 1: دليفري وطلبات خاصة
      if (text === '1' || lower.includes('دليفري')) {
        stmts.setSelectedCategory.run('🛵 دليفري وطلبات خاصة', 'WAITING_DETAILS', phone);
        return msg.reply(PROMPT_DELIVERY);
      }

      // Option 2: مطاعم طنطا
      if (text === '2' || lower.includes('مطاعم') || lower.includes('مطعم')) {
        stmts.setSelectedCategory.run('🍔 مطاعم طنطا', 'WAITING_RESTAURANT_CHOICE', phone);
        const rests = stmts.getRestaurants.all();
        if (rests.length === 0) {
          stmts.setState.run('WAITING_DETAILS', phone);
          return msg.reply('🍔 *مطاعم طنطا*\n\nاكتب اسم المطعم والأصناف المطلوبة وعنوان التوصيل:');
        }
        let restListMsg = `🍔 *مطاعم طنطا*\n\nاختر المطعم المطلوب بإرسال رقمه:\n`;
        rests.forEach((r, idx) => {
          restListMsg += `\n${idx + 1}. ${r.name}`;
        });
        restListMsg += `\n\n👇 أرسل رقم المطعم للطلب أو عرض المنيو:`;
        return msg.reply(restListMsg);
      }

      // Option 3: تسوق من طنطا
      if (text === '3' || lower.includes('تسوق')) {
        stmts.setSelectedCategory.run('🛒 تسوق من طنطا', 'WAITING_DETAILS', phone);
        return msg.reply(PROMPT_SHOPPING);
      }

      // Option 4: صيدليات وأدوية طنطا
      if (text === '4' || lower.includes('صيدلي') || lower.includes('دواء') || lower.includes('روشتة')) {
        stmts.setSelectedCategory.run('💊 صيدليات وأدوية طنطا', 'WAITING_DETAILS', phone);
        return msg.reply(PROMPT_PHARMACY);
      }

      // Option 5: محلات المنطقة
      if (text === '5' || lower.includes('محلات') || lower.includes('محل')) {
        stmts.setSelectedCategory.run('🏪 محلات المنطقة', 'WAITING_DETAILS', phone);
        return msg.reply(PROMPT_SHOPS);
      }

      // Option 6: خدمة العملاء
      if (text === '6' || lower.includes('خدمة') || lower.includes('دعم')) {
        stmts.resetUser.run(phone);
        return msg.reply(PROMPT_SUPPORT);
      }

      return msg.reply(`⚠️ اختيار غير صحيح.\n\n${MAIN_MENU_TEXT}`);
    }

    // 'WAITING_RESTAURANT_CHOICE' state
    if (user.state === 'WAITING_RESTAURANT_CHOICE') {
      const rests = stmts.getRestaurants.all();
      let chosen = null;
      const num = parseInt(text, 10);
      if (!isNaN(num) && num >= 1 && num <= rests.length) {
        chosen = rests[num - 1];
      } else {
        chosen = rests.find((r) => r.name.toLowerCase().includes(lower));
      }

      if (!chosen) {
        return msg.reply('⚠️ لم يتم العثور على المطعم المطلوب. يرجى إرسال رقم المطعم من القائمة:');
      }

      stmts.setSelectedRestaurant.run(chosen.name, 'WAITING_DETAILS', phone);
      const promptText = `🏪 *طلب من: ${chosen.name}* (🍔 مطاعم طنطا)\n\nاكتب تفاصيل طلبك كاملة:\n• الأصناف المطلوبة والكميات\n• عنوان التوصيل بالتفصيل\n• رقم للتواصل (اختياري)`;

      if (chosen.menu_url) {
        if (chosen.menu_url.startsWith('http://') || chosen.menu_url.startsWith('https://')) {
          try {
            const media = await MessageMedia.fromUrl(chosen.menu_url, { unsafeMime: true });
            return client.sendMessage(msg.from, media, { caption: promptText });
          } catch {
            return msg.reply(`${promptText}\n\n📸 رابط المنيو: ${chosen.menu_url}`);
          }
        } else {
          const localPath = path.join(__dirname, 'public', chosen.menu_url.replace(/^\//, ''));
          if (fs.existsSync(localPath)) {
            const media = MessageMedia.fromFilePath(localPath);
            return client.sendMessage(msg.from, media, { caption: promptText });
          }
        }
      }
      return msg.reply(promptText);
    }

    // 3. 'WAITING_DETAILS' state
    if (user.state === 'WAITING_DETAILS') {
      let imageRelPath = null;
      let orderText = rawText;

      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            const mime = media.mimetype || 'image/jpeg';
            const ext = mime.split('/')[1]?.split(';')[0] || 'jpg';
            const fileName = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
            const destPath = path.join(uploadsDir, fileName);
            fs.writeFileSync(destPath, Buffer.from(media.data, 'base64'));
            imageRelPath = `/uploads/${fileName}`;
          }
        } catch (err) {
          console.error('⚠️ خطأ في حفظ صورة الطلب:', err.message);
        }

        if (!orderText || orderText.trim() === '') {
          orderText = msg.caption?.trim() || 'صورة مرفقة من العميل (روشتة / قائمة طلبات)';
        }
      }

      if (!orderText && !imageRelPath) {
        return msg.reply('⚠️ يرجى كتابة تفاصيل الطلب أو إرسال صورة واضحة.');
      }

      stmts.setPendingDetails.run(orderText, imageRelPath, 'WAITING_CONFIRMATION', phone);

      const summary = `📋 *ملخص طلبك:*\n\n`
        + `📂 القسم: ${user.selected_category || 'طلب دليفري'}\n`
        + (user.selected_restaurant ? `🏪 المطعم: ${user.selected_restaurant}\n` : '')
        + `📝 التفاصيل:\n${orderText}\n`
        + (imageRelPath ? `📸 تم إرفاق الصورة بنجاح ✅\n` : '')
        + `\nهل تريد تأكيد الطلب؟\n`
        + `1️⃣ ✅ تأكيد الطلب (أرسل 1)\n`
        + `2️⃣ ✏️ تعديل التفاصيل (أرسل 2)\n`
        + `3️⃣ ❌ إلغاء (أرسل 3)`;

      return msg.reply(summary);
    }

    // 4. 'WAITING_CONFIRMATION' state
    if (user.state === 'WAITING_CONFIRMATION') {
      // 1: Confirm
      if (['1', 'أكد', 'اكد', 'تأكيد', 'تاكيد', 'نعم', 'تمام', 'موافق', 'ok'].includes(lower)) {
        const result = stmts.insertOrder.run(
          phone,
          user.selected_category,
          user.selected_restaurant,
          user.pending_details,
          user.pending_image
        );
        const orderId = result.lastInsertRowid;

        const confirmMsg = `✅ *تم تأكيد طلبك بنجاح!*\n\n`
          + `🔖 رقم طلبك: *#${orderId}*\n`
          + `سيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`;
        await msg.reply(confirmMsg);

        await forwardOrderToAdmin(
          orderId,
          {
            phone,
            category: user.selected_category,
            restaurant: user.selected_restaurant,
            details: user.pending_details,
          },
          user.pending_image
        );

        stmts.resetUser.run(phone);
        return;
      }

      // 2: Edit
      if (['2', 'تعديل', 'عدل'].includes(lower)) {
        stmts.setState.run('WAITING_DETAILS', phone);
        return msg.reply('✏️ أعد إدخال تفاصيل طلبك:');
      }

      // 3: Cancel
      if (['3', 'إلغاء', 'الغاء', 'كنسل', 'لا'].includes(lower)) {
        stmts.resetUser.run(phone);
        return msg.reply('❌ تم إلغاء الطلب.');
      }

      return msg.reply('👆 الرجاء إرسال 1 للتأكيد، أو 2 للتعديل، أو 3 للإلغاء.');
    }

    // Fallback: restart
    stmts.resetUser.run(phone);
    stmts.setState.run('WAITING_CATEGORY', phone);
    return msg.reply(MAIN_MENU_TEXT);
  } catch (error) {
    console.error('❌ خطأ غير متوقع في معالجة الرسالة:', error);
    try {
      await msg.reply('حدث خطأ مؤقت، يرجى المحاولة مرة أخرى أو إرسال /start');
    } catch {}
  }
});

// Initialize WhatsApp client
client.initialize().catch((err) => {
  console.error('❌ فشل تشغيل عميل واتساب:', err.message);
});

// Graceful Shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 تم استلام إشارة (${signal})، إغلاق السيرفر والاتصال...`);
  server.close(() => {
    console.log('✅ تم إغلاق سيرفر Express.');
  });
  if (client) {
    client.destroy().catch(() => {});
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
