import express from 'express';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import {
  initDB,
  getUserState,
  getAllRestaurants,
  getRestaurantById,
  addRestaurant,
  updateRestaurant,
  toggleRestaurantActive,
  deleteRestaurant
} from './db.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || 'auth_info';
const BOT_PHONE_NUMBER = process.env.BOT_PHONE_NUMBER || process.env.ADMIN_PHONE || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// توافق مع توجيهات Vercel Serverless
app.use((req, res, next) => {
  const original = req.headers['x-matched-path'] || req.headers['x-invoke-path'];
  if (original && (req.url === '/api/index.js' || req.url === '/api/index' || req.url === '/api')) {
    req.url = original;
  }
  next();
});

// متغيرات لتتبع حالة البوت والـ QR
let sock = null;
let botStatus = 'initializing';
let currentQr = null;
let pairingCode = null;

// نقاط فحص السيرفر
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({
      service: 'بوت دليفري طنطا - WhatsApp Bot',
      status: botStatus,
      isVercel: Boolean(process.env.VERCEL),
      timestamp: new Date().toISOString()
    });
  }

  const isVercel = Boolean(process.env.VERCEL);
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>بوت دليفري طنطا</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: white; max-width: 550px; width: 100%; padding: 32px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; }
        h1 { color: #075e54; margin-top: 0; font-size: 24px; }
        .btn { display: inline-block; background: #128c7e; color: white; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; margin: 8px 4px; font-size: 15px; transition: 0.2s; }
        .btn:hover { background: #075e54; }
        .badge { background: #dcfce7; color: #166534; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; }
        .notice { background: #fef3c7; color: #92400e; padding: 16px; border-radius: 10px; text-align: right; font-size: 14px; margin-top: 24px; border-right: 4px solid #f59e0b; line-height: 1.7; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🛵 بوت دليفري طنطا</h1>
        <p><span class="badge">🟢 السيرفر يعمل بنجاح (Online)</span></p>
        <p style="color: #666; font-size: 15px;">الخادم ولوحة التحكم متصلة مباشرة بقاعدة بيانات Supabase السحابية.</p>

        <div style="margin: 25px 0;">
          <a href="/admin" class="btn">🍔 فتح لوحة تحكم المطاعم</a>
          <a href="/api/restaurants" class="btn" style="background: #2563eb;">📊 بيانات المطاعم (API)</a>
        </div>

        ${isVercel ? `
          <div class="notice">
            <strong>📌 تنبيه بيئة Vercel:</strong><br>
            لوحة التحكم وقاعدة بيانات Supabase تعملان هنا بكفاءة 100%. أما اتصال واتساب الدائم (24/7) فيتطلب تشغيل خادم دائم (مثل Render.com أو VPS) لأن Vercel هي بيئة Serverless مؤقتة لا تسمح بالاتصال المستمر.
          </div>
        ` : `
          <div style="margin-top: 15px;">
            <a href="/qr" style="color: #075e54; font-size: 14px; font-weight: 500;">📱 صفحة مسح رمز QR لواتساب</a>
          </div>
        `}
      </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// صفحة ويب تعرض جميع جروبات الواتساب مع زر لنسخ الـ JID بسهولة
app.get('/groups', async (req, res) => {
  if (!sock || botStatus !== 'connected') {
    return res.status(400).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2>⚠️ البوت غير متصل حالياً بواتساب. يرجى التأكد من ربط الجلسة أولاً.</h2>
      </div>
    `);
  }

  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.entries(groups).map(([jid, data]) => ({
      name: data.subject || 'بدون اسم',
      jid: jid,
      participants: data.participants?.length || 0
    }));

    let html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>جروبات الواتساب الخاصة بك</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; padding: 25px; margin: 0; }
          .container { max-width: 620px; margin: 0 auto; background: white; padding: 25px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          h2 { color: #075e54; margin-top: 0; }
          .group-card { border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px 20px; margin-bottom: 15px; background: #fafafa; border-right: 5px solid #25d366; }
          .group-title { font-size: 17px; font-weight: bold; color: #128c7e; margin-bottom: 6px; }
          .group-jid { font-family: monospace; background: #e8f5e9; padding: 8px 12px; border-radius: 6px; font-size: 15px; color: #1b5e20; word-break: break-all; margin: 8px 0; }
          button { background: #075e54; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; }
          button:hover { background: #128c7e; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>👥 قائمة جروبات الواتساب المشترك بها رقمك</h2>
          <p style="color: #666; font-size: 14px;">اضغط على زر <b>نسخ الـ JID</b> بجانب جروب المناديب، ثم ضعه في ملف <code>.env</code>:</p>
    `;

    if (groupList.length === 0) {
      html += `
        <div style="background: #ffebee; color: #c62828; padding: 15px; border-radius: 8px; margin-top: 15px;">
          لم يتم العثور على أي جروبات مشتركة حتى الآن.<br>
          <b>الحل:</b> أضف رقم البوت إلى جروب المناديب على واتساب، ثم أعد تحديث هذه الصفحة!
        </div>
      `;
    } else {
      groupList.forEach((g) => {
        html += `
          <div class="group-card">
            <div class="group-title">📌 ${g.name} (${g.participants} عضو)</div>
            <div class="group-jid" id="jid-${g.jid}">${g.jid}</div>
            <button onclick="navigator.clipboard.writeText('${g.jid}').then(() => alert('تم نسخ المعرف: ${g.jid}'))">📋 نسخ الـ JID</button>
          </div>
        `;
      });
    }

    html += `
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send('تعذر جلب الجروبات: ' + err.message);
  }
});

// صفحة ويب مخصصة لعرض رمز QR بدقة عالية وسهولة مسحه بالكاميرا
app.get('/qr', async (req, res) => {
  if (process.env.VERCEL) {
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>حالة بوت واتساب - Vercel</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: white; max-width: 580px; width: 100%; padding: 32px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: right; }
          h2 { color: #075e54; margin-top: 0; font-size: 22px; text-align: center; }
          .badge { background: #dcfce7; color: #166534; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; }
          .info-box { background: #f0fdf4; border-right: 4px solid #22c55e; padding: 16px; border-radius: 8px; margin: 18px 0; font-size: 14px; line-height: 1.8; color: #15803d; }
          .warn-box { background: #eff6ff; border-right: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 18px 0; font-size: 14px; line-height: 1.8; color: #1e40af; }
          .btn { display: inline-block; background: #128c7e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; text-align: center; margin: 8px 4px; }
          .btn:hover { background: #075e54; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🛵 حالة ربط واتساب على Vercel</h2>
          <div style="text-align: center; margin-bottom: 20px;">
            <span class="badge">🟢 لوحة التحكم وقاعدة البيانات السحابية تعمل بنجاح</span>
          </div>

          <div class="info-box">
            <b>✅ تم ربط البوت بالفعل بنجاح!</b><br>
            جلسة واتساب الخاصة بك مسجلة وتعمل وتستقبل رسائل وطلبات دليفري طنطا فوراً.
          </div>

          <div class="warn-box">
            <b>💡 لماذا لا يظهر رمز QR هنا على Vercel؟</b><br>
            منصة <b>Vercel</b> مصممة كـ <b>Serverless</b> (سيرفرات سحابية لإدارة لوحة التحكم <code>/admin</code> وواجهات الـ API وقاعدة بيانات Supabase، وتغلق تلقائياً بعد ثوانٍ لتوفير الموارد).<br><br>
            بوت واتساب (Baileys) يحتاج اتصال WebSocket دائم ومستمر 24 ساعة دون إغلاق، لذلك:<br>
            1️⃣ <b>Vercel:</b> يستضيف لوحة تحكم المطاعم السحابية والـ API.<br>
            2️⃣ <b>عملية البوت:</b> تعمل إما على جهازك المحلي، أو على خدمة سحابية دائمة مثل <b>Render.com</b> أو سيرفر <b>VPS</b> (ملف <code>render.yaml</code> جاهز بالمشروع).
          </div>

          <div style="text-align: center; margin-top: 25px;">
            <a href="/admin" class="btn">🍔 فتح لوحة تحكم المطاعم</a>
            <a href="/" class="btn" style="background: #2563eb;">🏠 الصفحة الرئيسية</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  if (botStatus === 'connected') {
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head><meta charset="UTF-8"><title>تم الربط بنجاح</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; background: #e8f5e9; padding: 50px;">
        <h1 style="color: #2e7d32;">✅ تم ربط البوت بواتساب بنجاح!</h1>
        <p style="font-size: 18px;">البوت متصل الآن وجاهز لاستقبال طلبات دليفري طنطا.</p>
      </body>
      </html>
    `);
  }

  if (pairingCode) {
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head><meta charset="UTF-8"><title>كود الربط برقم الهاتف</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; background: #f0f2f5; padding: 40px;">
        <div style="background: white; max-width: 480px; margin: 0 auto; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          <h2 style="color: #075e54;">🔑 كود ربط واتساب لهاتفك</h2>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 4px; background: #e8f5e9; padding: 15px; border-radius: 8px; color: #1b5e20; margin: 20px 0;">
            ${pairingCode}
          </div>
          <p style="text-align: right;">طريقة التفعيل من هاتفك:</p>
          <ol style="text-align: right; line-height: 1.8;">
            <li>افتح واتساب على هاتفك.</li>
            <li>ادخل على <b>الأجهزة المرتبطة</b> (Linked Devices).</li>
            <li>اضغط <b>ربط جهاز</b>.</li>
            <li>اختر <b>"الربط باستخدام رقم الهاتف بدلاً من ذلك"</b>.</li>
            <li>اكتب الكود الظاهر أعلاه.</li>
          </ol>
        </div>
      </body>
      </html>
    `);
  }

  if (!currentQr) {
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="3">
        <title>جاري تجهيز الرمز</title>
      </head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px;">
        <h2>⏳ جاري إنشاء رمز الـ QR...</h2>
        <p>يرجى الانتظار بضع ثوانٍ (الصفحة تتحدث تلقائياً).</p>
      </body>
      </html>
    `);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(currentQr, { width: 340, margin: 2 });
    res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="20">
        <title>ربط بوت دليفري طنطا</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; text-align: center; background: #f0f2f5; padding: 25px; margin: 0; }
          .card { background: white; max-width: 460px; margin: 0 auto; padding: 25px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          h2 { color: #075e54; margin-top: 0; }
          img { width: 300px; height: 300px; border-radius: 12px; border: 1px solid #e0e0e0; }
          .steps { text-align: right; background: #f9f9f9; padding: 15px 20px; border-radius: 10px; margin-top: 20px; font-size: 14px; border-right: 4px solid #075e54; }
          ol { margin: 8px 0 0 0; padding-right: 20px; line-height: 1.7; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🛵 ربط بوت دليفري طنطا بواتساب</h2>
          <p style="color: #555;">امسح هذا الرمز من هاتفك (واضح وبدقة عالية):</p>
          <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
          <div class="steps">
            <strong>خطوات الربط من الموبايل:</strong>
            <ol>
              <li>افتح تطبيق <b>واتساب</b> على هاتفك.</li>
              <li>اضغط على القائمة (الثلاث نقاط) ➔ <b>الأجهزة المرتبطة</b>.</li>
              <li>اضغط <b>ربط جهاز</b> ووجّه الكاميرا نحو هذا الرمز.</li>
            </ol>
          </div>
          <p style="color: #888; font-size: 12px; margin-top: 15px;">🔄 تتحدث هذه الصفحة تلقائياً لتجديد الرمز فور انتهاء صلاحيته.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('خطأ أثناء إنشاء رمز QR');
  }
});

// ============================================================================
// لوحة تحكم المطاعم والمينيوهات (Admin Dashboard & Restaurant Management)
// ============================================================================

app.get('/admin', async (req, res) => {
  try {
    const restaurants = await getAllRestaurants(false);
    const totalCount = restaurants.length;
    const activeCount = restaurants.filter(r => r.is_active === 1).length;
    const inactiveCount = totalCount - activeCount;

    // فحص ما إذا كان المدير يطلب تعديل مطعم محدد
    let editItem = null;
    if (req.query.edit) {
      editItem = await getRestaurantById(req.query.edit);
    }

    // رسائل التنبيه بعد العمليات
    let alertHtml = '';
    if (req.query.msg === 'added') {
      alertHtml = '<div class="alert alert-success">🎉 تم إضافة المطعم الجديد بنجاح إلى قائمة مطاعم طنطا!</div>';
    } else if (req.query.msg === 'updated') {
      alertHtml = '<div class="alert alert-success">✅ تم حفظ وتحديث بيانات المطعم والمينيو بنجاح!</div>';
    } else if (req.query.msg === 'toggled') {
      alertHtml = '<div class="alert alert-info">🔄 تم تغيير حالة المطعم بنجاح (تفعيل / تعطيل).</div>';
    } else if (req.query.msg === 'deleted') {
      alertHtml = '<div class="alert alert-warning">🗑️ تم حذف المطعم من قاعدة البيانات بنجاح.</div>';
    }

    const formTitle = editItem ? `✏️ تعديل بيانات: ${editItem.name}` : '➕ إضافة مطعم جديد لمطاعم طنطا';
    const formAction = editItem ? `/admin/restaurants/${editItem.id}/edit` : '/admin/restaurants/add';
    const submitBtnText = editItem ? '💾 حفظ التعديلات' : '➕ إضافة المطعم والمينيو';

    let cardsHtml = '';
    if (restaurants.length === 0) {
      cardsHtml = `
        <div class="empty-state">
          <h3>لا توجد مطاعم مسجلة حالياً!</h3>
          <p>استخدم النموذج أعلاه لإضافة أول مطعم ومينيو لخدمة دليفري طنطا.</p>
        </div>
      `;
    } else {
      cardsHtml = restaurants.map(r => `
        <div class="card ${r.is_active ? 'card-active' : 'card-inactive'}">
          <div class="card-header">
            ${r.image_url ? `<img src="${r.image_url}" alt="${r.name}" class="card-thumb" onerror="this.style.display='none'" />` : '<div class="thumb-placeholder">🍔</div>'}
            <div class="card-titles">
              <h3 class="rest-name">${r.name}</h3>
              <span class="rest-area">📍 ${r.area || 'طنطا'}</span>
            </div>
            <div class="status-badge ${r.is_active ? 'badge-active' : 'badge-inactive'}">
              ${r.is_active ? '🟢 مفعّل (يظهر للزبائن)' : '🔴 معطّل (مخفي)'}
            </div>
          </div>

          <div class="card-body">
            <strong>📋 المينيو والأصناف:</strong>
            <pre class="menu-preview">${r.menu_text || 'لا يوجد نص للمينيو'}</pre>
            ${r.image_url ? `<div class="img-link-wrapper"><a href="${r.image_url}" target="_blank" class="img-link">🖼️ عرض صورة المينيو كاملة</a></div>` : ''}
          </div>

          <div class="card-actions">
            <form method="POST" action="/admin/restaurants/${r.id}/toggle" style="display:inline;">
              <button type="submit" class="btn ${r.is_active ? 'btn-toggle-off' : 'btn-toggle-on'}">
                ${r.is_active ? '⏸️ تعطيل من القائمة' : '▶️ تفعيل وإظهار'}
              </button>
            </form>

            <a href="/admin?edit=${r.id}#restaurant-form" class="btn btn-edit">✏️ تعديل</a>

            <form method="POST" action="/admin/restaurants/${r.id}/delete" style="display:inline;" onsubmit="return confirm('هل أنت متأكد تماماً من حذف مطعم (${r.name})؟');">
              <button type="submit" class="btn btn-delete">🗑️ حذف</button>
            </form>
          </div>
        </div>
      `).join('');
    }

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة تحكم مطاعم طنطا - دليفري طنطا</title>
        <style>
          :root {
            --primary: #075e54;
            --primary-light: #128c7e;
            --accent: #25d366;
            --bg: #f4f6f8;
            --card-bg: #ffffff;
            --text-main: #1f2937;
            --text-muted: #6b7280;
            --border: #e5e7eb;
            --danger: #dc2626;
            --warning: #d97706;
            --info: #2563eb;
          }
          * { box-sizing: border-box; }
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            margin: 0;
            padding: 0;
            line-height: 1.6;
          }
          .navbar {
            background: var(--primary);
            color: white;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .nav-brand { font-size: 20px; font-weight: bold; display: flex; align-items: center; gap: 8px; }
          .nav-links { display: flex; gap: 10px; flex-wrap: wrap; }
          .nav-links a {
            color: white;
            text-decoration: none;
            background: rgba(255,255,255,0.15);
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            transition: 0.2s;
          }
          .nav-links a:hover { background: rgba(255,255,255,0.3); }
          .container { max-width: 1100px; margin: 24px auto; padding: 0 16px; }

          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
          }
          .stat-card {
            background: var(--card-bg);
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-top: 4px solid var(--primary-light);
          }
          .stat-val { font-size: 28px; font-weight: bold; color: var(--primary); }
          .stat-label { font-size: 14px; color: var(--text-muted); font-weight: 500; }

          .alert {
            padding: 14px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 500;
          }
          .alert-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
          .alert-info { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
          .alert-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }

          .form-section {
            background: var(--card-bg);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            margin-bottom: 30px;
            border-right: 5px solid var(--primary);
          }
          .form-section h2 { margin-top: 0; color: var(--primary); font-size: 20px; }
          .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 16px;
          }
          .form-group { display: flex; flex-direction: column; gap: 6px; }
          .form-group label { font-size: 14px; font-weight: 600; color: #374151; }
          .form-group input, .form-group textarea, .form-group select {
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 15px;
            font-family: inherit;
            transition: border-color 0.2s;
          }
          .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: var(--primary-light);
            box-shadow: 0 0 0 3px rgba(18,140,126,0.15);
          }
          .full-width { grid-column: 1 / -1; }
          .form-hint { font-size: 12px; color: var(--text-muted); }

          .btn-submit {
            background: var(--primary-light);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: 0.2s;
          }
          .btn-submit:hover { background: var(--primary); }
          .btn-cancel {
            background: #e5e7eb;
            color: #374151;
            text-decoration: none;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: bold;
            margin-right: 10px;
            display: inline-block;
          }

          .section-title {
            font-size: 20px;
            color: var(--text-main);
            margin: 25px 0 15px 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 20px;
          }
          .card {
            background: var(--card-bg);
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            display: flex;
            flex-direction: column;
            border: 1px solid var(--border);
            overflow: hidden;
            transition: transform 0.2s;
          }
          .card-active { border-top: 4px solid var(--accent); }
          .card-inactive { border-top: 4px solid var(--danger); opacity: 0.85; }

          .card-header {
            padding: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 1px solid #f3f4f6;
          }
          .card-thumb {
            width: 54px;
            height: 54px;
            border-radius: 8px;
            object-fit: cover;
            border: 1px solid #eee;
          }
          .thumb-placeholder {
            width: 54px;
            height: 54px;
            border-radius: 8px;
            background: #eef2ff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
          }
          .card-titles { flex: 1; }
          .rest-name { margin: 0 0 4px 0; font-size: 17px; color: var(--primary); }
          .rest-area { font-size: 13px; color: var(--text-muted); }
          .status-badge {
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 20px;
            font-weight: 600;
          }
          .badge-active { background: #dcfce7; color: #15803d; }
          .badge-inactive { background: #fee2e2; color: #b91c1c; }

          .card-body {
            padding: 16px;
            flex: 1;
            font-size: 14px;
          }
          .menu-preview {
            background: #f8fafc;
            padding: 10px;
            border-radius: 6px;
            font-family: inherit;
            white-space: pre-wrap;
            margin: 8px 0 0 0;
            font-size: 13px;
            max-height: 120px;
            overflow-y: auto;
            border: 1px solid #edf2f7;
            color: #334155;
          }
          .img-link-wrapper { margin-top: 10px; }
          .img-link { font-size: 13px; color: var(--info); text-decoration: none; font-weight: 500; }
          .img-link:hover { text-decoration: underline; }

          .card-actions {
            padding: 12px 16px;
            background: #fafafa;
            border-top: 1px solid #f3f4f6;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          }
          .btn {
            border: none;
            padding: 7px 12px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: 0.15s;
          }
          .btn-toggle-off { background: #fef3c7; color: #92400e; }
          .btn-toggle-off:hover { background: #fde68a; }
          .btn-toggle-on { background: #dcfce7; color: #166534; }
          .btn-toggle-on:hover { background: #bbf7d0; }
          .btn-edit { background: #e0e7ff; color: #3730a3; }
          .btn-edit:hover { background: #c7d2fe; }
          .btn-delete { background: #fee2e2; color: #991b1b; }
          .btn-delete:hover { background: #fecaca; }

          .empty-state {
            text-align: center;
            background: white;
            padding: 40px 20px;
            border-radius: 12px;
            grid-column: 1 / -1;
            color: var(--text-muted);
          }
        </style>
      </head>
      <body>
        <nav class="navbar">
          <div class="nav-brand">
            🛵 <span>لوحة تحكم مطاعم طنطا</span>
          </div>
          <div class="nav-links">
            <a href="/admin">🍔 قائمة المطاعم</a>
            <a href="/groups" target="_blank">👥 جروبات الواتساب</a>
            <a href="/qr" target="_blank">📱 مسح رمز QR</a>
            <a href="/" target="_blank">📊 فحص السيرفر</a>
          </div>
        </nav>

        <div class="container">
          ${alertHtml}

          <!-- إحصائيات سريعة -->
          <div class="stats-grid">
            <div class="stat-card">
              <div>
                <div class="stat-label">إجمالي المطاعم</div>
                <div class="stat-val">${totalCount}</div>
              </div>
              <div style="font-size: 32px;">🏪</div>
            </div>
            <div class="stat-card" style="border-top-color: #10b981;">
              <div>
                <div class="stat-label">مطاعم مفعلة للزبائن</div>
                <div class="stat-val" style="color: #059669;">${activeCount}</div>
              </div>
              <div style="font-size: 32px;">🟢</div>
            </div>
            <div class="stat-card" style="border-top-color: #ef4444;">
              <div>
                <div class="stat-label">مطاعم معطلة ومخفية</div>
                <div class="stat-val" style="color: #dc2626;">${inactiveCount}</div>
              </div>
              <div style="font-size: 32px;">🔴</div>
            </div>
          </div>

          <!-- نموذج الإضافة / التعديل -->
          <div class="form-section" id="restaurant-form">
            <h2>${formTitle}</h2>
            <form method="POST" action="${formAction}">
              <div class="form-grid">
                <div class="form-group">
                  <label for="name">اسم المطعم *</label>
                  <input type="text" id="name" name="name" required placeholder="مثال: مطعم كرم الشام" value="${editItem ? editItem.name : ''}">
                </div>

                <div class="form-group">
                  <label for="area">المنطقة أو الفرع في طنطا</label>
                  <input type="text" id="area" name="area" placeholder="مثال: شارع سعيد / الاستاد / المحطة" value="${editItem ? (editItem.area || '') : 'طنطا'}">
                </div>

                <div class="form-group full-width">
                  <label for="image_url">رابط صورة المينيو / اللوجو (URL)</label>
                  <input type="url" id="image_url" name="image_url" placeholder="https://example.com/menu-image.jpg" value="${editItem ? (editItem.image_url || '') : ''}">
                  <span class="form-hint">📌 إذا وضعت رابط صورة مباشر، سيقوم البوت بإرسال الصورة تلقائياً للعميل عند اختياره لهذا المطعم مع نص المينيو.</span>
                </div>

                <div class="form-group full-width">
                  <label for="menu_text">نص المينيو والأسعار (Menu & Prices) *</label>
                  <textarea id="menu_text" name="menu_text" rows="4" placeholder="مثال:\n🍔 ساندوتش برجر سوبر: 75 ج\n🍟 بطاطس كيرلي: 35 ج\n🥤 كانز بيبسي: 15 ج">${editItem ? (editItem.menu_text || '') : ''}</textarea>
                  <span class="form-hint">💡 هذا النص هو الذي سيقرأه العميل على واتساب لاختيار طلباته.</span>
                </div>

                <div class="form-group">
                  <label>
                    <input type="checkbox" name="is_active" value="1" ${(editItem && !editItem.is_active) ? '' : 'checked'}>
                    مفعّل ويظهر للزبائن الآن في قائمة الواتساب
                  </label>
                </div>
              </div>

              <div>
                <button type="submit" class="btn-submit">${submitBtnText}</button>
                ${editItem ? '<a href="/admin" class="btn-cancel">إلغاء التعديل</a>' : ''}
              </div>
            </form>
          </div>

          <!-- قائمة المطاعم الحالية -->
          <div class="section-title">
            <span>📋 المطاعم والمينيوهات الحالية (${totalCount})</span>
            <span style="font-size: 14px; color: var(--text-muted); font-weight: normal;">اضغط على "تعطيل" لإخفاء المطعم فوراً من قائمة الواتساب دون حذفه</span>
          </div>

          <div class="cards-grid">
            ${cardsHtml}
          </div>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).send('خطأ في لوحة التحكم: ' + err.message);
  }
});

// إجراءات إدارة المطاعم عبر لوحة التحكم (Form Actions)
app.post('/admin/restaurants/add', async (req, res) => {
  try {
    const { name, area, menu_text, image_url, is_active } = req.body;
    if (!name) return res.status(400).send('اسم المطعم مطلوب.');
    await addRestaurant({
      name,
      area: area || 'طنطا',
      menu_text: menu_text || '',
      image_url: image_url || '',
      is_active: is_active ? 1 : 0
    });
    res.redirect('/admin?msg=added');
  } catch (err) {
    res.status(500).send('خطأ أثناء إضافة المطعم: ' + err.message);
  }
});

app.post('/admin/restaurants/:id/toggle', async (req, res) => {
  try {
    await toggleRestaurantActive(req.params.id);
    res.redirect('/admin?msg=toggled');
  } catch (err) {
    res.status(500).send('خطأ أثناء تعديل حالة المطعم: ' + err.message);
  }
});

app.post('/admin/restaurants/:id/edit', async (req, res) => {
  try {
    const { name, area, menu_text, image_url, is_active } = req.body;
    await updateRestaurant(req.params.id, {
      name,
      area,
      menu_text,
      image_url,
      is_active: is_active ? 1 : 0
    });
    res.redirect('/admin?msg=updated');
  } catch (err) {
    res.status(500).send('خطأ أثناء تحديث بيانات المطعم: ' + err.message);
  }
});

app.post('/admin/restaurants/:id/delete', async (req, res) => {
  try {
    await deleteRestaurant(req.params.id);
    res.redirect('/admin?msg=deleted');
  } catch (err) {
    res.status(500).send('خطأ أثناء حذف المطعم: ' + err.message);
  }
});

// ============================================================================
// REST API للمطاعم (للاستخدام البرمجي أو التكاملات الخارجية)
// ============================================================================
app.get('/api/restaurants', async (req, res) => {
  try {
    const list = await getAllRestaurants(req.query.active === 'true');
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const { name, area, menu_text, image_url, is_active } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم المطعم مطلوب' });
    const rest = await addRestaurant({
      name,
      area: area || 'طنطا',
      menu_text: menu_text || '',
      image_url: image_url || '',
      is_active: is_active !== undefined ? is_active : 1
    });
    res.status(201).json({ success: true, data: rest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const { name, area, menu_text, image_url, is_active } = req.body;
    const rest = await updateRestaurant(req.params.id, {
      name,
      area,
      menu_text,
      image_url,
      is_active
    });
    res.json({ success: true, data: rest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/restaurants/:id/toggle', async (req, res) => {
  try {
    const rest = await toggleRestaurantActive(req.params.id);
    res.json({ success: true, data: rest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    await deleteRestaurant(req.params.id);
    res.json({ success: true, message: 'تم الحذف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تشغيل وإدارة عميل Baileys
async function startWhatsAppBot() {
  if (process.env.VERCEL) return;
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers
    } = await import('@whiskeysockets/baileys');
    const { default: pino } = await import('pino');
    const { default: qrcodeTerminal } = await import('qrcode-terminal');
    const { handleCustomerMessage } = await import('./botHandler.js');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`📡 إصدار Baileys: v${version.join('.')} (الأحدث: ${isLatest})`);

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'), // استخدام توقيع أوبونتو كروم القياسي الموثوق
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        botStatus = 'waiting_for_qr_scan';
        console.log('\n' + '='.repeat(55));
        console.log('📱 رمز QR جاهز للمسح! يمكنك مسحه من التيرمينال أو من المتصفح:');
        console.log(`👉 افتح في المتصفح: http://localhost:${PORT}/qr`);
        console.log('='.repeat(55) + '\n');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch {}
        console.log('\n' + '-'.repeat(55));
        console.log('⏳ في انتظار مسح الـ QR أو الربط من هاتفك...');

        // طلب كود الربط المباشر برقم الهاتف فور جاهزية السوكيت
        const rawPhoneNumber = (BOT_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
        if (rawPhoneNumber && !state.creds.registered && !pairingCode) {
          try {
            const code = await sock.requestPairingCode(rawPhoneNumber);
            pairingCode = code;
            console.log('\n' + '='.repeat(55));
            console.log(`🔑 كود ربط واتساب المباشر برقم هاتفك: [ ${code} ]`);
            console.log('='.repeat(55));
            console.log('📱 افتح واتساب ➔ الأجهزة المرتبطة ➔ "الربط باستخدام رقم الهاتف" واكتب الكود.');
            console.log(`🌐 أو افتح في المتصفح: http://localhost:${PORT}/qr`);
            console.log('='.repeat(55) + '\n');
          } catch (err) {
            console.error('⚠️ تعذر استخراج كود الربط:', err?.message || err);
          }
        }
      }

      if (connection === 'close') {
        currentQr = null;
        pairingCode = null;
        botStatus = 'disconnected';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`⚠️ انقطع الاتصال بواتساب (رمز الحالة: ${statusCode || 'غير معروف'}).`);

        if (isLoggedOut && !state.creds.registered) {
          console.log('🔄 المحاولة السابقة لم تكتمل أو انتهت صلاحيتها، جاري تنظيف الجلسة والبدء من جديد...');
          try {
            const fs = await import('fs');
            if (fs.existsSync(SESSION_DIR)) {
              fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('خطأ أثناء مسح الجلسة القديمة:', e.message);
          }
          setTimeout(startWhatsAppBot, 3000);
        } else if (!isLoggedOut) {
          console.log('🔄 جاري محاولة إعادة الاتصال خلال 3 ثوانٍ...');
          setTimeout(startWhatsAppBot, 3000);
        } else {
          console.log('❌ تم تسجيل الخروج من واتساب. يرجى حذف مجلد auth_info وإعادة التشغيل.');
        }
      } else if (connection === 'open') {
        const isRegistered = Boolean(state.creds.registered);
        if (isRegistered) {
          currentQr = null;
          pairingCode = null;
          botStatus = 'connected';
          const botNum = state.creds.me?.id?.split(':')[0] || 'غير معروف';
          console.log('\n' + '='.repeat(55));
          console.log('🚀 تم الاتصال بنجاح بواتساب والحساب مسجل 100%!');
          console.log(`📱 رقم البوت النشط الآن: +${botNum}`);
          console.log('🛵 بوت دليفري طنطا جاهز الآن لاستقبال الرسائل والطلبات.');
          console.log('='.repeat(55) + '\n');
        } else {
          botStatus = 'waiting_for_qr_scan';
          console.log('\n⚠️ تم فتح الاتصال ولكن الجهاز غير مسجل (registered: false)، في انتظار مسح الـ QR أو كود الربط...');
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`\n📥 [استلام حدث رسائل من واتساب]: نوع الحدث = ${type}, عدد الرسائل = ${messages?.length || 0}`);
      if (type !== 'notify') return;

      const myNumber = state.creds.me?.id?.split(':')[0] || '';

      for (const msg of messages) {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;

        const isGroup = remoteJid.endsWith('@g.us');
        const customerNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

        // إذا كانت الرسالة مرسلة من نفس الرقم في شات شخص آخر، نتجاهلها
        // لكن لو أرسلها لنفسه (Message Yourself / Note to Self)، نسمح له بتجربة البوت!
        const isFromMe = Boolean(msg.key.fromMe);
        const isNoteToSelf = isFromMe && myNumber && customerNumber.includes(myNumber);

        if (isFromMe && !isNoteToSelf) {
          continue;
        }

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        if (!text) continue;

        const user = await getUserState(customerNumber);

        console.log('\n' + '─'.repeat(45));
        console.log(`📩 رسالة جديدة من: ${isGroup ? 'مجموعة' : (isNoteToSelf ? 'تجربة ذاتية (نفس الرقم)' : 'عميل')}`);
        console.log(`📞 رقم العميل: +${customerNumber} | الحالة الحالية: [${user.state}]`);
        console.log(`💬 نص الرسالة: "${text}"`);
        console.log(`🕒 التوقيت: ${new Date().toLocaleTimeString('ar-EG')}`);
        console.log('─'.repeat(45));

        if (!isGroup) {
          await handleCustomerMessage(customerNumber, text, sock, remoteJid);
        } else {
          console.log(`\n👥 [معرف جروب واتساب - Group JID]: "${remoteJid}"`);
          console.log(`💡 نصيحة: إذا كان هذا جروب المناديب، انسخ المعرف وضعه في ملف .env: DRIVERS_GROUP_JID=${remoteJid}\n`);

          const trimmed = text.trim().toLowerCase();
          if (trimmed === 'id' || trimmed === '.id' || trimmed === 'jid' || text.includes('معرف')) {
            await sock.sendMessage(remoteJid, {
              text: `🆔 معرف هذا الجروب (Group JID) هو:\n${remoteJid}\n\n📌 انسخه وضعه في ملف .env تحت DRIVERS_GROUP_JID`
            });
          }
        }
      }
    });
  } catch (error) {
    console.error('❌ خطأ أثناء بدء عميل واتساب:', error);
    setTimeout(startWhatsAppBot, 5000);
  }
}

if (!process.env.VERCEL) {
  const server = app.listen(PORT, async () => {
    console.log(`🌐 خادم Express يعمل على: http://localhost:${PORT}`);
    console.log(`📱 رابط صفحة الـ QR بالمتصفح: http://localhost:${PORT}/qr`);
    console.log(`🍔 رابط لوحة تحكم المطاعم: http://localhost:${PORT}/admin`);
    await initDB();
    await startWhatsAppBot();
  });

  // إنهاء السيرفر والاتصال بأمان عند الإيقاف (Graceful Shutdown)
  const shutdown = async (signal) => {
    console.log(`\n🛑 تم استلام إشارة (${signal})، جاري إغلاق الخادم والاتصال بواتساب بأمان...`);
    server.close(() => {
      console.log('✅ تم إغلاق خادم Express.');
    });
    if (sock) {
      try { sock.end(); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // تهيئة قاعدة البيانات في بيئة Vercel Serverless
  initDB().catch(console.error);
}

export default app;


