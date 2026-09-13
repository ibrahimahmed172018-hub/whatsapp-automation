const path = require('path');
const fs = require('fs');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { PORT, ADMIN_PHONE, ADMIN_PIN, STATUS_LABELS, CUSTOMER_STATUS_NOTIFICATIONS, DATA_DIR } = require('./config');
const { stmts } = require('./db');

// ─── Express App & Uploads Setup ─────────────────────────────────────────────

const app = express();

// المسارات الدائمة للبيانات وجلسة الواتساب (Railway Volume Support)
const targetAuthDir = path.join(DATA_DIR, '.wwebjs_auth');
const targetUploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(targetUploadsDir)) {
  try { fs.mkdirSync(targetUploadsDir, { recursive: true }); } catch {}
}

// ترحيل الجلسة والملفات القديمة إن وجدت محلياً
const localAuthDir = path.join(__dirname, '.wwebjs_auth');
if (path.resolve(localAuthDir) !== path.resolve(targetAuthDir) && !fs.existsSync(targetAuthDir) && fs.existsSync(localAuthDir)) {
  try {
    fs.cpSync(localAuthDir, targetAuthDir, { recursive: true });
    console.log(`📦 تم ترحيل جلسة واتساب إلى المسار الدائم: ${targetAuthDir}`);
  } catch (e) {}
}

const localUploadsDir = path.join(__dirname, 'public/uploads');
if (path.resolve(localUploadsDir) !== path.resolve(targetUploadsDir) && fs.existsSync(localUploadsDir)) {
  try {
    const files = fs.readdirSync(localUploadsDir);
    for (const f of files) {
      const src = path.join(localUploadsDir, f);
      const dst = path.join(targetUploadsDir, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (e) {}
}

app.use('/uploads', express.static(targetUploadsDir));
app.use('/uploads', express.static(localUploadsDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

let latestQR = null;
let isConnected = false;
let botReadyTime = null;

// Health Check
app.get('/', (req, res) => {
  res.send('🛵 بوت دليفري طنطا يعمل بنجاح في الخلفية! لوحة التحكم: /dashboard');
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
          p { color: #8696a0; font-size: 16px; line-height: 1.6; margin-bottom: 20px; }
          a { display: inline-block; padding: 10px 20px; background: #00a884; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>WhatsApp Connected Successfully ✅</h1>
          <p>بوت دليفري طنطا متصل وجاهز للعمل واستقبال الطلبات على مدار الساعة 🛵💨</p>
          <a href="/dashboard">الانتقال للوحة التحكم (Dashboard) 🚀</a>
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

// ─── Dashboard & REST API Endpoints ──────────────────────────────────────────

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

function checkAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.query.token;
  if (authHeader === 'Bearer admin-authorized' || authHeader === 'admin-authorized') {
    return next();
  }
  return res.status(401).json({ error: 'غير مصرح بالدخول' });
}

app.post('/api/login', (req, res) => {
  const { pin } = req.body || {};
  if (pin && String(pin).trim() === String(ADMIN_PIN).trim()) {
    return res.json({ success: true, token: 'admin-authorized' });
  }
  return res.status(401).json({ success: false, error: 'رمز PIN غير صحيح' });
});

app.get('/api/stats', checkAuth, (req, res) => {
  try {
    const groupRow = stmts.getSetting.get('drivers_group_id');
    res.json({
      isConnected,
      adminPhone: ADMIN_PHONE,
      driversGroupId: groupRow ? groupRow.value : null,
      totalOrders: stmts.countOrders.get().total,
      pending: stmts.countPending.get().total,
      delivering: stmts.countDelivering.get().total,
      completed: stmts.countCompleted.get().total,
      cancelled: stmts.countCancelled.get().total,
      totalUsers: stmts.countUsers.get().total,
      totalRestaurants: stmts.countRestaurants.get().total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', checkAuth, (req, res) => {
  try {
    const orders = stmts.allOrders.all();
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/status', checkAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { status, driverPhone } = req.body || {};
    if (!status) return res.status(400).json({ error: 'الحالة مطلوبة' });

    const order = stmts.getOrder.get(orderId);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    if (status === 'accepted' && driverPhone) {
      stmts.acceptOrder.run(driverPhone, orderId);
    } else {
      stmts.updateOrderStatus.run(status, orderId);
    }

    const custTarget = order.chat_jid || (order.phone && /^\d+$/.test(order.phone) ? `${order.phone}@c.us` : null);
    if (custTarget) {
      const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[status];
      if (notifyFn) {
        client.sendMessage(custTarget, notifyFn(orderId)).catch(() => {});
      }
    }

    res.json({ success: true, message: `تم تحديث حالة الطلب #${orderId} إلى ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', checkAuth, (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    stmts.deleteOrder.run(orderId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/restaurants', checkAuth, (req, res) => {
  try {
    res.json({ restaurants: stmts.getRestaurants.all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restaurants', checkAuth, (req, res) => {
  try {
    const { name, imageBase64 } = req.body || {};
    if (!name) return res.status(400).json({ error: 'اسم المطعم مطلوب' });
    let menuUrl = null;
    if (imageBase64) {
      const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      const ext = matches ? (matches[1].split('/')[1] || 'jpg') : 'jpg';
      const data = matches ? matches[2] : imageBase64;
      const fileName = `menu_${Date.now()}.${ext}`;
      const destPath = path.join(targetUploadsDir, fileName);
      fs.writeFileSync(destPath, Buffer.from(data, 'base64'));
      menuUrl = `/uploads/${fileName}`;
    }
    stmts.insertRestaurant.run(name.trim(), menuUrl);
    res.json({ success: true, message: `تمت إضافة مطعم ${name} بنجاح` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/restaurants/:id', checkAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    stmts.deleteRestaurant.run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/group', checkAuth, (req, res) => {
  try {
    const { groupId } = req.body || {};
    if (!groupId) return res.status(400).json({ error: 'معرف الجروب مطلوب' });
    stmts.setSetting.run('drivers_group_id', groupId.trim());
    res.json({ success: true, message: 'تم حفظ معرف جروب المناديب بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 سيرفر الويب يعمل على المنفذ: ${PORT}`);
  console.log(`📱 رابط صفحة الـ QR بالمتصفح: http://localhost:${PORT}/qr`);
  console.log(`📊 رابط لوحة التحكم (Dashboard): http://localhost:${PORT}/dashboard`);
});

// ─── WhatsApp Client Setup ───────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: targetAuthDir
  }),
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
      '--single-process',
      '--disable-blink-features=AutomationControlled'
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
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
  botReadyTime = Math.floor(Date.now() / 1000);
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
  botReadyTime = null;
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
للتواصل المباشر مع الإدارة والمندوب: ${ADMIN_PHONE}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDigits(text) {
  if (!text) return '';
  return text.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
}

function cleanPhoneNumber(str) {
  if (!str) return '';
  if (typeof str !== 'string') str = String(str);
  if (str.toLowerCase().includes('lid')) return '';
  let clean = str.replace(/[^0-9]/g, '');
  if (clean.startsWith('01') && clean.length === 11) {
    clean = '20' + clean.slice(1);
  } else if (clean.startsWith('0') && clean.length === 11) {
    clean = '20' + clean.slice(1);
  }
  if (clean.length < 9 || clean.length > 15) return '';
  return clean;
}

function normalizePhone(p) {
  return cleanPhoneNumber(p);
}

function isAdmin(phone, user) {
  if (user && user.is_admin === 1) return true;
  const adminTarget = cleanPhoneNumber(ADMIN_PHONE);
  const senderPhone = cleanPhoneNumber(phone);
  return !!(adminTarget && senderPhone && senderPhone === adminTarget);
}

function getAdminJid() {
  const norm = cleanPhoneNumber(ADMIN_PHONE);
  return norm ? `${norm}@c.us` : null;
}

/**
 * استخراج بيانات الاتصال الحقيقية (الرقم والاسم) وتفادي ظهور معرفات LID
 */
async function resolveContactInfo(client, msg, specificJid = null) {
  const jid = specificJid || msg?.author || msg?.participant || msg?.from || '';
  let phone = '';
  let name = '';

  // 1. إذا كان المعرف ينتهي بـ @c.us مباشرة
  if (jid && jid.includes('@c.us')) {
    const rawUser = jid.split('@')[0];
    const cleaned = cleanPhoneNumber(rawUser);
    if (cleaned) phone = cleaned;
  }

  // 2. محاولة جلب جهة الاتصال من واتساب
  try {
    const contact = (msg && !specificJid) ? await msg.getContact() : (jid ? await client.getContactById(jid) : null);
    if (contact) {
      name = contact.pushname || contact.name || '';
      if (!phone && contact.number) {
        const cleaned = cleanPhoneNumber(contact.number);
        if (cleaned) phone = cleaned;
      }
    }
  } catch (err) {}

  // 3. في حالة معرفات LID: استخدام دالة getContactLidAndPhone الداخلية لواتساب ويب
  if (!phone && jid && typeof client.getContactLidAndPhone === 'function') {
    try {
      const res = await client.getContactLidAndPhone([jid]);
      if (Array.isArray(res) && res[0] && res[0].pn) {
        const pnDigits = res[0].pn.split('@')[0];
        const cleaned = cleanPhoneNumber(pnDigits);
        if (cleaned) phone = cleaned;
      }
    } catch (err) {}
  }

  return {
    phone,
    name: (name || '').trim(),
    jid
  };
}

async function forwardOrderToAdmin(orderId, orderData, imageRelPath) {
  let customerDisplay = 'عميل واتساب';
  if (orderData.phone && /^\d+$/.test(orderData.phone)) {
    customerDisplay = `+${orderData.phone}${orderData.name ? ` (${orderData.name})` : ''}`;
  } else if (orderData.name) {
    customerDisplay = orderData.name;
  } else if (orderData.phone) {
    customerDisplay = orderData.phone;
  }

  const alertMsg = `🔔 *طلب جديد برقم #${orderId}*

📂 القسم: ${orderData.category}
${orderData.restaurant ? `🏪 المطعم: ${orderData.restaurant}\n` : ''}👤 العميل: ${customerDisplay}
📝 التفاصيل:
${orderData.details}
📅 ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}
📊 الحالة: ⏳ قيد الانتظار (NEW)
─────────────────
🛵 *لقبول الطلب:*
أرسل في الجروب:
*قبول ${orderId}*
أو اضغط رد (Reply) واكتب: *قبول*`;

  const groupRow = stmts.getSetting.get('drivers_group_id');
  const driversGroupId = groupRow ? groupRow.value : null;

  const targets = [];
  if (driversGroupId) targets.push(driversGroupId);

  const adminJid = getAdminJid();
  if (adminJid && !targets.includes(adminJid)) targets.push(adminJid);

  for (const target of targets) {
    try {
      if (imageRelPath) {
        let fullPath = path.join(targetUploadsDir, path.basename(imageRelPath));
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, 'public', imageRelPath.replace(/^\//, ''));
        }
        if (fs.existsSync(fullPath)) {
          const media = MessageMedia.fromFilePath(fullPath);
          await client.sendMessage(target, media, { caption: alertMsg });
          continue;
        }
      }
      await client.sendMessage(target, alertMsg);
    } catch (err) {
      console.error(`⚠️ فشل إرسال إشعار الطلب إلى ${target}:`, err.message);
    }
  }
}

// ─── Couriers Group Message Handler ──────────────────────────────────────────

async function handleGroupMessage(msg) {
  try {
    const rawText = msg.body?.trim() || '';
    const text = normalizeDigits(rawText);
    const lower = text.toLowerCase();
    const groupId = msg.from;

    // 1. Command to set/register this group as the drivers group
    if (
      lower.startsWith('/set_group') ||
      lower.startsWith('/setgroup') ||
      lower.startsWith('/drivers') ||
      lower.includes('تعيين الجروب') ||
      lower.includes('تفعيل الجروب') ||
      lower.includes('جروب المناديب')
    ) {
      stmts.setSetting.run('drivers_group_id', groupId);
      const confirmReply = `✅ *تم تعيين هذا الجروب كجروب المناديب الرسمي بنجاح!* 🛵💨\n\n`
        + `📌 سيتم إرسال جميع إشعارات الطلبات الجديدة هنا مباشرة للقبول والتوصيل.\n`
        + `💡 لقبول أي طلب، يرسل المندوب: *قبول <رقم_الطلب>* أو يرد على رسالة الطلب بـ *قبول*`;
      await msg.reply(confirmReply);
      return;
    }

    // 2. Command to check group ID: /group_id
    if (lower === '/group_id' || lower === 'معرف الجروب') {
      await msg.reply(`🆔 معرف هذا الجروب:\n\`${groupId}\``);
      return;
    }

    // 3. Command: /orders (عرض آخر 10 طلبات في الجروب)
    if (lower === '/orders' || lower === 'الطلبات' || lower === 'طلبات') {
      const orders = stmts.lastOrders.all();
      if (orders.length === 0) {
        return msg.reply('📦 لا توجد طلبات مسجلة حالياً.');
      }
      let reply = `📦 *آخر 10 طلبات مسجلة:*\n━━━━━━━━━━━━━━━━━\n`;
      for (const o of orders) {
        const statusLabel = STATUS_LABELS[o.status] || o.status;
        const custDisp = (o.phone && /^\d+$/.test(o.phone)) ? `+${o.phone}` : (o.phone || 'عميل واتساب');
        const driverDisp = o.driver_phone ? (o.driver_phone.startsWith('+') || !/^\d+$/.test(o.driver_phone) ? o.driver_phone : `+${o.driver_phone}`) : null;
        reply += `🔖 *طلب #${o.id}* | ${o.category}${o.restaurant ? ` (${o.restaurant})` : ''}\n`
          + `👤 العميل: ${custDisp}\n`
          + (driverDisp ? `🛵 المندوب: ${driverDisp}\n` : '')
          + `📊 الحالة: ${statusLabel}\n`
          + `📝 التفاصيل: ${o.details}\n`
          + `─────────────────\n`;
      }
      reply += `💡 لقبول طلب: *قبول <رقم_الطلب>*\n💡 لتحديث حالة: */status <رقم_الطلب> <الحالة>*`;
      return msg.reply(reply);
    }

    // 4. Command: /stats (إحصائيات البوت)
    if (lower === '/stats' || lower === 'الاحصائيات' || lower === 'إحصائيات' || lower === 'احصائيات') {
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

    // 5. Command: /status <order_id> <new_status> (تحديث حالة طلب من الجروب)
    if (lower.startsWith('/status')) {
      const parts = lower.split(/\s+/);
      if (parts.length < 3) {
        return msg.reply('⚠️ الاستخدام: /status <رقم_الطلب> <الحالة_الجديدة>\nمثال: /status 5 delivering\nالحالات: accepted, delivering, completed, cancelled');
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

      // إشعار العميل مباشرة
      const custTarget = order.chat_jid || (order.phone && /^\d+$/.test(order.phone) ? `${order.phone}@c.us` : null);
      if (custTarget) {
        const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
        if (notifyFn) {
          client.sendMessage(custTarget, notifyFn(orderId)).catch(() => {});
        }
      }
      return;
    }

    // 6. Command: /help (أوامر الجروب)
    if (lower === '/help' || lower === 'الاوامر' || lower === 'اوامر' || lower === 'أوامر') {
      const helpMsg = `🤖 *أوامر بوت دليفري طنطا في الجروب:*
━━━━━━━━━━━━━━━━━
🛵 *قبول <رقم>* : لقبول طلب وتوصيله للعميل (أو الرد على رسالة الطلب بـ قبول)
📦 */orders* : عرض آخر 10 طلبات ومتابعة حالتها
📊 */stats* : تقرير إحصائيات الطلبات
🔄 */status <رقم> <الحالة>* : تحديث حالة طلب (delivering, completed, cancelled)
⚙️ */set_group* : تعيين هذا الجروب كجروب المناديب الرسمي
🆔 */group_id* : عرض المعرف الخاص بالجروب`;
      return msg.reply(helpMsg);
    }

    // 7. Check if message is accepting an order
    let targetOrderId = null;
    const acceptMatch = text.match(/(?:^|\s)(?:قبول|استلام|\/accept|تم قبول)\s*#?(\d+)/i);
    if (acceptMatch) {
      targetOrderId = parseInt(acceptMatch[1], 10);
    } else if (msg.hasQuotedMsg) {
      const isAcceptWord = /^(?:قبول|استلام|\/accept|أنا|انا|تمام|تم|1)$/i.test(text.trim());
      if (isAcceptWord) {
        const quoted = await msg.getQuotedMessage();
        const quotedText = quoted?.body || quoted?.caption || '';
        const idMatch = quotedText.match(/#(\d+)/);
        if (idMatch) {
          targetOrderId = parseInt(idMatch[1], 10);
        }
      }
    }

    if (!targetOrderId) return;

    const order = stmts.getOrder.get(targetOrderId);
    if (!order) {
      await msg.reply(`⚠️ لم يتم العثور على طلب برقم #${targetOrderId}.`);
      return;
    }

    if (order.status !== 'NEW' && order.status !== 'pending') {
      const currentDriver = order.driver_phone ? (order.driver_phone.startsWith('+') || !/^\d+$/.test(order.driver_phone) ? order.driver_phone : `+${order.driver_phone}`) : 'مندوب آخر';
      const statusLabel = STATUS_LABELS[order.status] || order.status;
      await msg.reply(
        `⚠️ عذراً، الطلب #${targetOrderId} تم قبوله بالفعل مسبقاً بواسطة: *${currentDriver}*\n`
        + `📊 الحالة الحالية: ${statusLabel}`
      );
      return;
    }

    // استخراج بيانات المندوب وحل رقم الهاتف بدون ظهور lid
    const senderJid = msg.author || msg.participant || msg.from;
    const driverInfo = await resolveContactInfo(client, msg, senderJid);
    const driverDisplay = driverInfo.phone
      ? `+${driverInfo.phone}${driverInfo.name ? ` (${driverInfo.name})` : ''}`
      : (driverInfo.name || 'مندوب');
    const driverRecord = driverInfo.phone || driverInfo.name || 'مندوب';

    stmts.acceptOrder.run(driverRecord, targetOrderId);

    // بيانات تواصل العميل
    const customerDisplay = (order.phone && /^\d+$/.test(order.phone))
      ? `+${order.phone}`
      : (order.phone || 'عميل واتساب');

    // Confirmation to the couriers group
    const groupAlert = `🛵 *تم قبول الطلب #${targetOrderId} بنجاح!*
━━━━━━━━━━━━━━━━━
👤 *المندوب المسؤول:* ${driverDisplay}
📞 *تواصل العميل:* ${customerDisplay}
${order.restaurant ? `🏪 *المطعم:* ${order.restaurant}\n` : ''}📂 *القسم:* ${order.category}
📝 *التفاصيل:*
${order.details}
📊 *الحالة:* 🛵 مقبول وجاري التجهيز والتوصيل 💨`;

    await msg.reply(groupAlert);

    // Notify the customer directly on WhatsApp
    const custTarget = order.chat_jid || (order.phone && /^\d+$/.test(order.phone) ? `${order.phone}@c.us` : null);
    if (custTarget) {
      const custMsg = `🛵 *تحديث بخصوص طلبك #${targetOrderId}:*\n`
        + `تم قبول طلبك بواسطة المندوب (${driverDisplay}) وجاري تجهيزه وتوصيله إليك الآن! 💨`;
      client.sendMessage(custTarget, custMsg).catch((err) => {
        console.error(`فشل إشعار العميل:`, err.message);
      });
    }

    // Notify Admin if configured and not the same driver
    const adminTarget = cleanPhoneNumber(ADMIN_PHONE);
    if (adminTarget && adminTarget !== driverInfo.phone) {
      const adminNotify = `📢 *إشعار للإدارة:* قام المندوب (${driverDisplay}) بقبول الطلب #${targetOrderId}.`;
      client.sendMessage(`${adminTarget}@c.us`, adminNotify).catch(() => {});
    }
  } catch (err) {
    console.error('⚠️ خطأ في معالجة رسالة الجروب:', err.message);
  }
}

const BOT_START_TIME = Math.floor(Date.now() / 1000);

// ─── WhatsApp Message Handler ────────────────────────────────────────────────

client.on('message', async (msg) => {
  try {
    // Ignore completely if client is not ready yet
    if (!botReadyTime) return;

    // Discard historical/synced messages from before connection ready (with 60s buffer)
    if (msg.timestamp && botReadyTime && msg.timestamp < (botReadyTime - 60)) return;

    // Discard status broadcasts
    if (msg.from === 'status@broadcast') return;

    // Discard messages from self unless they are explicit commands (starting with / or keywords)
    if (msg.fromMe === true) {
      const body = msg.body?.trim() || '';
      const isCmd = body.startsWith('/') || body.includes('تعيين الجروب') || body.startsWith('قبول');
      if (!isCmd) return;
    }

    // Handle group messages (drivers group setup, commands & order acceptance)
    if (msg.from.includes('@g.us')) {
      await handleGroupMessage(msg);
      return;
    }

    // محادثات فردية (العملاء أو الإدارة)
    const chatJid = msg.from;
    const contactInfo = await resolveContactInfo(client, msg, chatJid);
    const resolvedPhone = contactInfo.phone || '';

    // حفظ واسترجاع حالة المحادثة باستخدام chatJid
    stmts.upsertUser.run(chatJid);
    const user = stmts.getUser.get(chatJid);

    const isSenderAdmin = isAdmin(resolvedPhone, user);
    if (isSenderAdmin && user.is_admin !== 1) {
      stmts.setAdmin.run(1, chatJid);
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
        stmts.setSelectedRestaurant.run(restName, 'ADMIN_WAITING_MENU_IMAGE', chatJid);
        return msg.reply(`📸 أرسل الآن صورة منيو مطعم "${restName}":`);
      }

      // Handler for 'ADMIN_WAITING_MENU_IMAGE' state
      if (user.state === 'ADMIN_WAITING_MENU_IMAGE') {
        if (lower === '/cancel' || lower === 'الغاء' || lower === 'إلغاء') {
          stmts.resetUser.run(chatJid);
          return msg.reply('❌ تم إلغاء إضافة المطعم.');
        }

        if (msg.hasMedia) {
          const media = await msg.downloadMedia();
          if (media) {
            const mime = media.mimetype || 'image/jpeg';
            const ext = mime.split('/')[1]?.split(';')[0] || 'jpg';
            const fileName = `menu_${Date.now()}.${ext}`;
            const destPath = path.join(targetUploadsDir, fileName);
            fs.writeFileSync(destPath, Buffer.from(media.data, 'base64'));
            const menuUrl = `/uploads/${fileName}`;
            const restName = user.selected_restaurant || 'مطعم جديد';
            stmts.insertRestaurant.run(restName, menuUrl);
            stmts.resetUser.run(chatJid);
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
          const custDisp = (o.phone && /^\d+$/.test(o.phone)) ? `+${o.phone}` : (o.phone || 'عميل واتساب');
          const driverDisp = o.driver_phone ? (o.driver_phone.startsWith('+') || !/^\d+$/.test(o.driver_phone) ? o.driver_phone : `+${o.driver_phone}`) : null;
          reply += `🔖 *طلب #${o.id}* | ${o.category}${o.restaurant ? ` (${o.restaurant})` : ''}\n`
            + `👤 العميل: ${custDisp}\n`
            + (driverDisp ? `🛵 المندوب: ${driverDisp}\n` : '')
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

        // Notify customer directly
        const custTarget = order.chat_jid || (order.phone && /^\d+$/.test(order.phone) ? `${order.phone}@c.us` : null);
        if (custTarget) {
          const notifyFn = CUSTOMER_STATUS_NOTIFICATIONS[newStatus];
          if (notifyFn) {
            client.sendMessage(custTarget, notifyFn(orderId)).catch((err) => {
              console.error(`فشل إشعار العميل:`, err.message);
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
      stmts.resetUser.run(chatJid);
      stmts.setState.run('WAITING_CATEGORY', chatJid);
      return msg.reply(MAIN_MENU_TEXT);
    }

    // 1. 'IDLE' state
    if (user.state === 'IDLE') {
      stmts.setState.run('WAITING_CATEGORY', chatJid);
      return msg.reply(MAIN_MENU_TEXT);
    }

    // 2. 'WAITING_CATEGORY' state
    if (user.state === 'WAITING_CATEGORY') {
      // Option 1: دليفري وطلبات خاصة
      if (text === '1' || lower.includes('دليفري')) {
        stmts.setSelectedCategory.run('🛵 دليفري وطلبات خاصة', 'WAITING_DETAILS', chatJid);
        return msg.reply(PROMPT_DELIVERY);
      }

      // Option 2: مطاعم طنطا
      if (text === '2' || lower.includes('مطاعم') || lower.includes('مطعم')) {
        stmts.setSelectedCategory.run('🍔 مطاعم طنطا', 'WAITING_RESTAURANT_CHOICE', chatJid);
        const rests = stmts.getRestaurants.all();
        if (rests.length === 0) {
          stmts.setState.run('WAITING_DETAILS', chatJid);
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
        stmts.setSelectedCategory.run('🛒 تسوق من طنطا', 'WAITING_DETAILS', chatJid);
        return msg.reply(PROMPT_SHOPPING);
      }

      // Option 4: صيدليات وأدوية طنطا
      if (text === '4' || lower.includes('صيدلي') || lower.includes('دواء') || lower.includes('روشتة')) {
        stmts.setSelectedCategory.run('💊 صيدليات وأدوية طنطا', 'WAITING_DETAILS', chatJid);
        return msg.reply(PROMPT_PHARMACY);
      }

      // Option 5: محلات المنطقة
      if (text === '5' || lower.includes('محلات') || lower.includes('محل')) {
        stmts.setSelectedCategory.run('🏪 محلات المنطقة', 'WAITING_DETAILS', chatJid);
        return msg.reply(PROMPT_SHOPS);
      }

      // Option 6: خدمة العملاء
      if (text === '6' || lower.includes('خدمة') || lower.includes('دعم')) {
        stmts.resetUser.run(chatJid);
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

      stmts.setSelectedRestaurant.run(chosen.name, 'WAITING_DETAILS', chatJid);
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
          let localPath = path.join(targetUploadsDir, path.basename(chosen.menu_url));
          if (!fs.existsSync(localPath)) {
            localPath = path.join(__dirname, 'public', chosen.menu_url.replace(/^\//, ''));
          }
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
            const destPath = path.join(targetUploadsDir, fileName);
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

      stmts.setPendingDetails.run(orderText, imageRelPath, 'WAITING_CONFIRMATION', chatJid);

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
        const phoneToStore = resolvedPhone || contactInfo.name || 'عميل واتساب';
        const result = stmts.insertOrder.run(
          phoneToStore,
          user.selected_category,
          user.selected_restaurant,
          user.pending_details,
          user.pending_image,
          chatJid
        );
        const orderId = result.lastInsertRowid;

        const confirmMsg = `✅ *تم تأكيد طلبك بنجاح!*\n\n`
          + `🔖 رقم طلبك: *#${orderId}*\n`
          + `سيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`;
        await msg.reply(confirmMsg);

        await forwardOrderToAdmin(
          orderId,
          {
            phone: resolvedPhone,
            name: contactInfo.name,
            chat_jid: chatJid,
            category: user.selected_category,
            restaurant: user.selected_restaurant,
            details: user.pending_details,
          },
          user.pending_image
        );

        stmts.resetUser.run(chatJid);
        return;
      }

      // 2: Edit
      if (['2', 'تعديل', 'عدل'].includes(lower)) {
        stmts.setState.run('WAITING_DETAILS', chatJid);
        return msg.reply('✏️ أعد إدخال تفاصيل طلبك:');
      }

      // 3: Cancel
      if (['3', 'إلغاء', 'الغاء', 'كنسل', 'لا'].includes(lower)) {
        stmts.resetUser.run(chatJid);
        return msg.reply('❌ تم إلغاء الطلب.');
      }

      return msg.reply('👆 الرجاء إرسال 1 للتأكيد، أو 2 للتعديل، أو 3 للإلغاء.');
    }

    // Fallback: restart
    stmts.resetUser.run(chatJid);
    stmts.setState.run('WAITING_CATEGORY', chatJid);
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
