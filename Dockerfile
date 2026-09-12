FROM node:20-slim

ENV TZ=Africa/Cairo
ENV DEBIAN_FRONTEND=noninteractive
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Layer 1: OS Dependencies & Chromium (cached permanently by Docker)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    chromium \
    fonts-freefont-ttf \
    python3 \
    make \
    g++ \
    sqlite3 \
    && ln -fs /usr/share/zoneinfo/Africa/Cairo /etc/localtime \
    && dpkg-reconfigure -f noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 2: Cached npm dependencies (cached as long as package*.json does not change)
COPY package*.json ./
RUN npm install --omit=dev --no-audit

# Layer 3: Application source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
