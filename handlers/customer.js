// ==========================================
// handlers/customer.js — تدفق العميل الكامل
// يشمل: اختيار القسم، إرسال الطلب، التأكيد، التعديل، الإلغاء
// لو عايز تغيير في تجربة العميل، هتجي هنا
// ==========================================

const { POINTS_PER_ORDER, WALLET_PACKAGES } = require('../config');
const { stmts } = require('../db');
const { parseOrderDetails, parseMenuImages } = require('../db');
const { buildMainMenuKeyboard, confirmKeyboard, getConfirmKeyboard, getWalletKeyboard } = require('../keyboards');

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
  const freshUser = stmts.getUser.get(chatId) || user;
  const keyboard = getConfirmKeyboard(freshUser.wallet_balance || 0);

  await ctx.replyWithPhoto(fileId, {
    caption: `📋 *ملخص طلبك بالصورة:*\n\n📂 القسم: ${catLabel}\n📝 الملاحظات/التفاصيل:\n${caption}\n\nهل تريد تأكيد الطلب؟` + (freshUser.wallet_balance > 0 ? `\n\n💡 رصيد محفظتك: *${freshUser.wallet_balance} ج* (يمكنك استخدامه لخصم التوصيل أدناه 👇)` : ''),
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

// ─── معالجة رسائل النصية الخاصة بالعميل ─────────────────────────────────────

async function handleCustomerText(ctx, next) {
  const chatId = ctx.chat?.id;
  const text   = ctx.message.text.trim();
  const lower  = text.toLowerCase();
  const user   = ctx.dbUser || stmts.getUser.get(chatId);

  if (['محفظتي', 'محفظة', 'نقاطي', 'النقاط', 'wallet', '/wallet'].includes(lower)) {
    const freshUser = stmts.getUser.get(chatId) || user;
    const points = freshUser.points || 0;
    const balance = freshUser.wallet_balance || 0;
    const walletMsg = `💰 *محفظتي ونقاطي*\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `⭐ رصيد نقاطك: *${points}* نقطة\n`
      + `💵 رصيد محفظتك: *${balance}* جنيه\n\n`
      + `🎁 *باقات استبدال النقاط:*\n`
      + `• 80 نقطة ⬅️ 20 جنيه (مشوار البلد)\n`
      + `• 150 نقطة ⬅️ 60 جنيه (مشوار طنطا)\n\n`
      + `💡 *كيف تكسب النقاط؟*\n`
      + `تحصل على *+${POINTS_PER_ORDER}* نقاط ولاء تلقائياً مع كل طلب مؤكد! 🛵\n`
      + (points < 80 ? `\n_(باقي لك ${80 - points} نقطة لاستبدال باقة الـ 20 جنيه)_` : '');

    return ctx.reply(walletMsg, {
      parse_mode: 'Markdown',
      ...getWalletKeyboard(points)
    });
  }

  switch (user.state) {
    case 'IDLE':
      return ctx.reply('👆 اختر من القائمة أو اكتب /start', buildMainMenuKeyboard());

    case 'WAITING_DETAILS':
    case 'WAITING_DETAILS_OR_PHOTO': {
      stmts.setPending.run(text, 'CONFIRMING', chatId);
      const catObj = stmts.getCategory.get(user.selected_category);
      const label  = catObj ? catObj.name : (user.selected_category || '');
      const freshUser = stmts.getUser.get(chatId) || user;
      const keyboard = getConfirmKeyboard(freshUser.wallet_balance || 0);
      return ctx.reply(
        `📋 *ملخص طلبك:*\n\n📂 القسم: ${label}\n📝 التفاصيل:\n${text}\n\nهل تريد تأكيد الطلب؟` + (freshUser.wallet_balance > 0 ? `\n\n💡 رصيد محفظتك: *${freshUser.wallet_balance} ج* (يمكنك استخدامه لخصم التوصيل أدناه 👇)` : ''),
        { parse_mode: 'Markdown', ...keyboard }
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

  // ── عرض المحفظة والنقاط ──
  if (data === 'user_wallet') {
    const freshUser = stmts.getUser.get(chatId) || user;
    const points = freshUser.points || 0;
    const balance = freshUser.wallet_balance || 0;

    const walletMsg = `💰 *محفظتي ونقاطي*\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `⭐ رصيد نقاطك: *${points}* نقطة\n`
      + `💵 رصيد محفظتك: *${balance}* جنيه\n\n`
      + `🎁 *باقات استبدال النقاط:*\n`
      + `• 80 نقطة ⬅️ 20 جنيه (مشوار البلد)\n`
      + `• 150 نقطة ⬅️ 60 جنيه (مشوار طنطا)\n\n`
      + `💡 *كيف تكسب النقاط؟*\n`
      + `تحصل على *+${POINTS_PER_ORDER}* نقاط ولاء تلقائياً مع كل طلب مؤكد! 🛵\n`
      + (points < 80 ? `\n_(باقي لك ${80 - points} نقطة لاستبدال باقة الـ 20 جنيه)_` : '');

    return ctx.reply(walletMsg, {
      parse_mode: 'Markdown',
      ...getWalletKeyboard(points)
    });
  }

  // ── استبدال النقاط بباقة رصيد محفظة ──
  if (data.startsWith('exchange:')) {
    const pkgId = data.split(':')[1];
    const pkg = WALLET_PACKAGES.find(p => p.id === pkgId);
    if (!pkg) return ctx.reply('⚠️ الباقة غير متوفرة.');

    const freshUser = stmts.getUser.get(chatId) || user;
    const currentPoints = freshUser.points || 0;

    if (currentPoints < pkg.points) {
      await ctx.answerCbQuery(`⚠️ نقاطك غير كافية! تحتاج ${pkg.points} نقطة.`).catch(() => {});
      return ctx.reply(`⚠️ رصيد نقاطك الحالي (${currentPoints}) لا يكفي لهذه الباقة. تحتاج إلى ${pkg.points} نقطة.`);
    }

    stmts.deductPoints.run(pkg.points, chatId);
    stmts.addWallet.run(pkg.amount, chatId);
    const updated = stmts.getUser.get(chatId);

    await ctx.answerCbQuery(`🎉 تم استبدال ${pkg.points} نقطة بـ ${pkg.amount} جنيه بنجاح!`).catch(() => {});
    return ctx.reply(
      `🎉 *مبروك! تم استبدال الباقة بنجاح!*\n\n`
      + `➖ تم خصم: *${pkg.points}* نقطة\n`
      + `➕ تم إضافة: *${pkg.amount}* جنيه إلى رصيد محفظتك 💵\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `⭐ رصيد نقاطك الآن: *${updated.points}* نقطة\n`
      + `💵 رصيد محفظتك الآن: *${updated.wallet_balance}* جنيه\n\n`
      + `يمكنك استخدام رصيد محفظتك في أي وقت لخصم قيمة توصيل طلباتك!`,
      {
        parse_mode: 'Markdown',
        ...getWalletKeyboard(updated.points)
      }
    );
  }

  // ── تأكيد الطلب ──
  if (data === 'confirm' || data === 'confirm:cash' || data === 'confirm:wallet') {
    if (user.state !== 'CONFIRMING' || !user.pending_details || !user.selected_category) {
      stmts.resetUser.run(chatId);
      return ctx.reply('انتهت صلاحية الجلسة، ابدأ من جديد.', buildMainMenuKeyboard());
    }

    const freshUser = stmts.getUser.get(chatId) || user;
    let walletDiscount = 0;
    if (data === 'confirm:wallet' && freshUser.wallet_balance > 0) {
      walletDiscount = freshUser.wallet_balance;
      stmts.deductWallet.run(walletDiscount, chatId);
    }

    // إضافة نقاط الولاء للطلب
    stmts.addPoints.run(POINTS_PER_ORDER, chatId);

    const username = ctx.from?.username || '';
    const result   = stmts.insertOrder.run(chatId, username, user.selected_category, user.pending_details, walletDiscount);
    const orderId  = result.lastInsertRowid;
    stmts.resetUser.run(chatId);

    const afterUser = stmts.getUser.get(chatId);

    // حساب حالة العميل (جديد أم سابق)
    const nonCancelledCount = stmts.countUserNonCancelledOrders.get(chatId).total;
    const prevOrders = Math.max(0, nonCancelledCount - 1);
    const isNewCustomer = prevOrders === 0;

    let confirmMsg = `✅ *تم تأكيد طلبك بنجاح!*\n\n`
      + `🔖 رقم طلبك: *#${orderId}*\n`
      + `🎁 حصلت على *+${POINTS_PER_ORDER}* نقاط ولاء!\n`;
    if (walletDiscount > 0) {
      confirmMsg += `💳 تم خصم *${walletDiscount}* ج من محفظتك للتوصيل!\n`;
    }
    confirmMsg += `⭐ رصيد نقاطك: *${afterUser.points}* نقطة\n`
      + `💵 رصيد محفظتك: *${afterUser.wallet_balance}* جنيه\n\n`
      + `سيتواصل معك فريقنا قريباً لتنفيذ وتوصيل الطلب. شكراً لك! 🙏`;

    await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });

    // إشعار فوري للأدمن — يتم من index.js عبر notifyAdmins
    ctx.orderToNotify = {
      id: orderId,
      chat_id: chatId,
      username,
      category: user.selected_category,
      details: user.pending_details,
      wallet_discount: walletDiscount,
      is_new: isNewCustomer,
      prev_orders: prevOrders,
      user_points: afterUser.points,
      user_wallet: afterUser.wallet_balance,
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
