# استخدام أحدث إصدار مدعوم من Node.js LTS
FROM node:20-alpine

# تعيين بيئة الإنتاج
ENV NODE_ENV=production

# تثبيت أدوات البناء الأساسية المطلوبة لحزم C++ مثل sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# نسخ ملفات التبعيات وتثبيتها
COPY package*.json ./
RUN npm ci --omit=dev

# نسخ باقي ملفات المشروع
COPY . .

# إنشاء مجلد الجلسة ومجلد الملفات بالصلاحيات المناسبة
RUN mkdir -p auth_info uploads

# كشف المنفذ
EXPOSE 3000

# تشغيل البوت
CMD ["node", "index.js"]
