FROM node:20-slim
ENV TZ=Africa/Cairo
ENV DEBIAN_FRONTEND=noninteractive
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Layer 1: OS Dependencies & Chromium (cached permanently)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata chromium python3 make g++ sqlite3 \
    && ln -fs /usr/share/zoneinfo/Africa/Cairo /etc/localtime \
    && dpkg-reconfigure -f noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 2: Cached npm dependencies
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --prefer-offline --no-audit

# Layer 3: Application source code
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
