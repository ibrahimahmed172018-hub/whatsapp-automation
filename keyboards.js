// ==========================================
// keyboards.js — كل أزرار الـ Inline Keyboard هنا
// لو عايز تضيف زر جديد أو تعدل زر موجود، هتجي هنا
// ==========================================

const { Markup } = require('telegraf');
const { stmts } = require('./db');

// ─── قائمة رئيسية ديناميكية من DB ────────────────────────────────────────────

function buildMainMenuKeyboard() {
  const cats = stmts.getCategories.all();
  const buttons = cats.map(c => [Markup.button.callback(c.name, `open_cat:${c.id}`)]);
  return Markup.inlineKeyboard(buttons);
}

// ─── لوحات العميل ────────────────────────────────────────────────────────────

const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد الطلب',    'confirm')],
  [Markup.button.callback('✏️ تعديل التفاصيل', 'edit')],
  [Markup.button.callback('❌ إلغاء',           'cancel')],
]);

function getOrderActionKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🛵 قبول وتجهيز',   `set_status:${orderId}:accepted`),
      Markup.button.callback('🚀 جاري التوصيل',  `set_status:${orderId}:delivering`),
    ],
    [
      Markup.button.callback('✅ تم التسليم',     `set_status:${orderId}:completed`),
      Markup.button.callback('❌ إلغاء واعتذار', `set_status:${orderId}:cancelled`),
    ],
  ]);
}

// ─── لوحة الأدمن الرئيسية ────────────────────────────────────────────────────
// لو عايز تضيف زر جديد للأدمن، ضيفه هنا وأضف الـ handler في handlers/admin.js

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📦 آخر الطلبات والتحكم فيها', 'admin_orders')],
  [Markup.button.callback('🍽️ إدارة المطاعم والمنيو',   'admin_restaurants')],
  [Markup.button.callback('⚙️ إدارة الأقسام والخدمات',   'admin_manage_categories')],
  [Markup.button.callback('📊 إحصائيات شاملة',           'admin_stats')],
  [Markup.button.callback('🚪 تسجيل الخروج',             'admin_logout')],
]);

// ─── لوحات إدارة المطاعم ─────────────────────────────────────────────────────

const adminRestaurantsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ إضافة مطعم ومنيو جديد', 'admin_add_rest')],
  [Markup.button.callback('📋 قائمة المطاعم الحالية', 'admin_list_rest')],
  [Markup.button.callback('🔙 رجوع للوحة الإدارة',   'admin_panel_back')],
]);

function getRestImageChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🖼️ صورة واحدة فقط',       'rest_img_single')],
    [Markup.button.callback('📚 عدة صور (ألبوم منيو)', 'rest_img_multi')],
    [Markup.button.callback('⏭️ بدون صورة (تخطي)',     'rest_img_none')],
    [Markup.button.callback('🔙 إلغاء والعودة',         'admin_restaurants')],
  ]);
}

// ─── لوحات إدارة الأقسام الديناميكية ────────────────────────────────────────

const adminCategoriesMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('➕ إضافة قسم جديد',             'admin_add_cat_start')],
  [Markup.button.callback('📂 عرض وتعديل الأقسام الحالية', 'admin_list_categories')],
  [Markup.button.callback('🔙 رجوع للوحة الإدارة',         'admin_panel_back')],
]);

function getCategoryTypeChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 نص فقط (تفاصيل وعنوان)',             'choose_type:text')],
    [Markup.button.callback('📸 صورة أو نص (روشتة / قائمة طلبات)',  'choose_type:photo_or_text')],
    [Markup.button.callback('🏪 قسم محلات ومنيو (قائمة فرعية)',     'choose_type:items')],
    [Markup.button.callback('🔙 إلغاء والعودة',                      'admin_manage_categories')],
  ]);
}

function getItemImageChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🖼️ صورة واحدة فقط',       'item_img_single')],
    [Markup.button.callback('📚 عدة صور (ألبوم منيو)', 'item_img_multi')],
    [Markup.button.callback('⏭️ بدون صورة (تخطي)',     'item_img_none')],
    [Markup.button.callback('🔙 إلغاء والعودة',         'admin_manage_categories')],
  ]);
}

function getMultiPhotoKeyboard(count) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ حفظ الصور والانتهاء (${count} صور)`, 'item_img_multi_finish')],
    [Markup.button.callback('❌ إلغاء الإضافة', 'admin_manage_categories')],
  ]);
}

module.exports = {
  buildMainMenuKeyboard,
  confirmKeyboard,
  getOrderActionKeyboard,
  adminKeyboard,
  adminRestaurantsKeyboard,
  getRestImageChoiceKeyboard,
  adminCategoriesMenuKeyboard,
  getCategoryTypeChoiceKeyboard,
  getItemImageChoiceKeyboard,
  getMultiPhotoKeyboard,
};
