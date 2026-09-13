const assert = require('assert');
const { db, stmts } = require('./db');
const { POINTS_PER_ORDER } = require('./config');

console.log('🧪 بدء اختبار نظام نقاط الولاء والمشاوير المجانية...');

// 1. فحص قيمة POINTS_PER_ORDER الافتراضية
assert.strictEqual(typeof POINTS_PER_ORDER, 'number');
assert.strictEqual(POINTS_PER_ORDER, 10, 'POINTS_PER_ORDER must default to 10');
console.log('✅ 1. تم التحقق من POINTS_PER_ORDER = 10');

// 2. فحص إضافة وخصم نقاط الولاء وحماية الحد الأدنى (0)
const testPhone = 'test_user_loyalty_999@c.us';
stmts.upsertUser.run(testPhone);

// إعادة تعيين النقاط لصفر للتأكد
db.prepare('UPDATE users SET points = 0 WHERE phone = ?').run(testPhone);
let userPts = stmts.getUserPoints.get(testPhone);
assert.strictEqual(userPts.points, 0);

// إضافة نقاط
stmts.addPoints.run(POINTS_PER_ORDER, testPhone);
userPts = stmts.getUserPoints.get(testPhone);
assert.strictEqual(userPts.points, 10, 'Points should be 10 after adding once');

// إضافة نقاط مرة أخرى
stmts.addPoints.run(POINTS_PER_ORDER, testPhone);
userPts = stmts.getUserPoints.get(testPhone);
assert.strictEqual(userPts.points, 20, 'Points should be 20 after adding twice');

// خصم نقاط
stmts.deductPoints.run(POINTS_PER_ORDER, testPhone);
userPts = stmts.getUserPoints.get(testPhone);
assert.strictEqual(userPts.points, 10, 'Points should be 10 after deducting 10');

// خصم أكثر من الرصيد (يجب ألا يقل عن 0)
stmts.deductPoints.run(50, testPhone);
userPts = stmts.getUserPoints.get(testPhone);
assert.strictEqual(userPts.points, 0, 'Points must not fall below 0');
console.log('✅ 2. تم التحقق من إضافة وخصم النقاط والحد الأدنى 0');

// 3. فحص إحصائيات الطلبات وتصنيف العميل (جديد vs سابق)
// تنظيف أي طلبات تجريبية سابقة للمستخدم
db.prepare('DELETE FROM orders WHERE chat_jid = ?').run(testPhone);

let stats = stmts.getUserOrderStats.get(testPhone, testPhone);
assert.strictEqual(stats.total_orders, 0, 'Initial total orders should be 0');
assert.strictEqual(stats.delivery_orders, 0, 'Initial delivery orders should be 0');

// تصنيف عميل جديد
const isNew = stats.total_orders === 0;
assert.strictEqual(isNew, true, 'User with 0 orders must be new');

// إدخال طلب دليفري
const ins1 = stmts.insertOrder.run(
  '01000000000',
  '🛵 دليفري وطلبات خاصة',
  null,
  'توصيل طلب تجريبي 1',
  null,
  testPhone
);
const orderId1 = ins1.lastInsertRowid;

stats = stmts.getUserOrderStats.get(testPhone, testPhone);
assert.strictEqual(stats.total_orders, 1, 'Total orders should be 1');
assert.strictEqual(stats.delivery_orders, 1, 'Delivery orders should be 1');

// إدخال طلب مطعم (ليس دليفري)
const ins2 = stmts.insertOrder.run(
  '01000000000',
  '🍔 مطاعم طنطا',
  'مطعم كرم الشام',
  'شاورما تجريبي',
  null,
  testPhone
);
const orderId2 = ins2.lastInsertRowid;

stats = stmts.getUserOrderStats.get(testPhone, testPhone);
assert.strictEqual(stats.total_orders, 2, 'Total orders should be 2');
assert.strictEqual(stats.delivery_orders, 1, 'Delivery orders should still be 1');

// إلغاء طلب والتأكد أنه لا يُحتسب في الإحصائيات النشطة
stmts.updateOrderStatus.run('cancelled', orderId2);
stats = stmts.getUserOrderStats.get(testPhone, testPhone);
assert.strictEqual(stats.total_orders, 1, 'Cancelled order must not be counted in total_orders');
console.log('✅ 3. تم التحقق من إحصائيات الطلبات واستثناء الطلبات الملغاة');

// 4. فحص حساب الأهداف والمشاوير المجانية (Milestones Logic)
function calculateMilestones(totalOrders, deliveryOrders) {
  const isTantaMilestone = totalOrders > 0 && totalOrders % 15 === 0;
  const remTanta = 15 - (totalOrders % 15);

  const isBaladMilestone = deliveryOrders > 0 && deliveryOrders % 3 === 0;
  const remBalad = 3 - (deliveryOrders % 3);

  return { isTantaMilestone, remTanta, isBaladMilestone, remBalad };
}

// طلب عادي رقم 1
const m1 = calculateMilestones(1, 1);
assert.strictEqual(m1.isTantaMilestone, false);
assert.strictEqual(m1.remTanta, 14);
assert.strictEqual(m1.isBaladMilestone, false);
assert.strictEqual(m1.remBalad, 2);

// مشوار البلد رقم 3 (استحقاق مشوار مجاني من البلد)
const m3 = calculateMilestones(5, 3);
assert.strictEqual(m3.isBaladMilestone, true, 'Every 3 delivery orders triggers Balad free ride');
assert.strictEqual(m3.isTantaMilestone, false);
assert.strictEqual(m3.remTanta, 10);

// طلب طنطا رقم 15 (استحقاق مشوار مجاني من طنطا)
const m15 = calculateMilestones(15, 2);
assert.strictEqual(m15.isTantaMilestone, true, 'Every 15 total orders triggers Tanta free ride');
assert.strictEqual(m15.isBaladMilestone, false);
console.log('✅ 4. تم التحقق من دقة حساب الأهداف والمشاوير المجانية لطنطا والبلد');

// 5. فحص استعلام allOrders في لوحة التحكم
stmts.addPoints.run(30, testPhone);
const orders = stmts.allOrders.all();
const testOrderInList = orders.find(o => o.id === orderId1);
assert(testOrderInList, 'Test order should be found in allOrders');
assert.strictEqual(testOrderInList.customer_points, 30, 'customer_points should match user points balance');
assert.strictEqual(testOrderInList.customer_total_orders, 1, 'customer_total_orders should match active orders count');
console.log('✅ 5. تم التحقق من صحة استعلام allOrders مع النقاط والتصنيفات');

// تنظيف بيانات الاختبار
db.prepare('DELETE FROM orders WHERE chat_jid = ?').run(testPhone);
db.prepare('DELETE FROM users WHERE phone = ?').run(testPhone);

console.log('\n🎉 جميع اختبارات نظام نقاط الولاء والمشاوير المجانية اجتازت بنجاح 100%!');
