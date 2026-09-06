import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import {
  initDB,
  getUserState,
  getAllRestaurants,
  getRestaurantById,
  addRestaurant,
  updateRestaurant,
  toggleRestaurantActive,
  deleteRestaurant,
  getAllOrders
} from './db.js';
import { sendWhatsAppMessage } from './whatsappService.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || 'auth_info';
const BOT_PHONE_NUMBER = '201143264206'; // رقم البوت النهائي الهاردكودد

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
let currentAuthState = null;

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

/**
 * ----------------------------------------------------
 * نقاط اتصال WhatsApp Cloud API الرسمية من Meta
 * ----------------------------------------------------
 */

// 1. التحقق من Webhook من قبل سيرفرات Meta (GET /webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.META_VERIFY_TOKEN;

  console.log('🔍 استلام طلب تحقق Webhook من Meta...');

  if (mode && token) {
    if (mode === 'subscribe' && token === expectedToken) {
      console.log('✅ تم التحقق من الـ Webhook بنجاح! تم مطابقة Verify Token.');
      return res.status(200).send(challenge);
    } else {
      console.warn('⚠️ فشل التحقق: Verify Token غير متطابق!');
      return res.sendStatus(403);
    }
  }

  return res.status(400).send('طلب غير صالح');
});

// 2. استقبال إشعارات ورسائل الواتساب الواردة (POST /webhook)
app.post('/webhook', async (req, res) => {
  // الرد بـ 200 OK فوراً لمنع فيسبوك من تكرار المحاولة
  res.sendStatus(200);

  const body = req.body;

  if (body?.object === 'whatsapp_business_account') {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // أ. معالجة الرسائل الواردة من المستخدمين
      if (value?.messages && value.messages.length > 0) {
        const message = value.messages[0];
        const senderPhone = message.from; // رقم هاتف العميل (مثال: 201012345678)
        const senderName = value.contacts?.[0]?.profile?.name || 'غير معروف';
        const messageType = message.type;
        const messageId = message.id;

        const messageText = messageType === 'text'
          ? message.text.body
          : `[رسالة من نوع: ${messageType}]`;

        console.log('\n=========================================');
        console.log(`📩 رسالة واردة جديدة عبر Meta Cloud API!`);
        console.log(`👤 المرسل: ${senderName} (+${senderPhone})`);
        console.log(`💬 المحتوى: "${messageText}"`);
        console.log(`🆔 معرف الرسالة: ${messageId}`);
        console.log(`🕒 الوقت: ${new Date(parseInt(message.timestamp) * 1000).toLocaleTimeString('ar-EG')}`);
        console.log('=========================================\n');
      }

      // ب. تتبع حالات تسليم الرسائل
      if (value?.statuses && value.statuses.length > 0) {
        const status = value.statuses[0];
        // console.log(`ℹ️ تحديث حالة الرسالة (${status.id}): ${status.status}`);
      }
    } catch (err) {
      console.error('❌ خطأ أثناء معالجة بيانات الـ Webhook:', err.message);
    }
  }
});

// 3. مسار تجريبي لاختبار إرسال الرسائل عبر الـ API
app.post('/api/send-test', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'يرجى إرسال to (رقم الهاتف) و message (نص الرسالة)' });
  }

  try {
    const result = await sendWhatsAppMessage(to, message);
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
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

// نقطة استخراج صورة رمز QR كـ PNG مع رأس no-cache
app.get('/qr/image', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (!currentQr) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
        <rect width="300" height="300" fill="#f8fafc" rx="16" stroke="#cbd5e1" stroke-width="2"/>
        <text x="50%" y="125" text-anchor="middle" fill="#075e54" font-family="sans-serif" font-size="32">⏳</text>
        <text x="50%" y="175" text-anchor="middle" fill="#0f172a" font-family="system-ui, sans-serif" font-size="16" font-weight="bold">جاري إنشاء رمز QR...</text>
        <text x="50%" y="205" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">يرجى الانتظار ثوانٍ معدودة</text>
      </svg>
    `);
  }

  try {
    const buffer = await QRCode.toBuffer(currentQr, {
      width: 320,
      margin: 2,
      color: {
        dark: '#075e54',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('خطأ أثناء توليد صورة الـ QR');
  }
});

// فحص حالة الاتصال وتوفر الـ QR والكود لحظياً
app.get('/api/bot-status', (req, res) => {
  const registered = Boolean(currentAuthState?.state?.creds?.registered);
  const botNum = (currentAuthState?.state?.creds?.me?.id || '').split(':')[0].replace(/[^0-9]/g, '') || null;

  res.json({
    status: botStatus,
    registered,
    botNumber: botNum,
    hasQr: Boolean(currentQr),
    pairingCode: pairingCode || null,
    timestamp: Date.now()
  });
});

// توليد كود ربط فوري لهاتف العميل عند الطلب
app.post('/api/request-pairing-code', async (req, res) => {
  try {
    if (!sock) {
      return res.status(503).json({ success: false, message: 'سيرفر البوت قيد التهيئة، يرجى المحاولة بعد ثوانٍ.' });
    }
    if (botStatus === 'connected') {
      return res.json({ success: false, message: 'البوت متصل بالفعل بواتساب!' });
    }

    let phone = (req.body?.phone || req.query?.phone || BOT_PHONE_NUMBER || '').toString().trim().replace(/[^0-9]/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, message: 'يرجى كتابة رقم الهاتف أولاً (مثال: 01143264206 أو 201023678882)' });
    }

    if (phone.startsWith('01') && phone.length === 11) {
      phone = '2' + phone;
    }

    console.log(`📲 طلب كود ربط فوري لرقم الهاتف: +${phone}`);
    const code = await sock.requestPairingCode(phone);
    pairingCode = code;
    console.log(`🔑 تم توليد كود الربط بنجاح: ${code}`);

    return res.json({ success: true, code, phone });
  } catch (err) {
    console.error('⚠️ تعذر توليد كود الربط:', err?.message || err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'تعذر استخراج الكود حالياً. يفضل مسح رمز QR بالكاميرا فهو فوري ومضمون 100%.'
    });
  }
});

// صفحة ويب مخصصة للربط المزدوج (مسح QR بالكاميرا أو كود التحقق برقم الهاتف)
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
            2️⃣ <b>عملية البوت:</b> تعمل إما على جهازك المحلي، أو على سيرفر دائم.
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

  const defaultPhone = (BOT_PHONE_NUMBER || '').replace(/[^0-9]/g, '');

  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ربط بوت دليفري طنطا بواتساب</title>
      <style>
        :root {
          --wa-dark: #075e54;
          --wa-green: #25d366;
          --wa-light: #128c7e;
          --bg-gray: #f0f2f5;
          --text-main: #1f2937;
          --text-muted: #6b7280;
        }
        * { box-sizing: border-box; }
        body {
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          background: var(--bg-gray);
          color: var(--text-main);
          margin: 0;
          padding: 24px 16px;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .container {
          background: white;
          max-width: 880px;
          width: 100%;
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.08);
          padding: 32px;
        }
        .header {
          text-align: center;
          margin-bottom: 28px;
        }
        .header h1 {
          color: var(--wa-dark);
          margin: 0 0 8px 0;
          font-size: 26px;
        }
        .header p {
          color: var(--text-muted);
          margin: 0 0 14px 0;
          font-size: 15px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 600;
          background: #fef3c7;
          color: #92400e;
        }
        .badge-ready { background: #dcfce7; color: #166534; }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-top: 10px;
        }
        @media (max-width: 768px) {
          .grid { grid-template-columns: 1fr; }
          .container { padding: 20px; }
        }
        .card-method {
          background: #f8fafc;
          border: 2px solid #e2e8f0;
          border-radius: 16px;
          padding: 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }
        .card-recommended {
          border-color: #22c55e;
          background: #f0fdf4;
        }
        .ribbon {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          background: #16a34a;
          color: white;
          font-size: 12px;
          font-weight: bold;
          padding: 3px 14px;
          border-radius: 12px;
          box-shadow: 0 2px 6px rgba(22, 163, 74, 0.3);
        }
        .method-title {
          font-size: 19px;
          font-weight: 700;
          color: var(--wa-dark);
          margin: 8px 0 6px 0;
        }
        .method-desc {
          font-size: 13px;
          color: var(--text-muted);
          margin-bottom: 16px;
          line-height: 1.5;
        }
        .qr-wrapper {
          background: white;
          border-radius: 12px;
          padding: 10px;
          display: inline-block;
          border: 1px solid #cbd5e1;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          margin-bottom: 12px;
        }
        .qr-img {
          width: 250px;
          height: 250px;
          display: block;
          border-radius: 8px;
        }
        .steps {
          text-align: right;
          background: white;
          border-radius: 10px;
          padding: 14px 16px;
          margin-top: 14px;
          font-size: 13px;
          color: #334155;
          border: 1px solid #e2e8f0;
          line-height: 1.7;
        }
        .steps ol {
          margin: 6px 0 0 0;
          padding-right: 20px;
        }
        .code-input-group {
          margin: 16px 0;
          text-align: right;
        }
        .code-input-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 6px;
        }
        .input-row {
          display: flex;
          gap: 8px;
        }
        .input-phone {
          flex: 1;
          padding: 10px 14px;
          border: 2px solid #cbd5e1;
          border-radius: 8px;
          font-size: 15px;
          font-family: inherit;
          direction: ltr;
          text-align: right;
        }
        .input-phone:focus {
          border-color: var(--wa-light);
          outline: none;
        }
        .btn-action {
          background: var(--wa-dark);
          color: white;
          border: none;
          padding: 10px 18px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s;
          white-space: nowrap;
        }
        .btn-action:hover { background: #054c44; }
        .btn-action:disabled { background: #9ca3af; cursor: not-allowed; }
        .code-box {
          background: white;
          border: 2px dashed #075e54;
          border-radius: 12px;
          padding: 18px;
          margin: 16px 0;
          text-align: center;
        }
        .code-text {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 32px;
          font-weight: 800;
          color: #075e54;
          letter-spacing: 5px;
          user-select: all;
        }
        .countdown {
          font-size: 13px;
          color: #b45309;
          margin-top: 8px;
          font-weight: 600;
        }
        .btn-copy {
          background: #e0f2fe;
          color: #0369a1;
          border: 1px solid #bae6fd;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 10px;
        }
        .btn-copy:hover { background: #bae6fd; }
        .success-box {
          text-align: center;
          padding: 50px 20px;
        }
        .btn-success {
          display: inline-block;
          background: #16a34a;
          color: white;
          text-decoration: none;
          padding: 14px 28px;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 700;
          margin-top: 20px;
        }
        .btn-success:hover { background: #15803d; }
      </style>
    </head>
    <body>
      <div class="container" id="mainContainer">
        <div class="header">
          <h1>🛵 ربط بوت واتساب - دليفري طنطا</h1>
          <p>اختر الطريقة الأنسب لربط رقم هاتفك مع البوت لبدء استقبال الطلبات فوراً</p>
          <div id="statusBadge" class="badge">🟡 جاري تجهيز الرمز والاتصال...</div>
        </div>

        <div class="grid">
          <!-- الخيار الأول: مسح الـ QR (موصى به) -->
          <div class="card-method card-recommended">
            <span class="ribbon">⭐ الطريقة الأسرع والأضمن 100%</span>
            <div>
              <div class="method-title">📷 مسح رمز الـ QR بالكاميرا</div>
              <div class="method-desc">بدون كتابة أكواد وبدون "تعذر الربط". وجّه الكاميرا فقط ويتم الربط في ثانية واحدة!</div>

              <div class="qr-wrapper">
                <img id="qrImg" class="qr-img" src="/qr/image" alt="WhatsApp QR Code" />
              </div>

              <div style="font-size: 12px; color: #15803d; font-weight: 500;">
                🔄 يتجدد الرمز تلقائياً في الخلفية بدون إعادة تحميل الصفحة
              </div>
            </div>

            <div class="steps">
              <strong>خطوات الربط من الموبايل:</strong>
              <ol>
                <li>افتح تطبيق <b>واتساب</b> على هاتفك.</li>
                <li>اضغط على (الثلاث نقاط) ➔ <b>الأجهزة المرتبطة</b> (Linked Devices).</li>
                <li>اضغط <b>ربط جهاز</b> ووجّه كاميرا الهاتف نحو المربع أعلاه.</li>
              </ol>
            </div>
          </div>

          <!-- الخيار الثاني: كود الربط برقم الهاتف -->
          <div class="card-method">
            <div>
              <div class="method-title">🔢 أو الربط بكود التحقق ورقم الهاتف</div>
              <div class="method-desc">إذا كانت كاميرا هاتفك لا تعمل، اكتب رقم هاتفك واطلب كود ربط فوري</div>

              <div class="code-input-group">
                <label for="pairingPhone">رقم هاتف الواتساب:</label>
                <div class="input-row">
                  <input type="tel" id="pairingPhone" class="input-phone" value="${defaultPhone}" placeholder="مثال: 01143264206" />
                  <button id="btnRequestCode" onclick="fetchNewPairingCode()" class="btn-action">طلب كود 🔄</button>
                </div>
              </div>

              <div id="codeDisplayArea" style="${pairingCode ? 'display:block' : 'display:none'}">
                <div class="code-box">
                  <div class="code-text" id="codeText">${pairingCode || '--------'}</div>
                  <button id="btnCopy" onclick="copyPairingCode()" class="btn-copy">📋 نسخ الكود</button>
                  <div class="countdown" id="countdownArea">⏳ الكود صالح لمدة: <span id="timerSeconds">60</span> ثانية</div>
                </div>
              </div>
            </div>

            <div class="steps">
              <strong>طريقة التفعيل بالكود:</strong>
              <ol>
                <li>في واتساب ➔ <b>الأجهزة المرتبطة</b> ➔ اضغط <b>ربط جهاز</b>.</li>
                <li>اختر بالأسفل: <b>"الربط باستخدام رقم الهاتف بدلاً من ذلك"</b>.</li>
                <li>اكتب الكود الظاهر هنا فوراً قبل انتهاء العداد.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <script>
        let isConnected = false;
        let countdownTimer = null;

        // فحص دوري لحالة البوت
        async function pollStatus() {
          if (isConnected) return;
          try {
            const res = await fetch('/api/bot-status');
            const data = await res.json();

            if (data.status === 'connected') {
              isConnected = true;
              showConnectedScreen(data.botNumber);
              return;
            }

            const badge = document.getElementById('statusBadge');
            if (data.hasQr) {
              badge.className = 'badge badge-ready';
              badge.innerText = '🟢 جاهز للمسح أو طلب الكود';
            }

            if (data.pairingCode && !countdownTimer) {
              showCode(data.pairingCode);
            }
          } catch (e) {}
        }

        // تحديث صورة الـ QR بشكل دوري وسلس
        setInterval(() => {
          if (!isConnected) {
            const img = document.getElementById('qrImg');
            if (img) img.src = '/qr/image?t=' + Date.now();
          }
        }, 15000);

        setInterval(pollStatus, 2500);
        pollStatus();

        // طلب كود جديد
        async function fetchNewPairingCode() {
          const phoneInput = document.getElementById('pairingPhone');
          const btn = document.getElementById('btnRequestCode');
          const phone = phoneInput.value.trim();

          if (!phone) {
            alert('يرجى كتابة رقم الهاتف أولاً');
            phoneInput.focus();
            return;
          }

          btn.disabled = true;
          btn.innerText = '⏳ جاري الطلب...';

          try {
            const res = await fetch('/api/request-pairing-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const data = await res.json();

            if (data.success && data.code) {
              showCode(data.code);
              startTimer(60);
            } else {
              alert('⚠️ ' + (data.message || 'تعذر استخراج الكود، جرب مسح رمز QR فهو أضمن وأسرع!'));
            }
          } catch (err) {
            alert('حدث خطأ أثناء الاتصال بالسيرفر. يفضل مسح الـ QR بالكاميرا');
          } finally {
            btn.disabled = false;
            btn.innerText = 'طلب كود 🔄';
          }
        }

        function showCode(code) {
          document.getElementById('codeDisplayArea').style.display = 'block';
          document.getElementById('codeText').innerText = code;
        }

        function startTimer(seconds) {
          if (countdownTimer) clearInterval(countdownTimer);
          let remaining = seconds;
          const timerEl = document.getElementById('timerSeconds');
          timerEl.innerText = remaining;

          countdownTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
              clearInterval(countdownTimer);
              countdownTimer = null;
              timerEl.innerText = '0 (انتهت الصلاحية، اطلب كوداً جديداً)';
            } else {
              timerEl.innerText = remaining;
            }
          }, 1000);
        }

        function copyPairingCode() {
          const code = document.getElementById('codeText').innerText.trim();
          if (!code || code === '--------') return;
          navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('btnCopy');
            btn.innerText = '✅ تم النسخ!';
            setTimeout(() => { btn.innerText = '📋 نسخ الكود'; }, 2000);
          });
        }

        function showConnectedScreen(botNumber) {
          if (countdownTimer) clearInterval(countdownTimer);
          document.getElementById('mainContainer').innerHTML = \`
            <div class="success-box">
              <div style="font-size: 70px; margin-bottom: 16px;">🎉</div>
              <h2 style="color: #15803d; font-size: 28px; margin: 0 0 14px 0;">تم ربط البوت بواتساب بنجاح!</h2>
              <p style="font-size: 18px; color: #374151; margin-bottom: 8px;">رقم البوت المتصل الآن: <b dir="ltr" style="color: #075e54; font-size: 20px;">+\${botNumber || 'نشط'}</b></p>
              <p style="color: #6b7280; font-size: 15px; max-width: 500px; margin: 0 auto; line-height: 1.6;">
                جلسة واتساب نشطة وتعمل 24 ساعة. البوت جاهز الآن للرد التلقائي واستقبال طلبات الدليفري وتوجيهها للمناديب.
              </p>
              <div style="margin-top: 28px;">
                <a href="/admin" class="btn-success">🍔 فتح لوحة تحكم المطاعم والطلبات</a>
              </div>
            </div>
          \`;
        }
      </script>
    </body>
    </html>
  `);
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
    const recentOrders = await getAllOrders(20);

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

    let ordersHtml = '';
    if (recentOrders.length === 0) {
      ordersHtml = `
        <div class="empty-state">
          <h3>لا توجد طلبات مسجلة حتى الآن</h3>
          <p>عند قيام أي عميل بطلب أوردر عبر واتساب، ستظهر تفاصيله ورقم هاتفه الحقيقي هنا فوراً.</p>
        </div>
      `;
    } else {
      ordersHtml = `
        <div style="background: white; border-radius: 12px; overflow-x: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 30px;">
          <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 14px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569;">
                <th style="padding: 12px 16px;">#</th>
                <th style="padding: 12px 16px;">📱 رقم العميل</th>
                <th style="padding: 12px 16px;">🍔 القسم</th>
                <th style="padding: 12px 16px;">📝 تفاصيل الأوردر</th>
                <th style="padding: 12px 16px;">📍 العنوان</th>
                <th style="padding: 12px 16px;">🕒 الوقت</th>
                <th style="padding: 12px 16px;">⚡ الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${recentOrders.map(o => {
                const rawPhone = String(o.phone || '').replace(/@lid/g, '').replace(/@s\.whatsapp\.net/g, '').replace(/[^0-9]/g, '');
                const displayPhone = rawPhone.startsWith('20') && rawPhone.length === 12 ? '0' + rawPhone.slice(2) : (rawPhone || 'غير محدد');
                const intlPhone = rawPhone.startsWith('20') ? rawPhone : (rawPhone.startsWith('01') ? '20' + rawPhone.slice(1) : rawPhone);
                const timeStr = o.created_at ? new Date(o.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : 'الآن';
                return `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px 16px; font-weight: bold; color: #075e54;">#${o.id}</td>
                    <td style="padding: 12px 16px;">
                      <div style="font-weight: bold; color: #1e293b; font-size: 15px;">${displayPhone}</div>
                      ${intlPhone ? `
                        <div style="display: flex; gap: 6px; margin-top: 4px;">
                          <a href="https://wa.me/${intlPhone}" target="_blank" style="display: inline-block; background: #25d366; color: white; text-decoration: none; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">واتساب</a>
                          <a href="tel:+${intlPhone}" style="display: inline-block; background: #0284c7; color: white; text-decoration: none; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">اتصال</a>
                        </div>
                      ` : ''}
                    </td>
                    <td style="padding: 12px 16px;"><span style="background: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${o.category || 'عام'}</span></td>
                    <td style="padding: 12px 16px; max-width: 320px; line-height: 1.5; color: #334155;">${o.details || '-'}</td>
                    <td style="padding: 12px 16px; color: #64748b;">${o.delivery_location || 'طنطا'}</td>
                    <td style="padding: 12px 16px; color: #64748b; font-size: 12px;">${timeStr}</td>
                    <td style="padding: 12px 16px;"><span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">${o.status || 'PENDING'}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
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

          <!-- قائمة أحدث طلبات الدليفري -->
          <div class="section-title">
            <span>🛵 أحدث طلبات الدليفري المستلمة (${recentOrders.length})</span>
            <span style="font-size: 14px; color: var(--text-muted); font-weight: normal;">أرقام الهواتف تظهر صحيحة ومباشرة مع روابط اتصال ومحادثة فورية</span>
          </div>

          ${ordersHtml}

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

/**
 * استخراج وتحويل رقم هاتف العميل الحقيقي من رسالة واتساب ومعالجة معرفات LID
 */
async function resolveCustomerPhoneNumber(msg, sockInstance, sessionDir = 'auth_info') {
  const remoteJid = msg.key?.remoteJid || '';

  // 1. إذا كان المعرف نفسه هو رقم هاتف عادي (@s.whatsapp.net أو @c.us)
  if (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@c.us')) {
    const raw = remoteJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (raw) return raw;
  }

  // 2. فحص المعرف البديل (remoteJidAlt / participantAlt) الذي يرسله Baileys
  const alt = msg.key?.remoteJidAlt || msg.key?.participantAlt;
  if (alt && (alt.endsWith('@s.whatsapp.net') || alt.endsWith('@c.us'))) {
    const raw = alt.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (raw) return raw;
  }

  // 3. فحص مخزن Baileys الداخلي Signal LID Mapping
  if (remoteJid.endsWith('@lid') && sockInstance?.signalRepository?.lidMapping?.getPNForLID) {
    try {
      const pnJid = await sockInstance.signalRepository.lidMapping.getPNForLID(remoteJid);
      if (pnJid) {
        const raw = pnJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        if (raw) return raw;
      }
    } catch {}
  }

  // 4. فحص ملفات المطابقة العكسية المحفوظة في auth_info و auth_info_old_stale
  if (remoteJid.includes('@lid')) {
    const lidUser = remoteJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    try {
      const fs = await import('fs');
      const path = await import('path');
      const dirs = [sessionDir, 'auth_info_old_stale'];
      for (const d of dirs) {
        if (!d) continue;
        const mappingFile = path.join(d, `lid-mapping-${lidUser}_reverse.json`);
        if (fs.existsSync(mappingFile)) {
          const content = fs.readFileSync(mappingFile, 'utf8');
          const parsed = JSON.parse(content);
          const raw = String(parsed).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
          if (raw) return raw;
        }
      }
    } catch {}
  }

  // 5. فحص إذا كان العميل كتب رقم مصري صريح داخل نص الرسالة
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    '';
  const egPhoneMatch = text.match(/(?:(?:\+|00)?20|0)?(1[0125]\d{8})\b/);
  if (egPhoneMatch) {
    return '20' + egPhoneMatch[1];
  }

  // الاحتياط الأخير: تنظيف المعرف بدون @lid
  return remoteJid.replace(/@lid/g, '').replace(/@s\.whatsapp\.net/g, '').replace(/@g\.us/g, '').split(':')[0].replace(/[^0-9]/g, '');
}

// تشغيل وإدارة عميل Baileys
async function startWhatsAppBot() {
  if (process.env.VERCEL) return;
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      fetchLatestWaWebVersion,
      Browsers
    } = await import('@whiskeysockets/baileys');
    const { default: pino } = await import('pino');
    const { default: qrcodeTerminal } = await import('qrcode-terminal');
    const { handleCustomerMessage } = await import('./botHandler.js');

    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch {}
      sock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    currentAuthState = { state, saveCreds };

    let version = [2, 3000, 1046925803];
    try {
      const waVersion = await fetchLatestWaWebVersion({});
      if (waVersion?.version) {
        version = waVersion.version;
      }
    } catch {
      try {
        const bVersion = await fetchLatestBaileysVersion();
        if (bVersion?.version) version = bVersion.version;
      } catch {}
    }

    console.log(`📡 إصدار WhatsApp Web المعتمد والحي: v${version.join('.')}`);

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        botStatus = 'waiting_for_qr_scan';
        console.log('\n' + '='.repeat(55));
        console.log('📱 رمز QR جاهز للمسح بالكاميرا أو عبر المتصفح:');
        console.log(`👉 افتح في المتصفح: http://localhost:${PORT}/qr`);
        console.log('='.repeat(55) + '\n');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch {}
        console.log('\n' + '-'.repeat(55));
        console.log('⏳ في انتظار مسح الـ QR بالكاميرا من تطبيق واتساب...');
      }

      if (connection === 'close') {
        currentQr = null;
        pairingCode = null;
        botStatus = 'disconnected';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`⚠️ انقطع الاتصال بواتساب (رمز الحالة: ${statusCode || 'غير معروف'}).`);

        if (isLoggedOut) {
          console.log('🔄 تم رفض الجلسة أو تسجيل الخروج (401)، جاري تنظيف الجلسة والبدء فوراً بجلسة نقية...');
          try {
            if (fs.existsSync(SESSION_DIR)) {
              fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('خطأ أثناء مسح الجلسة:', e.message);
          }
          setTimeout(startWhatsAppBot, 2000);
        } else {
          console.log('🔄 جاري محاولة إعادة الاتصال خلال ثانيتين...');
          setTimeout(startWhatsAppBot, 2000);
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
        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid) continue;

        // تجاهل حالات واتساب والبث والرسائل الإخبارية
        if (
          remoteJid === 'status@broadcast' ||
          remoteJid.endsWith('@broadcast') ||
          remoteJid.endsWith('@newsletter')
        ) {
          continue;
        }

        const isGroup = remoteJid.endsWith('@g.us');

        // استخراج رقم هاتف العميل الحقيقي المعتمد وحل مشكلة @lid
        const customerNumber = await resolveCustomerPhoneNumber(msg, sock, SESSION_DIR);

        // إذا كانت الرسالة مرسلة من نفس الرقم في شات شخص آخر، نتجاهلها
        // لكن لو أرسلها لنفسه (Message Yourself / Note to Self)، نسمح له بتجربة البوت!
        const isFromMe = Boolean(msg.key?.fromMe);
        const isNoteToSelf = isFromMe && myNumber && (customerNumber.includes(myNumber) || remoteJid.includes(myNumber));

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
        console.log(`📞 رقم العميل الحقيقي: +${customerNumber} (المعرف: ${remoteJid}) | الحالة الحالية: [${user.state}]`);
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
    await initDB();
    if (process.env.ENABLE_BAILEYS !== 'false') {
      await startWhatsAppBot();
    } else {
      console.log('🚀 تشغيل البوت عبر Meta WhatsApp Cloud API (Baileys معطل).');
    }
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

export { app, sendWhatsAppMessage };
export default app;


