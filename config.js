require('dotenv').config();
const path = require('path');
const fs = require('fs');

function getWritableDataDir() {
  if (process.env.DATA_PATH) {
    try {
      fs.mkdirSync(process.env.DATA_PATH, { recursive: true });
      fs.accessSync(process.env.DATA_PATH, fs.constants.W_OK);
      return process.env.DATA_PATH;
    } catch (e) {}
  }
  if (fs.existsSync('/data')) {
    try {
      fs.accessSync('/data', fs.constants.W_OK);
      return '/data';
    } catch (e) {}
  }
  const localDir = path.join(__dirname, 'data');
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch (e) {}
  return localDir;
}

// المسار الدائم للبيانات وجلسة الواتساب (Railway Volume Support)
const DATA_DIR = getWritableDataDir();

const ADMIN_PHONE = process.env.ADMIN_PHONE || '01143264206';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'delivery_bot.db');
const PORT = process.env.PORT || 3000;

// تسميات حالات الطلب
const STATUS_LABELS = {
  new:        '⏳ قيد الانتظار',
  pending:    '⏳ قيد الانتظار',
  accepted:   '🛵 مقبول وجاري التجهيز',
  delivering: '🚀 جاري التوصيل مع المندوب',
  completed:  '✅ تم التسليم بنجاح',
  cancelled:  '❌ ملغي / اعتذار',
};

// رسائل الإشعار الفورية للعميل عند تحديث حالة طلبه
const CUSTOMER_STATUS_NOTIFICATIONS = {
  accepted:   (id) => `🛵 *تحديث بخصوص طلبك #${id}:*\nتم قبول طلبك وجاري تجهيزه حالياً من قبل المندوب! 💨`,
  delivering: (id) => `🚀 *تحديث بخصوص طلبك #${id}:*\nالمندوب استلم طلبك وهو في الطريق إليك الآن! 🛵💨`,
  completed:  (id) => `🎉 *تم تسليم طلبك #${id} بنجاح!*\nشكراً لتعاملك معنا في دليفري طنطا، نسعد بخدمتك دائماً! 🙏❤️`,
  cancelled:  (id) => `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب حالياً. للتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`,
};

module.exports = {
  DATA_DIR,
  ADMIN_PHONE,
  ADMIN_PIN,
  DB_PATH,
  PORT,
  STATUS_LABELS,
  CUSTOMER_STATUS_NOTIFICATIONS,
};
