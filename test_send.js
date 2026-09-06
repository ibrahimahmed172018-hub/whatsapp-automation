import { sendWhatsAppMessage } from './whatsappService.js';

const targetPhone = process.env.ADMIN_PHONE || '201023678882';

console.log(`📤 جاري إرسال رسالة تجريبية إلى ${targetPhone}...`);
try {
  const res = await sendWhatsAppMessage(
    targetPhone,
    'أهلاً بك يا فندم في خدمة دليفري طنطا 🛵💨\nتم ربط WhatsApp Cloud API بنجاح تام وسيرفر Node.js يعمل الآن!'
  );
  console.log('🎉 تم الإرسال بنجاح:', res);
} catch (err) {
  console.error('❌ خطأ:', err.response?.data || err.message);
}
