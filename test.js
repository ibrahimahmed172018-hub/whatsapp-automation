import assert from 'node:assert/strict';
import {
  initDB,
  CustomerState,
  getUserState,
  resetUserState,
  get
} from './db.js';
import { handleCustomerMessage } from './botHandler.js';
import { formatOrderSummaryMessage } from './geminiService.js';
import config from './config.js';

console.log('🧪 بدء فحص المرحلة الأخيرة: تأكيد الأوردر (PENDING) وإرساله لجروب المناديب...');

function createMockSocket() {
  const sentMessages = [];
  return {
    sentMessages,
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, text: content.text });
      return { key: { id: 'mock-id' } };
    }
  };
}

async function runTests() {
  await initDB();

  const phone = '201077665544';
  const mockSock = createMockSocket();

  await resetUserState(phone);

  // 1. بدء محادثة جديدة وتحديد قسم (مطاعم طنطا)
  console.log('1. اختبار بدء محادثة واختيار قسم...');
  await handleCustomerMessage(phone, 'مساء الخير', mockSock);
  await handleCustomerMessage(phone, '2', mockSock); // 2. مطاعم طنطا

  // 2. العميل يرسل تفاصيل طلبه
  console.log('2. اختبار إرسال تفاصيل الطلب بالعامية...');
  const orderDetails = '2 حواوشي مخصوص + بطاطس من حواوشي الرفاعي شارع سعيد يوصلوا الاستاد برج الفردوس';
  let res = await handleCustomerMessage(phone, orderDetails, mockSock);
  assert.equal(res.newState, CustomerState.CONFIRMING_ORDER);
  assert.ok(res.messageSent.includes('📋 ملخص طلبك يا فندم:'));
  assert.ok(res.messageSent.includes('1 للتأكيد'));

  // 3. اختبار كتابة "تعديل" أو "2"
  console.log('3. اختبار كتابة "تعديل" / "2" وإتاحة الفرصة للعميل لتعديل طلبه...');
  res = await handleCustomerMessage(phone, 'تعديل', mockSock);
  assert.equal(res.newState, CustomerState.IN_ORDER_FLOW);
  assert.ok(res.messageSent.includes('اتفضل اكتب التعديل المطلوب أو تفاصيل طلبك'));
  console.log('   ✅ تم الانتقال بسلاسة لحالة IN_ORDER_FLOW لكتابة التعديل.');

  // 4. العميل يرسل التعديل
  const updatedOrderDetails = '3 حواوشي مخصوص بدل 2 + كانز بيبسي من نفس المكان لنفس العنوان';
  res = await handleCustomerMessage(phone, updatedOrderDetails, mockSock);
  assert.equal(res.newState, CustomerState.CONFIRMING_ORDER);

  // 5. اختبار تأكيد الطلب بكتابة "أكد" أو "1"
  console.log('4. اختبار كتابة "أكد" / "1": حفظ PENDING + إرسال شكر للعميل + إشعار جروب المناديب + تصفير الحالة...');
  res = await handleCustomerMessage(phone, 'أكد', mockSock);
  assert.equal(res.newState, CustomerState.IDLE);
  assert.ok(res.orderId > 0);
  assert.equal(res.groupAlertSent, true);

  // أ. التحقق من صيغة إشعار الأدمن والمناديب المطلوبة
  assert.ok(res.groupAlertText.includes('🚨 أوردر جديد يا كابتن!'));
  assert.ok(res.groupAlertText.includes(`- كود الأوردر: #${res.orderId}`));
  assert.ok(res.groupAlertText.includes(`- رقم العميل: +${phone}`));
  assert.ok(res.groupAlertText.includes('- القسم: مطاعم طنطا'));
  assert.ok(res.groupAlertText.includes('- التفاصيل:'));
  assert.ok(res.groupAlertText.includes('- الوقت:'));
  console.log('   ✅ صيغة إشعار جروب المناديب والأدمن مطابقة تماماً للمطلوب:\n', res.groupAlertText);

  // ب. التحقق من رسالة شكر وتأكيد العميل
  assert.ok(res.messageSent.includes('تم تأكيد طلبك بنجاح ومندوبنا هيتواصل معاك فوراً!'));
  assert.ok(res.messageSent.includes(String(res.orderId)));
  console.log('   ✅ تم إرسال رسالة الشكر وتأكيد الأوردر للعميل بنجاح.');

  // ج. التحقق من حفظ الأوردر في جدول orders بحالة PENDING
  const dbOrder = await get(`SELECT * FROM orders WHERE id = ?`, [res.orderId]);
  assert.equal(dbOrder.status, 'PENDING');
  assert.equal(dbOrder.phone, phone);
  assert.equal(dbOrder.category, 'مطاعم طنطا');
  console.log(`   ✅ تم حفظ الأوردر في SQLite بحالة PENDING برقم (#${dbOrder.id}).`);

  // د. التحقق من تصفير حالة العميل إلى IDLE وقراءة current_data
  const userState = await getUserState(phone);
  assert.equal(userState.state, CustomerState.IDLE);
  assert.deepEqual(userState.current_data, {});
  console.log('   ✅ تم تصفير حالة العميل وبياناته المؤقتة إلى IDLE بنجاح وتأكيد عمود current_data.');

  // ==========================================================================
  // اختبار القائمة التفاعلية والخيارات 1، 4، 6 (Interactive List Options)
  // ==========================================================================
  console.log('\n4.1 اختبار خيارات القائمة التفاعلية (option_1, option_4, option_6)...');
  const testInteractivePhone = '201011223344';
  await resetUserState(testInteractivePhone);

  // اختبار اختيار option_1 (دليفري)
  await handleCustomerMessage(testInteractivePhone, 'مرحبا', mockSock);
  const opt1Res = await handleCustomerMessage(testInteractivePhone, 'option_1', mockSock);
  assert.equal(opt1Res.newState, CustomerState.IN_ORDER_FLOW);
  assert.ok(opt1Res.messageSent.includes('خدمة توصيل الطرود والمشاوير'));
  console.log('   ✅ خيار option_1 (دليفري) ينقل العميل إلى IN_ORDER_FLOW ويطلب التفاصيل.');

  // اختبار اختيار option_4 (عروض اليوم)
  await resetUserState(testInteractivePhone);
  await handleCustomerMessage(testInteractivePhone, 'مرحبا', mockSock);
  const opt4Res = await handleCustomerMessage(testInteractivePhone, 'option_4', mockSock);
  assert.equal(opt4Res.newState, CustomerState.AWAITING_MENU_SELECTION);
  assert.ok(opt4Res.messageSent.includes('عروض اليوم الحصرية'));
  console.log('   ✅ خيار option_4 (عروض اليوم) يرسل العروض ويبقى في AWAITING_MENU_SELECTION.');

  // اختبار اختيار option_6 (خدمة العملاء)
  await resetUserState(testInteractivePhone);
  await handleCustomerMessage(testInteractivePhone, 'مرحبا', mockSock);
  const opt6Res = await handleCustomerMessage(testInteractivePhone, 'option_6', mockSock);
  assert.equal(opt6Res.newState, CustomerState.HUMAN_SUPPORT);
  assert.equal(opt6Res.adminAlertSent, true);
  assert.ok(opt6Res.messageSent.includes('تم تحويلك لخدمة العملاء'));
  console.log('   ✅ خيار option_6 (خدمة العملاء) ينقل إلى HUMAN_SUPPORT ويرسل تنبيه للأدمن.');

  // ==========================================================================
  // 5. فحص ميزة إدارة المطاعم والمينيوهات (إضافة، تعديل، تعطيل، حذف، واختيار العميل)
  // ==========================================================================
  console.log('\n5. اختبار ميزة إدارة مطاعم طنطا والمينيوهات والتحكم الكامل...');
  const {
    getAllRestaurants,
    getRestaurantById,
    addRestaurant,
    updateRestaurant,
    toggleRestaurantActive,
    deleteRestaurant
  } = await import('./db.js');

  // أ. إضافة مطعم جديد
  const newRest = await addRestaurant({
    name: 'مطعم روستو طنطا',
    area: 'شارع سعيد - طنطا',
    menu_text: '🍗 وجبة بروستد 4 قطع: 135 ج | ساندوتش زنجر: 70 ج | بطاطس مبهرة: 30 ج',
    image_url: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=600',
    is_active: 1
  });
  assert.ok(newRest.id > 0);
  assert.equal(newRest.name, 'مطعم روستو طنطا');
  console.log(`   ✅ تم إضافة مطعم جديد بنجاح: ${newRest.name} (#${newRest.id}).`);

  // ب. تجربة اختيار المطعم من واتساب
  const testPhone2 = '201099887766';
  await resetUserState(testPhone2);
  const mockSock2 = createMockSocket();

  // العميل يرسل تحية أولاً وتظهر له القائمة الرئيسية
  await handleCustomerMessage(testPhone2, 'مرحبا', mockSock2);

  // العميل يكتب 2 لعرض قائمة مطاعم طنطا
  const menuListRes = await handleCustomerMessage(testPhone2, '2', mockSock2);
  assert.equal(menuListRes.newState, CustomerState.SELECTING_RESTAURANT);
  assert.ok(menuListRes.messageSent.includes('مطعم روستو طنطا'));
  console.log('   ✅ ظهر المطعم الجديد للعميل في قائمة مطاعم طنطا على واتساب.');

  // ج. العميل يختار رقم المطعم
  const allActive = await getAllRestaurants(true);
  const روستوIndex = allActive.findIndex(r => r.id === newRest.id) + 1;
  const chooseRestRes = await handleCustomerMessage(testPhone2, String(روستوIndex), mockSock2);
  assert.equal(chooseRestRes.newState, CustomerState.IN_ORDER_FLOW);
  assert.ok(chooseRestRes.messageSent.includes('وجبة بروستد 4 قطع'));
  assert.equal(chooseRestRes.selectedRestaurant.name, 'مطعم روستو طنطا');
  console.log('   ✅ أرسل البوت مينيو المطعم المختار وتفاصيله وصورته بنجاح.');

  // د. اختبار تعطيل المطعم (Disable / Toggle)
  const toggled = await toggleRestaurantActive(newRest.id);
  assert.equal(toggled.is_active, 0);
  const activeAfterToggle = await getAllRestaurants(true);
  assert.ok(!activeAfterToggle.some(r => r.id === newRest.id));
  console.log('   ✅ تم تعطيل المطعم بنجاح واختفى تلقائياً من قائمة العملاء على واتساب.');

  // هـ. اختبار إعادة التفعيل
  const reToggled = await toggleRestaurantActive(newRest.id);
  assert.equal(reToggled.is_active, 1);
  const activeAfterReToggle = await getAllRestaurants(true);
  assert.ok(activeAfterReToggle.some(r => r.id === newRest.id));
  console.log('   ✅ تم إعادة تفعيل المطعم وظهر مجدداً في القائمة.');

  // و. اختبار تعديل المينيو والبيانات
  const updatedRest = await updateRestaurant(newRest.id, {
    name: 'مطعم روستو طنطا المطور',
    area: 'شارع الجيش - طنطا',
    menu_text: '🍗 وجبة بروستد سوبر: 150 ج',
    image_url: 'https://images.unsplash.com/test.jpg',
    is_active: 1
  });
  assert.equal(updatedRest.name, 'مطعم روستو طنطا المطور');
  assert.equal(updatedRest.area, 'شارع الجيش - طنطا');
  console.log('   ✅ تم تعديل وتحديث بيانات المطعم والمينيو بنجاح.');

  // ز. اختبار حذف المطعم
  await deleteRestaurant(newRest.id);
  const deletedCheck = await getRestaurantById(newRest.id);
  assert.equal(deletedCheck, undefined);
  console.log('   ✅ تم حذف المطعم بنجاح.');

  console.log('\n🎉 جميع اختبارات ميزة المطاعم والمينيوهات تعمل بنجاح 100%!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});
