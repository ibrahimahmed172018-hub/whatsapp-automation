import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * دالة مساعدة لإرسال رسائل نصية عبر WhatsApp Cloud API الرسمية
 * @param {string} to - رقم هاتف المستلم بصيغته الدولية بدون علامة + (مثال: 201012345678)
 * @param {string} text - نص الرسالة المطلوب إرسالها
 * @returns {Promise<Object>} - نتيجة استجابة Meta Graph API
 */
export async function sendWhatsAppMessage(to, text) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  if (!token || !phoneNumberId) {
    console.error('❌ خطأ: لم يتم ضبط META_ACCESS_TOKEN أو META_PHONE_NUMBER_ID في ملف .env');
    throw new Error('Missing Meta API credentials in environment variables');
  }

  // تنظيف رقم الهاتف والتأكد من إزالة أي مسافات أو رموز زائد
  const cleanTo = String(to).replace(/[^0-9]/g, '');

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'text',
    text: {
      preview_url: false,
      body: text
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ تم إرسال رسالة واتساب بنجاح إلى: ${cleanTo} (Message ID: ${response.data?.messages?.[0]?.id})`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response?.data?.error || error.message;
    console.error('❌ فشل إرسال رسالة الواتساب:', JSON.stringify(errorDetails, null, 2));
    throw error;
  }
}

/**
 * دالة مساعدة لإرسال قوائم تفاعلية (Interactive List Messages) عبر WhatsApp Cloud API الرسمية
 * @param {string} to - رقم هاتف المستلم (مثال: 201012345678)
 * @param {Object} options - إعدادات القائمة (headerText, bodyText, footerText, buttonText, sections)
 * @returns {Promise<Object>} - نتيجة استجابة Meta Graph API
 */
export async function sendWhatsAppListMessage(to, options = {}) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  if (!token || !phoneNumberId) {
    console.error('❌ خطأ: لم يتم ضبط META_ACCESS_TOKEN أو META_PHONE_NUMBER_ID في ملف .env');
    throw new Error('Missing Meta API credentials in environment variables');
  }

  const cleanTo = String(to).replace(/[^0-9]/g, '');
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const {
    headerText = '🛵 دليفري طنطا',
    bodyText = 'اختر الخدمة المطلوبة من القائمة:',
    footerText = '',
    buttonText = 'عرض الخدمات 📋',
    sections = []
  } = options;

  const interactive = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: String(buttonText || 'عرض الخدمات').slice(0, 20),
      sections
    }
  };

  if (headerText) {
    interactive.header = {
      type: 'text',
      text: String(headerText).slice(0, 60)
    };
  }

  if (footerText) {
    interactive.footer = {
      text: String(footerText).slice(0, 60)
    };
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'interactive',
    interactive
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ تم إرسال القائمة التفاعلية بنجاح إلى: ${cleanTo} (Message ID: ${response.data?.messages?.[0]?.id})`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response?.data?.error || error.message;
    console.error('❌ فشل إرسال القائمة التفاعلية عبر واتساب:', JSON.stringify(errorDetails, null, 2));
    throw error;
  }
}

export default {
  sendWhatsAppMessage,
  sendWhatsAppListMessage
};

