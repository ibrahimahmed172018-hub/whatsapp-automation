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

# تشغيل البوت
CMD ["node", "bot.js"]
