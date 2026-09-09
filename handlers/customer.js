// ==========================================
// handlers/customer.js — تدفق العميل الكامل
// يشمل: اختيار القسم، إرسال الطلب، التأكيد، التعديل، الإلغاء
// لو عايز تغيير في تجربة العميل، هتجي هنا
// ==========================================

const { stmts } = require('../db');
const { parseOrderDetails, parseMenuImages } = require('../db');
const { buildMainMenuKeyboard, confirmKeyboard } = require('../keyboards');

// ─── معالجة صور العميل (روشتة / قائمة مشتريات) ──────────────────────────────

async function handleCustomerPhoto(ctx, next) {
  const chatId = ctx.chat?.id;
  const user   = ctx.dbUser || stmts.getUser.get(chatId);

  if (user.state !== 'WAITING_DETAILS' && user.state !== 'WAITING_DETAILS_OR_PHOTO') {
    return next();
  }

  const photoArray = ctx.message.photo;
  const fileId     = photoArray[photoArray.length - 1].file_id;
  const caption    = ctx.message.caption?.trim() || 'طلب بالصورة المرفقة (روشتة / قائمة طلبات)';
  const stored     = JSON.stringify({ type: 'photo', fileId, text: caption });

  stmts.setPending.run(stored, 'CONFIRMING', chatId);

  const catObj   = stmts.getCategory.get(user.selected_category);
  const catLabel = catObj ? catObj.name : user.selected_category;

  await ctx.replyWithPhoto(fileId, {
    caption: `📋 *ملخص طلبك بالصورة:*\n\n📂 القسم: ${catLabel}\n📝 الملاحظات/التفاصيل:\n${caption}\n\nهل تريد تأكيد الطلب؟`,
    parse_mode: 'Markdown',
    ...confirmKeyboard,
  });
}

// ─── معالجة رسائل النصية الخاصة بالعميل ─────────────────────────────────────

async function handleCustomerText(ctx, next) {
  const chatId = ctx.chat?.id;
  const text   = ctx.message.text.trim();
  const user   = ctx.dbUser || stmts.getUser.get(chatId);

  switch (user.state) {
    case 'IDLE':
      return ctx.reply('👆 اختر من القائمة أو اكتب /start', buildMainMenuKeyboard());

    case 'WAITING_DETAILS':
    case 'WAITING_DETAILS_OR_PHOTO': {
      stmts.setPending.run(text, 'CONFIRMING', chatId);
      const catObj = stmts.getCategory.get(user.selected_category);
      const label  = catObj ? catObj.name : (user.selected_category || '');
      return ctx.reply(
        `📋 *ملخص طلبك:*\n\n📂 القسم: ${label}\n📝 التفاصيل:\n${text}\n\nهل تريد تأكيد الطلب؟`,
        { parse_mode: 'Markdown', ...confirmKeyboard }
      );
    }

    case 'CONFIRMING':
      return ctx.reply('👆 الرجاء الضغط على أحد الأزرار أدناه.', confirmKeyboard);

    default:
      return next();
  }
}

// ─── معالجة الـ callback_query الخاصة بالعميل ───────────────────────────────

async function handleCustomerCallback(ctx, next) {
  const chatId = ctx.chat?.id;
  const data   = ctx.callbackQuery.data;
  const user   = ctx.dbUser || stmts.getUser.get(chatId);

  // ── فتح قسم ──
  if (data.startsWith('open_cat:')) {
    const catId = data.split(':')[1];
    const cat   = stmts.getCategory.get(catId);
    if (!cat) return ctx.reply('القسم غير موجود حالياً، اختر قسماً آخر.', buildMainMenuKeyboard());

    if (cat.input_type === 'items') {
      const items = stmts.getCategoryItems.all(catId);
      if (items.length > 0) {
        const itemButtons = items.map(it => [Markup.button.callback(`🏪 ${it.name}`, `select_item:${it.id}`)]);
        itemButtons.push([Markup.button.callback('📝 طلب محل/عنصر آخر غير مسجل', `item_other:${catId}`)]);
        itemButtons.push([Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_menu')]);
        const { Markup } = require('telegraf');
        return ctx.reply(
          `📂 *${cat.name}*\n\nاختر من القائمة لعرض المنيو والطلب، أو اختر طلب آخر:`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard(itemButtons) }
        );
      }
      // لا توجد عناصر → مسار مباشر
      stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
      return ctx.reply(cat.prompt, { parse_mode: 'Markdown' });
    }

    if (cat.input_type === 'photo_or_text') {
      stmts.setCategory.run(catId, 'WAITING_DETAILS_OR_PHOTO', chatId);
    } else {
      stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
    }
    return ctx.reply(cat.prompt, { parse_mode: 'Markdown' });
  }

  // ── اختيار عنصر/محل محدد ──
  if (data.startsWith('select_item:')) {
    const { Markup } = require('telegraf');
    const itemId  = Number(data.split(':')[1]);
    const item    = stmts.getCategoryItem.get(itemId);
    if (!item) return ctx.reply('العنصر غير موجود، اختر غيره.', buildMainMenuKeyboard());

    const catObj   = stmts.getCategory.get(item.category_id);
    const catTitle = catObj ? catObj.name : 'القسم';
    stmts.setCategory.run(`${item.category_id}:${item.name}`, 'WAITING_DETAILS', chatId);

    const promptText = `🏪 *طلب من: ${item.name}* (${catTitle})\n\nاكتب تفاصيل طلبك كاملة:\n• الأصناف المطلوبة والكميات\n• عنوان التوصيل بالتفصيل\n• رقم للتواصل (اختياري)`;
    const photos     = parseMenuImages(item.image_ids);

    if (photos.length === 1) {
      return ctx.replyWithPhoto(photos[0], { caption: promptText, parse_mode: 'Markdown' })
        .catch(() => ctx.reply(promptText, { parse_mode: 'Markdown' }));
    }

    if (photos.length > 1) {
      const mediaGroup = photos.slice(0, 10).map((fid, idx) => ({
        type: 'photo', media: fid,
        caption: idx === 0 ? `🏪 *منيو/صور: ${item.name}* (${photos.length} صور)` : undefined,
        parse_mode: idx === 0 ? 'Markdown' : undefined,
      }));
      try { await ctx.replyWithMediaGroup(mediaGroup); }
      catch { for (const p of photos) await ctx.replyWithPhoto(p).catch(() => {}); }
      return ctx.reply(promptText, { parse_mode: 'Markdown' });
    }

    return ctx.reply(promptText, { parse_mode: 'Markdown' });
  }

  // ── طلب عنصر آخر غير مسجل ──
  if (data.startsWith('item_other:')) {
    const catId = data.split(':')[1];
    const cat   = stmts.getCategory.get(catId);
    stmts.setCategory.run(catId, 'WAITING_DETAILS', chatId);
    return ctx.reply(cat ? cat.prompt : 'اكتب تفاصيل طلبك وعنوان التوصيل:', { parse_mode: 'Markdown' });
  }

  // ── تأكيد الطلب ──
  if (data === 'confirm') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', buildMainMenuKeyboard());
    }
    const username = ctx.from?.username || '';
    const result   = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details);
    const orderId  = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    await ctx.reply(
      `✅ *تم تأكيد طلبك بنجاح!*\n\n🔖 رقم طلبك: *#${orderId}*\n\nسيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`,
      { parse_mode: 'Markdown' }
    );

    // إشعار فوري للأدمن — يتم من index.js عبر notifyAdmins
    ctx.orderToNotify = {
      id: orderId, chat_id: chatId, username,
      category: user.selected_category, details: user.pending_details,
      created_at: new Date().toLocaleString('ar-EG'),
    };
    return;
  }

  // ── تعديل الطلب ──
  if (data === 'edit') {
    stmts.setState.run('WAITING_DETAILS', chatId);
    const catObj = stmts.getCategory.get(user.selected_category);
    const label  = catObj ? catObj.name : (user.selected_category || '');
    return ctx.reply(`✏️ أعد إدخال تفاصيل طلبك (القسم: ${label}):`);
  }

  // ── إلغاء الطلب ──
  if (data === 'cancel') {
    stmts.resetUser.run(chatId);
    return ctx.reply('❌ تم إلغاء الطلب.', buildMainMenuKeyboard());
  }

  // ── رجوع للقائمة الرئيسية ──
  if (data === 'back_to_menu') {
    stmts.resetUser.run(chatId);
    return ctx.reply('👋 القائمة الرئيسية:', buildMainMenuKeyboard());
  }

  return next();
}

module.exports = { handleCustomerPhoto, handleCustomerText, handleCustomerCallback };
