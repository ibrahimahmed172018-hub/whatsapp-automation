// ==========================================
// config.js — كل الإعدادات والثوابت هنا
// لو عايز تغيير في إعداد، هتجي لهنا مباشرة
// ==========================================

const BOT_TOKEN             = process.env.BOT_TOKEN || '8682760460:AAFyWu23L9CMLHHn656wA74b32kyVQX-rx4';
const ADMIN_PASS            = process.env.ADMIN_PASS || 'admin123';
const DB_PATH               = process.env.DB_PATH   || './delivery_bot.db';
const PORT                  = process.env.PORT      || 3000;

// Chat ID للأدمن الأساسي والمندوب (رقم 01143264206)
const PRIMARY_ADMIN_CHAT_ID = 5766938827;

// تسميات حالات الطلب
const STATUS_LABELS = {
  pending:    '⏳ قيد الانتظار',
  accepted:   '🛵 مقبول وجاري التجهيز',
  delivering: '🚀 جاري التوصيل مع المندوب',
  completed:  '✅ تم التسليم بنجاح',
  cancelled:  '❌ ملغي / اعتذار',
};

// تسميات أنواع مدخلات الأقسام
const INPUT_TYPE_LABELS = {
  text:          '📝 نص فقط (تفاصيل وعنوان)',
  photo_or_text: '📸 صورة أو نص (روشتة / قائمة)',
  items:         '🏪 قسم محلات ومنيو (عناصر فرعية)',
};

// رسائل الإشعار الفورية للعميل عند تحديث حالة طلبه
const CUSTOMER_STATUS_NOTIFICATIONS = {
  accepted:   (id) => `🛵 *تحديث بخصوص طلبك #${id}:*\nتم قبول طلبك وجاري تجهيزه حالياً من قبل المندوب! 💨`,
  delivering: (id) => `🚀 *تحديث بخصوص طلبك #${id}:*\nالمندوب استلم طلبك وهو في الطريق إليك الآن! 🛵💨`,
  completed:  (id) => `🎉 *تم تسليم طلبك #${id} بنجاح!*\nشكراً لتعاملك معنا في دليفري طنطا، نسعد بخدمتك دائماً! 🙏❤️`,
  cancelled:  (id) => `❌ *نعتذر منك بخصوص طلبك #${id}:*\nتم إلغاء الطلب حالياً. للتفاصيل أو المساعدة تواصل معنا عبر خدمة العملاء.`,
};

// نظام نقاط الولاء والمحفظة
const POINTS_PER_ORDER      = Number(process.env.POINTS_PER_ORDER) || 10;
const WALLET_PACKAGES       = [
  { id: 'balad', points: 80,  amount: 20, label: 'مشوار البلد (20 جنيه)' },
  { id: 'tanta', points: 150, amount: 60, label: 'مشوار طنطا (60 جنيه)' },
];

module.exports = {
  BOT_TOKEN, ADMIN_PASS, DB_PATH, PORT, PRIMARY_ADMIN_CHAT_ID,
  STATUS_LABELS, INPUT_TYPE_LABELS, CUSTOMER_STATUS_NOTIFICATIONS,
  POINTS_PER_ORDER, WALLET_PACKAGES,
};
