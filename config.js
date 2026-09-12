require('dotenv').config();

const ADMIN_PHONE = process.env.ADMIN_PHONE || '01143264206';
const DB_PATH = process.env.DB_PATH || './delivery_bot.db';
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
  ADMIN_PHONE,
  DB_PATH,
  PORT,
  STATUS_LABELS,
  CUSTOMER_STATUS_NOTIFICATIONS,
};
