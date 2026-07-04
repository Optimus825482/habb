#!/usr/bin/env python3
"""Edge TTS HTTP sunucusu - AI Haber Takip için sesli okuma ve sesli sohbet"""

import asyncio
import json
import sys
import os
import edge_tts
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Türkçe sesler
TURKISH_VOICES = [
    "tr-TR-EmelNeural",
    "tr-TR-AhmetNeural"
]

# Ortak event loop
_loop = asyncio.new_event_loop()

async def text_to_speech(text, voice="tr-TR-EmelNeural", output_file="output.mp3"):
    """Metni sese çevir - SSML ile hız ve pitch ayarı"""
    # Metni temizle
    clean = ' '.join(text.split())
    # SSML: %25 hızlı, +10Hz pitch (hafif robotik)
    ssml = f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR">
      <voice name="{voice}">
        <prosody rate="+25%" pitch="+10Hz">
          {clean.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}
        </prosody>
      </voice>
    </speak>'''
    communicate = edge_tts.Communicate(ssml, voice)
    await communicate.save(output_file)
    return output_file

async def text_to_speech_chunks(text, voice="tr-TR-EmelNeural"):
    """Metni chunk'lara bölerek sese çevir (profesyonel okuma için)"""
    # Uzun metni cümlelere böl
    sentences = []
    parts = text.replace('. ', '.|').replace('? ', '?|').replace('! ', '!|').split('|')
    for part in parts:
        part = part.strip()
        if part:
            sentences.append(part)

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        if len(current_chunk) + len(sentence) > 300:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = sentence
        else:
            current_chunk += (" " if current_chunk else "") + sentence

    if current_chunk:
        chunks.append(current_chunk)

    # Her chunk'ı ayrı ayrı MP3'e çevir
    results = []
    for i, chunk in enumerate(chunks):
        filename = f"tts_chunk_{i}.mp3"
        communicate = edge_tts.Communicate(chunk, voice)
        await communicate.save(filename)
        results.append(filename)

    return results

def get_available_voices():
    """Mevcut Türkçe sesleri listele"""
    return [
        {"id": "tr-TR-EmelNeural", "name": "Emel (Kadın)", "gender": "Female", "locale": "tr-TR"},
        {"id": "tr-TR-AhmetNeural", "name": "Ahmet (Erkek)", "gender": "Male", "locale": "tr-TR"}
    ]


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/tts':
            self.handle_tts()
        elif parsed.path == '/tts/chunks':
            self.handle_tts_chunks()
        elif parsed.path == '/tts/voices':
            self.handle_voices()
        else:
            self.send_error(404)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/tts/voices':
            self.handle_voices()
        elif parsed.path.startswith('/tts/audio/'):
            # Chunk dosyasını sun
            filename = parsed.path.split('/')[-1]
            self.serve_audio(filename)
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        """CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def handle_tts(self):
        """Tek seferde metni sese çevir"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json(400, {"error": "body gerekli"})
                return
            raw = self.rfile.read(content_length)
            body = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            self.send_json(400, {"error": f"Geçersiz JSON: {e}"})
            return

        text = body.get('text', '')
        voice = body.get('voice', 'tr-TR-EmelNeural')

        if not text:
            self.send_json(400, {"error": "text gerekli"})
            return

        # Voice doğrulama
        if voice not in TURKISH_VOICES:
            voice = 'tr-TR-EmelNeural'

        try:
            tmp_file = f"tts_output_{os.getpid()}.mp3"
            _loop.run_until_complete(
                text_to_speech(text, voice, tmp_file)
            )

            with open(tmp_file, 'rb') as f:
                audio_data = f.read()

            try:
                os.unlink(tmp_file)
            except OSError:
                pass

            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', len(audio_data))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(audio_data)

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_tts_chunks(self):
        """Metni chunk'lara bölerek çevir"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json(400, {"error": "body gerekli"})
                return
            raw = self.rfile.read(content_length)
            body = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            self.send_json(400, {"error": f"Geçersiz JSON: {e}"})
            return

        text = body.get('text', '')
        voice = body.get('voice', 'tr-TR-EmelNeural')

        if not text:
            self.send_json(400, {"error": "text gerekli"})
            return

        if voice not in TURKISH_VOICES:
            voice = 'tr-TR-EmelNeural'

        try:
            chunk_files = _loop.run_until_complete(
                text_to_speech_chunks(text, voice)
            )

            self.send_json(200, {
                "chunks": [f"/tts/audio/{f}" for f in chunk_files],
                "count": len(chunk_files)
            })

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_voices(self):
        """Mevcut sesleri listele"""
        voices = get_available_voices()
        self.send_json(200, {"voices": voices})

    def serve_audio(self, filename):
        """MP3 dosyasını sun ve temizle"""
        try:
            # Sadece tts_chunk_ dosyalarını sun (path traversal engeli)
            if not filename.startswith('tts_chunk_') and not filename.startswith('tts_output_'):
                self.send_error(403)
                return
            with open(filename, 'rb') as f:
                audio_data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', len(audio_data))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(audio_data)
            # Chunk dosyasını temizle
            try:
                os.unlink(filename)
            except OSError:
                pass
        except FileNotFoundError:
            self.send_error(404)

    def send_json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def log_message(self, format, *args):
        # Sadece hata loglarını göster
        if '404' in str(args) or '500' in str(args):
            super().log_message(format, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3037
    server = HTTPServer(('0.0.0.0', port), TTSHandler)
    print(f"🔊 Edge TTS sunucusu çalışıyor: http://localhost:{port}")
    server.serve_forever()
