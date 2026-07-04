# ===== AI Haber Takip - Dockerfile =====
# Node.js + yt-dlp + edge-tts + Python hepsi tek imajda

FROM node:22-slim

# Python ve yt-dlp için gerekli paketler
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python paketlerini sistem çapında kur (venv sorununu önlemek için --break-system-packages)
COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --break-system-packages -r /tmp/requirements.txt

# yt-dlp'yi pip ile kur (sürekli güncel)
RUN pip3 install --break-system-packages yt-dlp

WORKDIR /app

# Node.js bağımlılıkları
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Uygulama kodları
COPY . .

# Veritabanı için volume mount noktası
VOLUME ["/app/data"]

EXPOSE 3036 3037

# Başlangıç betiği
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
