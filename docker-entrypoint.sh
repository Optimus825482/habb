#!/bin/bash
# AI Haber Takip - Docker entrypoint
# TTS sunucusu + Node.js ana sunucuyu birlikte başlatır

set -e

# SQLite veritabanı için data klasörü
mkdir -p /app/data

# TTS sunucusunu arka planda başlat
echo "🔊 Edge TTS sunucusu başlatılıyor (port 3037)..."
python3 /app/tts-server.py 3037 &
TTS_PID=$!

# Ana Node.js sunucusunu başlat
echo "🚀 AI Haber Takip başlatılıyor (port 3036)..."
exec node /app/server.js
