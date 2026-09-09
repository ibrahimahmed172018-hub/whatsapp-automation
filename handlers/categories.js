// ==========================================
// handlers/categories.js — إدارة الأقسام الديناميكية
// يشمل: إضافة/حذف/تعديل الأقسام، إضافة/حذف العناصر والمحلات
// لو عايز تضيف ميزة في إدارة الأقسام، هتجي هنا
// ==========================================

const { PRIMARY_ADMIN_CHAT_ID, INPUT_TYPE_LABELS } = require('../config');
const { stmts, adminMultiPhotos, adminNewCategory, parseMenuImages } = require('../db');
const { Markup } = require('telegraf');
const {
  adminCategoriesMenuKeyboard,
  adminRestaurantsKeyboard,
  getCategoryTypeChoiceKeyboard,
  getItemImageChoiceKeyboard,
  getMultiPhotoKeyboard,
} = require('../keyboards');

// ─── معالجة صور الأدمن للعناصر والمحلات ─────────────────────────────────────

async function handleCategoryPhoto(ctx, next) {
  const chatId      = ctx.chat?.id;
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  const photoArray = ctx.message.photo;
  const fileId     = photoArray[photoArray.length - 1].file_id;

  // ── صورة واحدة لعنصر ──
  if (user.state.startsWith('ADMIN_ITEM_IMG_SINGLE:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const catId    = user.state.split(':')[1];
    const itemName = user.pending_details || 'عنصر جديد';
    stmts.insertCategoryItem.run(catId, itemName, JSON.stringify([fileId]));
    stmts.resetUser.run(chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(
      `✅ *تم بنجاح إضافة "${itemName}" في قسم [${cat?.name || catId}] مع صورة المنيو/المنتج!* 📸`,
      { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
    );
  }

  // ── ألبوم صور لعنصر ──
  if (user.state.startsWith('ADMIN_ITEM_IMG_MULTI:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح لك.');
    const catId = user.state.split(':')[1];
    let session = adminMultiPhotos.get(chatId);
    if (!session) {
      session = { catId, itemName: user.pending_details || 'عنصر جديد', photos: [] };
      adminMultiPhotos.set(chatId, session);
    }
    session.photos.push(fileId);
    const count = session.photos.length;
    return ctx.reply(
      `📥 تم استلام الصورة رقم (${count}). يمكنك إرسال المزيد، أو الضغط على زر الحفظ أدناه عند الانتهاء:`,
      { ...getMultiPhotoKeyboard(count) }
    );
  }

  return next();
}

// ─── معالجة رسائل النصية الخاصة بالأقسام ────────────────────────────────────

async function handleCategoryText(ctx, next) {
  const chatId      = ctx.chat?.id;
  const text        = ctx.message.text.trim();
  const lower       = text.toLowerCase();
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // ── إدخال اسم القسم الجديد ──
  if (user.state === 'ADMIN_ADD_CAT_NAME') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    if (text.length > 50) return ctx.reply('⚠️ اسم القسم طويل، يرجى كتابة اسم مختصر.');
    adminNewCategory.set(chatId, { name: text });
    stmts.setState.run('ADMIN_ADD_CAT_CHOOSE_TYPE', chatId);
    return ctx.reply(
      `📂 اسم القسم الجديد: *${text}*\n\n👇 *حدد الآن نوع البيانات التي سيطلبها البوت من العميل في هذا القسم:*`,
      { parse_mode: 'Markdown', ...getCategoryTypeChoiceKeyboard() }
    );
  }

  // ── إدخال رسالة التوجيه للقسم الجديد ──
  if (user.state === 'ADMIN_ADD_CAT_PROMPT') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catData = adminNewCategory.get(chatId);
    if (!catData) {
      stmts.resetUser.run(chatId);
      return ctx.reply('حدث خطأ، أعد إضافة القسم من البداية.', adminCategoriesMenuKeyboard);
    }
    const catId = `cat_custom_${Date.now()}`;
    const count = stmts.countCategories.get().total + 1;
    stmts.insertCategory.run(catId, catData.name, text, catData.input_type, count);
    stmts.resetUser.run(chatId);
    adminNewCategory.delete(chatId);
    return ctx.reply(
      `🎉 *تم بنجاح إنشاء القسم الجديد!*
━━━━━━━━━━━━━━━━━
📂 الاسم: *${catData.name}*
📌 نوع بيانات العميل: *${INPUT_TYPE_LABELS[catData.input_type]}*
💬 رسالة التوجيه:
${text}
━━━━━━━━━━━━━━━━━
يظهر الآن فوراً في القائمة الرئيسية للعملاء.`,
      { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
    );
  }

  // ── تعديل رسالة توجيه قسم قائم ──
  if (user.state.startsWith('ADMIN_EDIT_PROMPT:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];
    stmts.updateCategoryPrompt.run(text, catId);
    stmts.resetUser.run(chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(
      `✅ *تم تحديث رسالة التوجيه لقسم [${cat?.name || catId}] بنجاح!*\n\nالرسالة الجديدة:\n${text}`,
      { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
    );
  }

  // ── إدخال اسم عنصر/محل جديد ──
  if (user.state.startsWith('ADMIN_ADD_ITEM_NAME:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];
    if (text.length > 100) return ctx.reply('⚠️ الاسم طويل، اكتب اسماً مختصراً.');
    stmts.setPending.run(text, `ADMIN_ITEM_CHOOSE_IMG:${catId}`, chatId);
    return ctx.reply(
      `🏪 اسم المحل / العنصر: *${text}*\n\n📸 هل تريد إضافة *صورة واحدة* للمنيو أم *ألبوم عدة صور*؟`,
      { parse_mode: 'Markdown', ...getItemImageChoiceKeyboard() }
    );
  }

  // ── تأكيد نصي لحفظ ألبوم عنصر ──
  if (user.state.startsWith('ADMIN_ITEM_IMG_MULTI:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = user.state.split(':')[1];
    if (['تم', 'حفظ', 'خلاص', 'done', 'save'].includes(lower)) {
      const session  = adminMultiPhotos.get(chatId);
      const itemName = session?.itemName || user.pending_details || 'عنصر جديد';
      const photos   = session?.photos || [];
      if (photos.length === 0) return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل صور المنيو أولاً أو اختر بدون صورة.');
      stmts.insertCategoryItem.run(catId, itemName, JSON.stringify(photos));
      stmts.resetUser.run(chatId);
      adminMultiPhotos.delete(chatId);
      const cat = stmts.getCategory.get(catId);
      return ctx.reply(
        `✅ *تم بنجاح إضافة "${itemName}" في قسم [${cat?.name || catId}] مع عدد (${photos.length}) صور للمنيو!* 📸🍔`,
        { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
      );
    }
  }

  return next();
}

// ─── معالجة الـ callback_query الخاصة بالأقسام ───────────────────────────────

async function handleCategoryCallback(ctx, next) {
  const chatId      = ctx.chat?.id;
  const data        = ctx.callbackQuery.data;
  const user        = ctx.dbUser || stmts.getUser.get(chatId);
  const isUserAdmin = user.is_admin === 1 || chatId === PRIMARY_ADMIN_CHAT_ID;

  // ── لوحة إدارة الأقسام ──
  if (data === 'admin_manage_categories') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const count      = stmts.countCategories.get().total;
    const totalItems = stmts.countAllItems.get().total;
    return ctx.reply(
      `⚙️ *لوحة إدارة الأقسام والخدمات:*\n\nعدد الأقسام: *${count}* قسم\nإجمالي المحلات/العناصر: *${totalItems}* عنصر\n\nاختر ما تريد القيام به:`,
      { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
    );
  }

  // ── إضافة قسم: طلب الاسم ──
  if (data === 'admin_add_cat_start') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.setState.run('ADMIN_ADD_CAT_NAME', chatId);
    return ctx.reply('📝 *أدخل اسم القسم الجديد:*\n(مثال: 🥩 جزارة ولحوم، 🚗 مشاوير وتوصيل أفراد، 🎂 حلويات ومخبوزات...)', { parse_mode: 'Markdown' });
  }

  // ── اختيار نوع بيانات القسم ──
  if (data.startsWith('choose_type:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const inputType = data.split(':')[1];
    const catData   = adminNewCategory.get(chatId) || {};
    catData.input_type = inputType;
    adminNewCategory.set(chatId, catData);
    stmts.setState.run('ADMIN_ADD_CAT_PROMPT', chatId);

    const suggestions = {
      text:          'اكتب تفاصيل طلبك بالتفصيل وعنوان التوصيل ورقم الهاتف:',
      photo_or_text: 'أرسل صورة الروشتة أو قائمة المشتريات، أو اكتب تفاصيل طلبك وعنوانك بالتفصيل:',
      items:         'اختر المحل من القائمة واكتب الأصناف المطلوبة وعنوان التوصيل:',
    };
    return ctx.reply(
      `✍️ *الخطوة الأخيرة: رسالة توجيه العميل:*\nاكتب الرسالة التي ستظهر للعميل عند فتح هذا القسم.\n\n💡 *اقتراح جاهز:*\n_${suggestions[inputType] || ''}_\n\nاكتب رسالتك الآن وأرسلها للشات:`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── عرض قائمة الأقسام ──
  if (data === 'admin_list_categories') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const cats = stmts.getCategories.all();
    if (!cats.length) return ctx.reply('لا توجد أقسام مسجلة.', adminCategoriesMenuKeyboard);
    await ctx.reply(`📂 *قائمة الأقسام الحالية (${cats.length}):*\nيمكنك إضافة عناصر لأي قسم، تعديل رسالته، أو حذفه:`, { parse_mode: 'Markdown' });
    for (const c of cats) {
      const itemCount = stmts.countCategoryItems.get(c.id).total;
      const card = `📌 *${c.name}*\n🔹 نوع مدخلات العميل: ${INPUT_TYPE_LABELS[c.input_type] || c.input_type}\n📦 عدد المحلات/العناصر: ${itemCount}\n💬 الرسالة:\n_${c.prompt.substring(0, 80)}..._`;
      const buttons = [
        [Markup.button.callback('➕ إضافة محل/عنصر/منيو', `cat_add_item:${c.id}`), Markup.button.callback(`📋 العناصر (${itemCount})`, `cat_view_items:${c.id}`)],
        [Markup.button.callback('✏️ تعديل رسالة التوجيه', `cat_edit_prompt:${c.id}`), Markup.button.callback('❌ حذف القسم', `cat_del:${c.id}`)],
      ];
      await ctx.reply(card, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(() => {});
    }
    return;
  }

  // ── حذف قسم ──
  if (data.startsWith('cat_del:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.deleteCategory.run(catId);
    require('../db').db.prepare('DELETE FROM category_items WHERE category_id = ?').run(catId);
    await ctx.answerCbQuery('تم حذف القسم بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف القسم وكافة عناصره بنجاح.', adminCategoriesMenuKeyboard);
  }

  // ── تعديل رسالة توجيه قسم ──
  if (data.startsWith('cat_edit_prompt:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.setState.run(`ADMIN_EDIT_PROMPT:${catId}`, chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(`✏️ *أدخل الرسالة الجديدة لقسم [${cat?.name || catId}]:*`, { parse_mode: 'Markdown' });
  }

  // ── إضافة عنصر/محل لقسم ──
  if (data.startsWith('cat_add_item:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    stmts.setState.run(`ADMIN_ADD_ITEM_NAME:${catId}`, chatId);
    const cat = stmts.getCategory.get(catId);
    return ctx.reply(
      `🏪 *أدخل اسم المحل أو العنصر الجديد لقسم [${cat?.name || catId}]:*\n(مثال: كريب لافير، صيدلية العزبي، سوبرماركت زهران...)`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── اختيار نوع صورة العنصر: واحدة ──
  if (data === 'item_img_single') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    stmts.setState.run(`ADMIN_ITEM_IMG_SINGLE:${pendingCat}`, chatId);
    return ctx.reply('📸 أرسل الآن *صورة واحدة فقط* للمنيو أو المحل:', { parse_mode: 'Markdown' });
  }

  // ── اختيار نوع صورة العنصر: ألبوم ──
  if (data === 'item_img_multi') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    const itemName   = user.pending_details || 'عنصر جديد';
    stmts.setState.run(`ADMIN_ITEM_IMG_MULTI:${pendingCat}`, chatId);
    adminMultiPhotos.set(chatId, { catId: pendingCat, itemName, photos: [] });
    return ctx.reply(
      `📚 *إضافة عدة صور (ألبوم منيو):*\n\nأرسل الصور الآن (يمكنك إرسالها معاً كألبوم أو واحدة تلو الأخرى).\n\nعند الانتهاء اضغط زر *[ ✅ حفظ الصور والانتهاء ]* بالأسفل:`,
      { parse_mode: 'Markdown', ...getMultiPhotoKeyboard(0) }
    );
  }

  // ── بدون صورة للعنصر ──
  if (data === 'item_img_none') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const pendingCat = user.state.split(':')[1] || 'cat_restaurants';
    const itemName   = user.pending_details || 'عنصر جديد';
    stmts.insertCategoryItem.run(pendingCat, itemName, null);
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);
    const cat = stmts.getCategory.get(pendingCat);
    return ctx.reply(
      `✅ *تمت إضافة "${itemName}" في قسم [${cat?.name || pendingCat}] بنجاح بدون صور.*`,
      { parse_mode: 'Markdown', ...adminCategoriesMenuKeyboard }
    );
  }

  // ── حفظ ألبوم العنصر بالزر ──
  if (data === 'item_img_multi_finish') {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const session  = adminMultiPhotos.get(chatId);
    const catId    = session?.catId || 'cat_restaurants';
    const itemName = session?.itemName || user.pending_details || 'عنصر جديد';
    const photos   = session?.photos || [];
    if (photos.length === 0) return ctx.reply('⚠️ لم ترسل أي صور بعد! أرسل الصور أولاً أو اختر بدون صورة.');
    stmts.insertCategoryItem.run(catId, itemName, JSON.stringify(photos));
    stmts.resetUser.run(chatId);
    adminMultiPhotos.delete(chatId);
    const isRest = catId === 'cat_restaurants';
    const cat    = stmts.getCategory.get(catId);
    return ctx.reply(
      `✅ *تم بنجاح إضافة "${itemName}" في ${isRest ? 'قسم المطاعم' : `قسم [${cat?.name || catId}]`} مع عدد (${photos.length}) صور للمنيو!* 📸🍔`,
      { parse_mode: 'Markdown', ...(isRest ? adminRestaurantsKeyboard : adminCategoriesMenuKeyboard) }
    );
  }

  // ── عرض عناصر قسم محدد ──
  if (data.startsWith('cat_view_items:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    const catId = data.split(':')[1];
    const cat   = stmts.getCategory.get(catId);
    const items = stmts.getCategoryItems.all(catId);
    if (!items.length) {
      return ctx.reply(
        `لا توجد محلات أو عناصر مضافة في قسم [${cat?.name || catId}]. اضغط "إضافة محل/عنصر" لإضافة أول عنصر.`,
        { ...Markup.inlineKeyboard([[Markup.button.callback('➕ إضافة محل/عنصر الآن', `cat_add_item:${catId}`)], [Markup.button.callback('🔙 رجوع للأقسام', 'admin_list_categories')]]) }
      );
    }
    await ctx.reply(`📋 *عناصر ومحلات قسم [${cat?.name || catId}] (${items.length}):*`, { parse_mode: 'Markdown' });
    for (const it of items) {
      const keyboard = Markup.inlineKeyboard([[Markup.button.callback(`❌ حذف ${it.name}`, `del_item:${it.id}`)]]);
      const photos   = parseMenuImages(it.image_ids);
      if (photos.length === 1) {
        await ctx.replyWithPhoto(photos[0], { caption: `🏪 *${it.name}*\n📸 صورة واحدة مرفقة.`, parse_mode: 'Markdown', ...keyboard }).catch(() => {});
      } else if (photos.length > 1) {
        await ctx.replyWithPhoto(photos[0], { caption: `🏪 *${it.name}*\n📸 ألبوم يحتوي على *(${photos.length}) صور*.`, parse_mode: 'Markdown', ...keyboard }).catch(() => {});
      } else {
        await ctx.reply(`🏪 *${it.name}* (بدون صور)`, { parse_mode: 'Markdown', ...keyboard });
      }
    }
    return;
  }

  // ── حذف عنصر ──
  if (data.startsWith('del_item:')) {
    if (!isUserAdmin) return ctx.reply('⛔ غير مصرح.');
    stmts.deleteCategoryItem.run(Number(data.split(':')[1]));
    await ctx.answerCbQuery('تم حذف العنصر بنجاح.').catch(() => {});
    return ctx.reply('🗑️ تم حذف العنصر بنجاح.', adminCategoriesMenuKeyboard);
  }

  return next();
}

module.exports = { handleCategoryPhoto, handleCategoryText, handleCategoryCallback };
