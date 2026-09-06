import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const ai =
  apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE'
    ? new GoogleGenAI({ apiKey })
    : null;

/**
 * معالج احتياطي ذكي في حال عدم توفر مفتاح API أو حدوث خطأ في الاتصال
 */
function fallbackExtraction(text) {
  const egPhoneMatch = text.match(/(?:(?:\+|00)?20|0)?(1[0125]\d{8})\b/);
  return {
    place_or_item: text,
    location: 'طنطا (حسب العنوان المذكور في رسالتك)',
    notes: 'لا يوجد',
    customer_phone: egPhoneMatch ? (egPhoneMatch[1].startsWith('1') ? '0' + egPhoneMatch[1] : egPhoneMatch[1]) : 'لا يوجد'
  };
}

/**
 * 1. إرسال تفاصيل العميل بالعامية للـ LLM واستخراج JSON دقيق
 */
export async function parseOrderWithGemini(category, customerText, phone) {
  if (!ai) {
    console.log('ℹ️ لم يتم العثور على GEMINI_API_KEY، سيتم استخدام الاستخراج التلقائي الاحتياطي.');
    return fallbackExtraction(customerText);
  }

  try {
    const prompt = `
أنت مساعد ذكي مخصص لخدمة دليفري وتوصيل في مدينة طنطا بمصر.
القسم المختار من العميل: "${category}".
رسالة العميل بالعامية المصرية:
"""
${customerText}
"""

المطلوب بدقة:
حلل كلام العميل بالعامية المصرية واستخرج تفاصيل الطلب بتنسيق JSON حصراً:
1. place_or_item: اسم المكان أو المحل أو المطعم أو الأصناف المطلوبة.
2. location: اللوكيشن أو أماكن الاستلام والتسليم المذكورة في طنطا (مثل شارع البحر، الاستاد، سعيد، المحطة، النحاس...).
3. notes: أي ملاحظات خاصة (توابل، مواعيد، أحجام، إلخ)، وإن لم يوجد اكتب "لا يوجد".
4. customer_phone: أي رقم هاتف محمول كتبه العميل في رسالته للتواصل (مثل 010... أو 011... أو 012... أو 015...)، وإن لم يذكر رقماً اكتب "لا يوجد".
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            place_or_item: {
              type: Type.STRING,
              description: 'اسم المكان/الصنف/الطلبات'
            },
            location: {
              type: Type.STRING,
              description: 'اللوكيشن أو العنوان في طنطا'
            },
            notes: {
              type: Type.STRING,
              description: 'أي ملاحظات إضافية'
            },
            customer_phone: {
              type: Type.STRING,
              description: 'رقم هاتف إضافي ذكره العميل في رسالته للتواصل إن وجد'
            }
          },
          required: ['place_or_item', 'location']
        }
      }
    });

    const parsed = JSON.parse(response.text.trim());
    return {
      place_or_item: parsed.place_or_item || customerText,
      location: parsed.location || 'طنطا',
      notes: parsed.notes || 'لا يوجد',
      customer_phone: parsed.customer_phone || 'لا يوجد'
    };
  } catch (error) {
    console.error('⚠️ تعذر الاتصال بنموذج Gemini:', error?.message || error);
    return fallbackExtraction(customerText);
  }
}

/**
 * 2. صياغة رد ملخص واضح للعميل
 */
export function formatOrderSummaryMessage(category, parsedData, phone) {
  const notesLine =
    parsedData.notes && parsedData.notes !== 'لا يوجد'
      ? `\n- ملاحظات: ${parsedData.notes}`
      : '';

  // تنظيف وتنسيق رقم الهاتف لإظهاره بشكل مصري صحيح وواضح
  const cleanPhone = String(phone || '')
    .replace(/@lid/g, '')
    .replace(/@s\.whatsapp\.net/g, '')
    .replace(/@c\.us/g, '')
    .replace(/[^0-9]/g, '');

  let displayPhone = 'غير محدد';
  if (cleanPhone.startsWith('20') && cleanPhone.length === 12) {
    displayPhone = `0${cleanPhone.slice(2)} (+${cleanPhone})`;
  } else if (cleanPhone.startsWith('01') && cleanPhone.length === 11) {
    displayPhone = `${cleanPhone} (+20${cleanPhone.slice(1)})`;
  } else if (cleanPhone.length > 0) {
    displayPhone = `+${cleanPhone}`;
  }

  const detailsSummary = parsedData.location && parsedData.location !== 'طنطا'
    ? `${parsedData.place_or_item} - اللوكيشن: ${parsedData.location}${notesLine}`
    : `${parsedData.place_or_item}${notesLine}`;

  return `📋 ملخص طلبك يا فندم:
- القسم: ${category}
- التفاصيل: ${detailsSummary}
- رقم الموبايل: ${displayPhone}

تحب نأكد الطلب ونبعت المندوب؟
1. تأكيد الطلب
2. تعديل
(أرسل 1 للتأكيد أو 2 للتعديل)`;
}

export default { parseOrderWithGemini, formatOrderSummaryMessage };
