import {
  CustomerState,
  getUserState,
  setUserState,
  resetUserState,
  saveOrder,
  getAllRestaurants
} from './db.js';
import config from './config.js';
import { parseOrderWithGemini, formatOrderSummaryMessage } from './geminiService.js';

/**
 * إرسال رسالة واتساب للعميل بشكل آمن
 */
async function sendReply(sock, remoteJid, text) {
  if (sock && typeof sock.sendMessage === 'function') {
    try {
      await sock.sendMessage(remoteJid, { text });
    } catch (err) {
      console.error(`❌ فشل إرسال الرسالة إلى ${remoteJid}:`, err?.message || err);
    }
  }
}

/**
 * إرسال تنبيه للأدمن عبر واتساب والـ Console
 */
async function notifyAdmin(sock, alertMessage) {
  console.log(`\n📢 ${alertMessage}\n`);
  if (
    sock &&
    config.adminPhone &&
    config.adminPhone !== '201000000000' &&
    typeof sock.sendMessage === 'function'
  ) {
    try {
      const adminJid = `${config.adminPhone.replace('+', '')}@s.whatsapp.net`;
      await sock.sendMessage(adminJid, { text: alertMessage });
    } catch (err) {
      console.error('❌ تعذر إرسال تنبيه واتساب للأدمن:', err?.message || err);
    }
  }
}

/**
 * إرسال إشعار فوري لجروب المناديب عبر واتساب
 */
async function sendToDriversGroup(sock, alertMessage) {
  console.log(`\n📢 [إشعار جروب المناديب]:\n${alertMessage}\n`);
  const groupJid = config.driversGroupJid;
  if (sock && groupJid && typeof sock.sendMessage === 'function') {
    try {
      const normalizedJid = groupJid.includes('@g.us') ? groupJid : `${groupJid}@g.us`;
      await sock.sendMessage(normalizedJid, { text: alertMessage });
    } catch (err) {
      console.error('❌ تعذر إرسال الإشعار لجروب المناديب:', err?.message || err);
    }
  }
}

/**
 * معالج منطق الرسائل ونظام الحالات (State Machine)
 */
export async function handleCustomerMessage(senderPhone, messageText, sock = null, remoteJid = null) {
  const text = (messageText || '').trim();
  const jid = remoteJid || `${senderPhone}@s.whatsapp.net`;

  // جلب الحالة الحالية للعميل
  const user = await getUserState(senderPhone);
  let currentState = user.state;
  let orderData = user.current_order_data || {};

  // كلمات الرجوع وإعادة التعيين العامة
  const resetKeywords = ['0', 'رجوع', 'إلغاء', 'القائمة', 'menu', 'start', 'ريسيت'];
  if (resetKeywords.includes(text.toLowerCase()) && currentState !== CustomerState.CONFIRMING_ORDER) {
    await resetUserState(senderPhone);
    await setUserState(senderPhone, CustomerState.AWAITING_MENU_SELECTION, {});
    await sendReply(sock, jid, config.messages.mainMenu);
    return {
      replied: true,
      newState: CustomerState.AWAITING_MENU_SELECTION,
      messageSent: config.messages.mainMenu
    };
  }

  // كلمات التحية الشائعة (تعرض القائمة الرئيسية إذا لم يكن العميل في منتصف إدخال تفاصيل طلب)
  const greetingKeywords = ['سلام', 'مرحبا', 'أهلاً', 'اهلا', 'صباح الخير', 'مساء الخير', 'الو', 'hi', 'hello', 'hey'];
  const isGreeting = greetingKeywords.some((kw) => text.toLowerCase().includes(kw));
  if (isGreeting && currentState !== CustomerState.IN_ORDER_FLOW && currentState !== CustomerState.CONFIRMING_ORDER) {
    await setUserState(senderPhone, CustomerState.AWAITING_MENU_SELECTION, {});
    await sendReply(sock, jid, config.messages.mainMenu);
    return {
      replied: true,
      newState: CustomerState.AWAITING_MENU_SELECTION,
      messageSent: config.messages.mainMenu
    };
  }

  // 1. العميل في حالة IDLE أو أرسل تحية لأول مرة
  if (currentState === CustomerState.IDLE) {
    await setUserState(senderPhone, CustomerState.AWAITING_MENU_SELECTION, {});
    await sendReply(sock, jid, config.messages.mainMenu);
    return {
      replied: true,
      newState: CustomerState.AWAITING_MENU_SELECTION,
      messageSent: config.messages.mainMenu
    };
  }

  // 2. العميل في حالة اختيار القسم (AWAITING_MENU_SELECTION)
  if (currentState === CustomerState.AWAITING_MENU_SELECTION) {
    // خيار 1: توصيل طرد أو مشوار
    if (text === '1' || text.includes('طرد') || text.includes('مشوار')) {
      const category = config.categories['1'];
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category,
        step: 'awaiting_details'
      });
      await sendReply(sock, jid, config.messages.option1Prompt);
      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: config.messages.option1Prompt
      };
    }

    // خيار 2: مطاعم طنطا (عرض قائمة المطاعم المتاحة مع المينيوهات)
    if (text === '2' || text.includes('مطعم') || text.includes('مطاعم') || text.includes('اكل')) {
      const restaurants = await getAllRestaurants(true);
      if (restaurants.length > 0) {
        let menuListMsg = `🍔 مطاعم طنطا المتاحة للطلب الآن:\n━━━━━━━━━━━━━━━━━\n`;
        restaurants.forEach((r, idx) => {
          menuListMsg += `${idx + 1}️⃣ ${r.name} (${r.area})\n`;
        });
        menuListMsg += `0️⃣ مطعم آخر غير موجود بالقائمة\n━━━━━━━━━━━━━━━━━\n(أرسل رقم المطعم لعرض المينيو والطلب 📋)`;

        await setUserState(senderPhone, CustomerState.SELECTING_RESTAURANT, {
          category: 'مطاعم طنطا'
        });
        await sendReply(sock, jid, menuListMsg);
        return {
          replied: true,
          newState: CustomerState.SELECTING_RESTAURANT,
          messageSent: menuListMsg
        };
      }

      // إذا لم تكن هناك مطاعم مدخلة نطلب التفاصيل مباشرة
      const category = config.categories['2'];
      const reply = config.messages.placesPrompt(category);
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category,
        step: 'awaiting_details'
      });
      await sendReply(sock, jid, reply);
      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: reply
      };
    }

    // خيار 3: تسوق من طنطا
    if (text === '3' || text.includes('تسوق') || text.includes('سوبر') || text.includes('ماركت')) {
      const category = config.categories['3'];
      const reply = config.messages.placesPrompt(category);
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category,
        step: 'awaiting_details'
      });
      await sendReply(sock, jid, reply);
      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: reply
      };
    }

    // خيار 4: عروض اليوم
    if (text === '4' || text.includes('عرض') || text.includes('عروض')) {
      const reply = config.messages.todayOffers;
      await sendReply(sock, jid, reply);
      return {
        replied: true,
        newState: CustomerState.AWAITING_MENU_SELECTION,
        messageSent: reply
      };
    }

    // خيار 5: محلات المنطقة
    if (text === '5' || text.includes('محلات') || text.includes('صيدلية') || text.includes('مخبز')) {
      const category = config.categories['5'];
      const reply = config.messages.placesPrompt(category);
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category,
        step: 'awaiting_details'
      });
      await sendReply(sock, jid, reply);
      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: reply
      };
    }

    // خيار 6: كلم خدمة العملاء
    if (text === '6' || text.includes('خدمة') || text.includes('عملاء') || text.includes('دعم')) {
      await setUserState(senderPhone, CustomerState.HUMAN_SUPPORT, {});
      const reply = config.messages.humanSupport;
      await sendReply(sock, jid, reply);

      // تنبيه الأدمن
      const alert = `🚨 [تنبيه عاجل للأدمن]: العميل +${senderPhone} طلب التحدث مع الدعم البشري وخدمة العملاء في طنطا!`;
      await notifyAdmin(sock, alert);

      return {
        replied: true,
        newState: CustomerState.HUMAN_SUPPORT,
        messageSent: reply,
        adminAlertSent: true
      };
    }

    // إدخال غير معروف في القائمة
    const fallback = `⚠️ اختيار غير صحيح. يرجى إرسال رقم من 1 إلى 6:\n\n${config.messages.mainMenu}`;
    await sendReply(sock, jid, fallback);
    return {
      replied: true,
      newState: CustomerState.AWAITING_MENU_SELECTION,
      messageSent: fallback
    };
  }

  // 3. العميل في حالة اختيار المطعم وعرض المينيو (SELECTING_RESTAURANT)
  // 3. العميل في حالة اختيار المطعم وعرض المينيو (SELECTING_RESTAURANT)
  if (currentState === CustomerState.SELECTING_RESTAURANT) {
    const restaurants = await getAllRestaurants(true);

    // تحويل الأرقام العربية إلى إنجليزية لتسهيل المعالجة
    const arabicToEng = (str) => (str || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const cleanText = text.trim();
    const normalizedDigits = arabicToEng(cleanText);
    const isPureDigits = /^\d+$/.test(normalizedDigits);

    // خيار 0: مطعم آخر غير موجود بالقائمة
    if (cleanText === '0' || normalizedDigits === '0' || text.includes('آخر') || text.includes('اخر')) {
      const prompt = `تمام يا فندم، اكتب لنا في رسالة واحدة:\n1️⃣ اسم المطعم المطلوب في طنطا ومكانه\n2️⃣ الأصناف والطلبات بالتفصيل\n3️⃣ عنوان التوصيل الخاص بك\n\n(أو أرسل "0" للإلغاء والعودة للقائمة)`;
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category: 'مطاعم طنطا (مطعم مخصص)'
      });
      await sendReply(sock, jid, prompt);
      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: prompt
      };
    }

    // إذا اختار العميل رقم مطعم محدد (1, 2, 3...)
    if (isPureDigits) {
      const selectedIndex = parseInt(normalizedDigits, 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < restaurants.length) {
        const selected = restaurants[selectedIndex];
        const menuMsg = `📍 مطعم: ${selected.name} (${selected.area})\n━━━━━━━━━━━━━━━━━\n📋 مينيو المطعم:\n${selected.menu_text || 'اطلب أي صنف متوفر من المطعم'}\n━━━━━━━━━━━━━━━━━\n✍️ اكتب لنا الأصناف المطلوبة وعنوان التوصيل في طنطا في رسالة واحدة:\n(أو أرسل "0" للإلغاء والعودة للقائمة)`;

        // إذا كان للمطعم صورة نرسلها مع الكابشن
        if (sock && selected.image_url && typeof sock.sendMessage === 'function') {
          try {
            if (selected.image_url.startsWith('http') || selected.image_url.startsWith('/')) {
              await sock.sendMessage(jid, { image: { url: selected.image_url }, caption: menuMsg });
            } else {
              await sendReply(sock, jid, menuMsg);
            }
          } catch {
            await sendReply(sock, jid, menuMsg);
          }
        } else {
          await sendReply(sock, jid, menuMsg);
        }

        await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
          category: `مطاعم طنطا (${selected.name})`,
          restaurant_id: selected.id,
          restaurant_name: selected.name,
          restaurant_area: selected.area
        });

        return {
          replied: true,
          newState: CustomerState.IN_ORDER_FLOW,
          messageSent: menuMsg,
          selectedRestaurant: selected
        };
      }
    }

    // مطابقة المطعم بالاسم في حال كتب العميل اسم المطعم بدلاً من رقمه
    const matchedByName = restaurants.find(
      (r) => cleanText.toLowerCase().includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(cleanText.toLowerCase())
    );
    if (matchedByName) {
      const menuMsg = `📍 مطعم: ${matchedByName.name} (${matchedByName.area})\n━━━━━━━━━━━━━━━━━\n📋 مينيو المطعم:\n${matchedByName.menu_text || 'اطلب أي صنف متوفر من المطعم'}\n━━━━━━━━━━━━━━━━━\n✍️ اكتب لنا الأصناف المطلوبة وعنوان التوصيل في طنطا في رسالة واحدة:\n(أو أرسل "0" للإلغاء والعودة للقائمة)`;

      if (sock && matchedByName.image_url && typeof sock.sendMessage === 'function') {
        try {
          if (matchedByName.image_url.startsWith('http') || matchedByName.image_url.startsWith('/')) {
            await sock.sendMessage(jid, { image: { url: matchedByName.image_url }, caption: menuMsg });
          } else {
            await sendReply(sock, jid, menuMsg);
          }
        } catch {
          await sendReply(sock, jid, menuMsg);
        }
      } else {
        await sendReply(sock, jid, menuMsg);
      }

      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category: `مطاعم طنطا (${matchedByName.name})`,
        restaurant_id: matchedByName.id,
        restaurant_name: matchedByName.name,
        restaurant_area: matchedByName.area
      });

      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: menuMsg,
        selectedRestaurant: matchedByName
      };
    }

    // إذا كتب العميل تفاصيل طلبه مباشرة (بدلاً من اختيار رقم)، نتنقل تلقائياً لاستقبال الطلب وتلخيصه بـ Gemini
    if (cleanText.length > 10) {
      // نقل العميل إلى IN_ORDER_FLOW وتمرير الرسالة لمعالج الأوردر
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, {
        category: 'مطاعم طنطا'
      });
      // استمرار المعالجة كأوردر في الحالة التالية أدناه
      currentState = CustomerState.IN_ORDER_FLOW;
      orderData = { category: 'مطاعم طنطا' };
    } else {
      const fallback = `⚠️ اختيار غير صحيح. يرجى إرسال رقم المطعم من 1 إلى ${restaurants.length} (أو 0 لمطعم آخر).`;
      await sendReply(sock, jid, fallback);
      return {
        replied: true,
        newState: CustomerState.SELECTING_RESTAURANT,
        messageSent: fallback
      };
    }
  }

  // 4. استقبال تفاصيل العميل بالعامية وإرسالها للـ LLM لتلخيصها (IN_ORDER_FLOW)
  if (currentState === CustomerState.IN_ORDER_FLOW) {
    const category = orderData.category || 'طلب عام';

    // 1. استخراج بيانات الطلب باستخدام Gemini API
    const parsedData = await parseOrderWithGemini(category, text, senderPhone);

    const updatedData = {
      ...orderData,
      raw_text: text,
      place_or_item: parsedData.place_or_item,
      location: parsedData.location,
      notes: parsedData.notes,
      details: `${parsedData.place_or_item} (اللوكيشن: ${parsedData.location}${parsedData.notes !== 'لا يوجد' ? ` | ملاحظات: ${parsedData.notes}` : ''})`
    };

    // 3. تغيير حالة العميل إلى CONFIRMING_ORDER
    await setUserState(senderPhone, CustomerState.CONFIRMING_ORDER, updatedData);

    // 2. صياغة رد ملخص واضح للعميل
    const confirmationMsg = formatOrderSummaryMessage(category, parsedData, senderPhone);
    await sendReply(sock, jid, confirmationMsg);

    return {
      replied: true,
      newState: CustomerState.CONFIRMING_ORDER,
      messageSent: confirmationMsg,
      parsedData
    };
  }

  // 4. العميل في مرحلة تأكيد الطلب (CONFIRMING_ORDER)
  if (currentState === CustomerState.CONFIRMING_ORDER) {
    const confirmKeywords = ['1', 'أكد', 'اكد', 'تأكيد', 'نعم', 'تمام', 'أكيد'];
    if (confirmKeywords.some((kw) => text === kw || text.includes(kw))) {
      const category = orderData.category || 'دليفري عام';
      const details = orderData.details || 'بدون تفاصيل إضافية';
      const deliveryLocation = orderData.location || 'طنطا';

      // 1. حفظ الأوردر بـ PENDING في جدول orders
      const savedOrder = await saveOrder(senderPhone, {
        category,
        details,
        delivery_location: deliveryLocation,
        status: 'PENDING'
      });

      // 2. إرسال رسالة شكر وتأكيد للعميل
      const thankYouReply = config.messages.orderConfirmedThankYou(savedOrder.id);
      await sendReply(sock, jid, thankYouReply);

      // 3. إرسال إشعار فوري لجروب الواتساب بالصيغة المطلوبة
      const nowTime = new Date().toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const groupAlert = config.messages.groupOrderAlert(
        senderPhone,
        category,
        details,
        nowTime
      );

      // إرسال الإشعار لجروب المناديب
      await sendToDriversGroup(sock, groupAlert);

      // تنبيه للأدمن
      await notifyAdmin(
        sock,
        `🛵 [أوردر جديد #${savedOrder.id} - PENDING]\nالعميل: +${senderPhone}\nالقسم: ${category}\nالتفاصيل: ${details}\nالوقت: ${nowTime}`
      );

      // 4. تصفير حالة العميل إلى IDLE
      await resetUserState(senderPhone);

      return {
        replied: true,
        newState: CustomerState.IDLE,
        messageSent: thankYouReply,
        orderId: savedOrder.id,
        groupAlertSent: true,
        groupAlertText: groupAlert
      };
    }

    // 2 أو "تعديل"
    const editKeywords = ['2', 'تعديل', 'عدل', 'أعدل', 'غير', 'تغيير'];
    if (editKeywords.some((kw) => text === kw || text.includes(kw))) {
      const category = orderData.category || 'طلب عام';
      await setUserState(senderPhone, CustomerState.IN_ORDER_FLOW, { category });

      const editPrompt = `تمام يا فندم، اتفضل اكتب التعديل المطلوب أو تفاصيل طلبك واللوكيشن من جديد: ✍️\n(أو أرسل "0" للإلغاء والعودة للقائمة الرئيسية)`;
      await sendReply(sock, jid, editPrompt);

      return {
        replied: true,
        newState: CustomerState.IN_ORDER_FLOW,
        messageSent: editPrompt
      };
    }

    // 0 أو إلغاء
    if (text === '0' || text.includes('إلغاء') || text.includes('لا')) {
      await resetUserState(senderPhone);
      const cancelReply = config.messages.orderCancelled;
      await sendReply(sock, jid, cancelReply);
      await sendReply(sock, jid, config.messages.mainMenu);
      await setUserState(senderPhone, CustomerState.AWAITING_MENU_SELECTION, {});

      return {
        replied: true,
        newState: CustomerState.AWAITING_MENU_SELECTION,
        messageSent: cancelReply
      };
    }

    // توجيه العميل للاختيار
    const prompt = `يرجى إرسال:\n"1" لتأكيد الطلب وإرسال المندوب 🛵\n"2" لتعديل تفاصيل الطلب ✍️\nأو "0" للإلغاء والعودة للقائمة الرئيسية ❌`;
    await sendReply(sock, jid, prompt);
    return {
      replied: true,
      newState: CustomerState.CONFIRMING_ORDER,
      messageSent: prompt
    };
  }

  // 5. العميل في حالة الدعم البشري (HUMAN_SUPPORT)
  if (currentState === CustomerState.HUMAN_SUPPORT) {
    console.log(`💬 [محادثة دعم بشري] العميل (+${senderPhone}): "${text}"`);
    // يمكن هنا إخطار الأدمن برسائل العميل أثناء وجوده في الدعم
    return {
      replied: false,
      newState: CustomerState.HUMAN_SUPPORT
    };
  }

  return { replied: false };
}

export default { handleCustomerMessage };
