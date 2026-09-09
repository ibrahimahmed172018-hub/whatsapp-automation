// ==========================================
// handlers/restaurants.js — إدارة المطاعم والمنيو
// يشمل: إضافة مطعم، رفع صور المنيو، عرض المطاعم، حذف مطعم
// لو عايز تضيف ميزة للمطاعم، هتجي هنا
// ==========================================

const { PRIMARY_ADMIN_CHAT_ID } = require('../config');
const { stmts, adminMultiPhotos } = require('../db');
const { parseMenuImages } = require('../db');
const { Markup } = require('telegraf');
const {
  adminRestaurantsKeyboard,
  getRestImageChoiceKeyboard,
  getMultiPhotoKeyboard,
} = require('../keyboards');

// ─── معالجة صور الأدمن للمطاعم ───────────────────────────────────────────────

async function handleRestaurantPhoto(ctx, next) {
  const chatId      = ctx.chat?.id;
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  const photoArray = ctx.message.photo;
  const fileId     = photoArray[photoArray.length - 1].file_id;

  // ── صورة واحدة لمطعم ──
  if (user.state === 'ADMIN_ADD_REST_IMG_SINGLE') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const restName = user.pending_details || 'مطعم جديد';
    stmts.insertCategoryItem.run('cat_restaurants', restName, JSON.stringify([fileId]));
    stmts.resetUser.run(chatId);
    return ctx.reply(
      `✅ *تم بنجاح إضافة مطعم "${restName}" مع صورة المنيو!* 📸🍔\n\nأصبح متاحاً الآن في قسم المطاعم ليراه العملاء.`,
      { parse_mode: 'Markdown', ...adminRestaurantsKeyboard }
    );
  }

  // ── ألبوم صور لمطعم ──
  if (user.state === 'ADMIN_ADD_REST_MULTI_IMG') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    let session = adminMultiPhotos.get(chatId);
    if (!session) {
      session = { catId: 'cat_restaurants', itemName: user.pending_details || 'مطعم جديد', photos: [] };
      adminMultiPhotos.set(chatId, session);
    }
    session.photos.push(fileId);
    const count = session.photos.length;
    return ctx.reply(
      `📥 تم استلام صورة المنيو رقم (${count}). يمكنك إرسال المزيد من صور المنيو، أو الضغط على زر الحفظ أدناه عند الانتهاء:`,
      { ...getMultiPhotoKeyboard(count) }
    );
  }

  return next();
}

// ─── معالجة رسائل النصية الخاصة بالمطاعم ────────────────────────────────────

async function handleRestaurantText(ctx, next) {
  const chatId      = ctx.chat?.id;
  const text        = ctx.message.text.trim();
  const lower       = text.toLowerCase();
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // ── إدخال اسم المطعم ──
  if (user.state === 'ADMIN_ADD_REST_NAME') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (text.length > 50) return ctx.reply('⚠️ اسم المطعم طويل، اكتب اسماً مختصراً.');
    stmts.setPending.run(text, 'ADMIN_ADD_REST_CHOOSE_IMG', chatId);
    return ctx.reply(
      `🍽️ اسم المطعم: *${text}*\n\n📸 هل تريد إضافة *صورة واحدة* للمنيو أم *ألبوم عدة صور*؟`,
      { parse_mode: 'Markdown', ...getRestImageChoiceKeyboard() }
    );
  }

  // ── تأكيد نصي لحفظ الألبوم ──
  if (user.state === 'ADMIN_ADD_REST_MULTI_IMG') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (['تم', 'حفظ', 'خلاص', 'done', 'save'].includes(lower)) {
      const session  = adminMultiPhotos.get(chatId);
      const restName = session?.itemName || user.pending_details || 'مطعم جديد';
      const photos   = session?.photos || [];
      if (photos.length === 0) return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل صور المنيو أولاً أو اختر بدون صورة.');
      stmts.insertCategoryItem.run('cat_restaurants', restName, JSON.stringify(photos));
      stmts.resetUser.run(chatId);
      adminMultiPhotos.delete(chatId);
      return ctx.reply(
        `✅ *تم بنجاح إضافة مطعم "${restName}" مع عدد (${photos.length}) صور للمنيو!* 📸🍔\n\nأصبح متاحاً الآن في قسم المطاعم ليراه العملاء.`,
        { parse_mode: 'Markdown', ...adminRestaurantsKeyboard }
      );
    }
  }

  return next();
}

// ─── معالجة الـ callback_query الخاصة بالمطاعم ───────────────────────────────

async function handleRestaurantCallback(ctx, next) {
  const chatId      = ctx.chat?.id;
  const data        = ctx.callbackQuery.data;
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // ── لوحة إدارة المطاعم ──
  if (data === 'admin_restaurants') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const count = stmts.countCategoryItems.get('cat_restaurants').total;
    return ctx.reply(
      `🍽️ *إدارة المطاعم والمنيو:*\n\nعدد المطاعم المسجلة حالياً: *${count}* مطعم.\nاختر الإجراء الذي تريده:`,
      { parse_mode: 'Markdown', ...adminRestaurantsKeyboard }
    );
  }

  // ── إضافة مطعم: طلب الاسم ──
  if (data === 'admin_add_rest') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_NAME', chatId);
    return ctx.reply('📝 *أدخل اسم المطعم الجديد:*\n(مثال: كريب لافير، كرم الشام، بازوكا...)', { parse_mode: 'Markdown' });
  }

  // ── اختيار صورة واحدة ──
  if (data === 'rest_img_single') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_IMG_SINGLE', chatId);
    return ctx.reply('📸 أرسل الآن *صورة واحدة فقط* لمنيو المطعم:', { parse_mode: 'Markdown' });
  }

  // ── اختيار ألبوم صور ──
  if (data === 'rest_img_multi') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_REST_MULTI_IMG', chatId);
    const restName = user.pending_details || 'مطعم جديد';
    adminMultiPhotos.set(chatId, { catId: 'cat_restaurants', itemName: restName, photos: [] });
    return ctx.reply(
      `📚 *إضافة عدة صور للمنيو (ألبوم):*\n\nأرسل صور المنيو الآن (يمكنك إرسالها دفعة واحدة كألبوم أو صورة تلو الأخرى).\n\nعند الانتهاء من إرسال كافة الصور، اضغط على زر *[ ✅ حفظ الصور والانتهاء ]* بالأسفل:`,
      { parse_mode: 'Markdown', ...getMultiPhotoKeyboard(0) }
    );
  }

  // ── بدون صورة ──
  if (data === 'rest_img_none') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const restName = user.pending_details || 'مطعم جديد';
    stmts.insertCategoryItem.run('cat_restaurants', restName, null);
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);
    return ctx.reply(`✅ *تمت إضافة مطعم "${restName}" بنجاح بدون صورة منيو.*`, {
      parse_mode: 'Markdown', ...adminRestaurantsKeyboard,
    });
  }

  // ── قائمة المطاعم ──
  if (data === 'admin_list_rest') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const rests = stmts.getCategoryItems.all('cat_restaurants');
    if (!rests.length) return ctx.reply('لا توجد مطاعم مسجلة بعد. اضغط "إضافة مطعم" لإضافة أول مطعم.', adminRestaurantsKeyboard);

    await ctx.reply(`📋 *المطاعم المسجلة (${rests.length}):*`, { parse_mode: 'Markdown' });
    for (const r of rests) {
      const keyboard = Markup.inlineKeyboard([[Markup.button.callback(`❌ حذف مطعم ${r.name}`, `del_rest:${r.id}`)]]);
      const photos   = parseMenuImages(r.image_ids);
      if (photos.length === 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🍽️ *${r.name}*\n📸 صورة منيو واحدة مرفقة.`,
          parse_mode: 'Markdown', ...keyboard,
        }).catch(() => {});
      } else if (photos.length > 1) {
        await ctx.replyWithPhoto(photos[0], {
          caption: `🍽️ *${r.name}*\n📸 ألبوم منيو يحتوي على *(${photos.length}) صور*.`,
          parse_mode: 'Markdown', ...keyboard,
        }).catch(() => {});
      } else {
        await ctx.reply(`🍽️ *${r.name}* (بدون صورة منيو)`, { parse_mode: 'Markdown', ...keyboard });
      }
    }
    return;
  }

  // ── حذف مطعم ──
  if (data.startsWith('del_rest:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.deleteCategoryItem.run(Number(data.split(':')[1]));
    await ctx.answerCbQuery('تم حذف المطعم بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف المطعم بنجاح من القائمة.', adminRestaurantsKeyboard);
  }

  return next();
}

module.exports = { handleRestaurantPhoto, handleRestaurantText, handleRestaurantCallback };
