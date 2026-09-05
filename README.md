# 🛵 بوت واتساب لخدمة دليفري طنطا (Tanta WhatsApp Delivery Bot)

مشروع سريع وخفيف (Vibe Coding) لإدارة طلبات وتوصيل الدليفري في طنطا عبر واتساب مباشرة باستخدام Node.js و Baileys و SQLite.

---

## 🛠️ التقنيات المستخدمة
- **Node.js (ES Modules)**
- **[@supabase/supabase-js](https://supabase.com)**: قاعدة بيانات سحابية متقدمة (PostgreSQL) لإدارة المستخدمين، الطلبات، والمطاعم مع مزامنة فورية وأمان RLS.
- **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)**: محرك واتساب بدون وسيط وبدون قيود الـ Cloud API.
- **[@google/genai](https://www.npmjs.com/package/@google/genai)**: الحزمة الرسمية الأحدث لـ Google Gemini API لفهم العامية المصرية واستخراج بيانات الطلبات بهيكلية JSON.
- **Express**: خادم ويب لمتابعة حالة البوت وتوفير لوحة تحكم المطاعم وWebhooks.
- **SQLite3**: قاعدة بيانات محلية كنسخة احتياطية سريعة.
- **qrcode-terminal**: لعرض رمز الاستجابة السريعة (QR Code) مباشرة في التيرمينال لربط الحساب.
- **dotenv**: لإدارة المتغيرات البيئية بأمان.

---

## 📁 هيكل المشروع

```
new-whatsapp-project/
├── index.js          # الملف الرئيسي: تشغيل Express وعميل Baileys ومعالج الرسائل المربوط بالحالات
├── db.js             # إعداد SQLite، إدارة الحالات (State Machine)، وحفظ الطلبات
├── test.js           # فحص ذاتي شامل للـ State Machine وقاعدة البيانات والجلسات
├── .env              # الإعدادات المحلية (البورت، مجلد الجلسة، ملف الداتابيز)
├── .env.example      # نموذج للمتغيرات البيئية
├── auth_info/        # مجلد يُنشأ تلقائياً لحفظ جلسة الواتساب (Session)
└── package.json      # تعريف الحزم وأوامر التشغيل
```

---

## 🔄 نظام إدارة الحالات (State Machine)
- `IDLE`: العميل في الحالة الافتراضية (لم يبدأ طلباً بعد).
- `AWAITING_MENU_SELECTION`: العميل بانتظار اختيار فئة الطلب (مطاعم، صيدليات، سوبرماركت...).
- `IN_ORDER_FLOW`: العميل يقوم بإدخال تفاصيل الأوردر والعناوين في طنطا.
- `CONFIRMING_ORDER`: مرحلة مراجعة وتأكيد الطلب النهائي.
- `HUMAN_SUPPORT`: تحويل العميل لخدمة الدعم البشري.

---

## 🗄️ جداول قاعدة البيانات (تُنشأ تلقائياً)
- **`users`**: `(phone, state, last_interaction, current_order_data)`
- **`orders`**: `(id, phone, category, details, pickup_location, delivery_location, status, created_at)`
- **`restaurants`**: `(id, name, area, menu_text, image_url, is_active, created_at)`

---

## 🍔 لوحة تحكم المطاعم والمينيوهات (Admin Dashboard)
يمكنك فتح المتصفح على:
👉 **`http://localhost:3000/admin`**

تتيح لك اللوحة:
1. **إضافة مطاعم جديدة**: كتابة اسم المطعم، المنطقة في طنطا، نص المينيو والأسعار، ورابط صورة المينيو (URL).
2. **تعديل المطاعم والمينيوهات**: تحديث الأسعار والأصناف فوراً.
3. **تفعيل / تعطيل بنقرة واحدة**: إخفاء أي مطعم مؤقتاً عند الإغلاق أو نفاذ الأصناف دون حذفه، ليختفي تلقائياً من قائمة الواتساب.
4. **حذف المطاعم نهائياً**.
5. **إرسال صور المينيو**: عند وضع رابط لصورة المينيو، يرسلها البوت تلقائياً للعميل على واتساب مع نص المينيو.

---

---

## 👥 كيفية الحصول على Group JID لجروب المناديب:
1. أضف رقم البوت إلى جروب الواتساب الخاص بالمناديب والأدمن.
2. أرسل أي رسالة تجريبية داخل الجروب (مثلاً: `test` أو `الو`).
3. سيقوم البوت فوراً بطباعة معرف الجروب في الـ Terminal:
   ```text
   👥 [معرف جروب واتساب - Group JID]: "120363xxxxxxxxxxxx@g.us"
   ```
4. انسخ هذا المعرف وضعه في ملف [`.env`](file:///home/engebrahimahmed/new-whatsapp-project/.env):
   ```env
   DRIVERS_GROUP_JID=120363xxxxxxxxxxxx@g.us
   ```

---

## 🚀 أوامر التشغيل

### 1. تشغيل البوت:
```bash
npm start
```
أو في وضع التطوير مع إعادة التشغيل التلقائي عند التعديل:
```bash
npm run dev
```

### 2. الفحص الذاتي (Test):
```bash
npm test
```

---

## 🚀 طرق الرفع والتشغيل على سيرفر الإنتاج (Deployment)

### 1. الرفع عبر Docker و Docker Compose (الطريقة الموصى بها):
تم تجهيز ملفات `Dockerfile` و `docker-compose.yml` جاهزة للتشغيل:
```bash
# 1. انسخ ملف البيئة وأضف مفاتيحك
cp .env.example .env
nano .env

# 2. بناء وتشغيل الحاوية في الخلفية مع حفظ الجلسة دائمًا
docker compose up -d --build

# 3. عرض السجلات لمسح QR Code إن لزم
docker compose logs -f
```

---

### 2. التشغيل على خادم VPS (Ubuntu / Debian) باستخدام PM2:
```bash
# 1. تثبيت PM2 عالمياً
npm install -g pm2

# 2. تشغيل التطبيق كخدمة دائمة في الخلفية
npm run pm2:start

# 3. متابعة السجلات
npm run pm2:logs

# 4. إعادة التشغيل أو الإيقاف
npm run pm2:restart
npm run pm2:stop
```

---

### 3. الرفع إلى GitHub / Git:
```bash
git add .
git commit -m "feat: complete tanta delivery bot with supabase and admin dashboard"
git branch -M main
git remote add origin <رابط_مستودعك_على_GitHub>
git push -u origin main
```
> [!IMPORTANT]
> تم ضبط ملف `.gitignore` بدقة لضمان عدم رفع ملفات الجلسة (`auth_info/`) أو المفاتيح السرية (`.env`) أو قواعد البيانات المحلية إلى المستودع.

---

## 📱 طريقة الربط لأول مرة (Scan QR)
1. شغل الأمر `npm start` أو شغل حاوية Docker.
2. افتح في المتصفح: **`http://localhost:3000/qr`**
3. افتح تطبيق **WhatsApp** على هاتفك (برقمك المصري).
4. اضغط على القائمة (الثلاث نقاط) ➔ **الأجهزة المرتبطة (Linked Devices)**.
5. اضغط على **ربط جهاز (Link a Device)** وامسح الرمز المعروض بالمتصفح.
6. بمجرد الربط، ستُحفظ الجلسة في مجلد `auth_info/` ولن تحتاج للمسح مجدداً عند إعادة التشغيل.

