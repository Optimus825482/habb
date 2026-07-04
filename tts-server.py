#!/usr/bin/env python3
"""Edge TTS HTTP sunucusu - AI Haber Takip için sesli okuma ve sesli sohbet"""

import asyncio
import json
import sys
import edge_tts
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Türkçe sesler
TURKISH_VOICES = [
    "tr-TR-AhmetNeural",
    "tr-TR-EmelNeural"
]

async def text_to_speech(text, voice="tr-TR-AhmetNeural", output_file="output.mp3"):
    """Metni sese çevir"""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)
    return output_file

async def text_to_speech_chunks(text, voice="tr-TR-AhmetNeural"):
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
        {"id": "tr-TR-AhmetNeural", "name": "Ahmet (Erkek)", "gender": "Male", "locale": "tr-TR"},
        {"id": "tr-TR-EmelNeural", "name": "Emel (Kadın)", "gender": "Female", "locale": "tr-TR"}
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

    def handle_tts(self):
        """Tek seferde metni sese çevir"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length))

        text = body.get('text', '')
        voice = body.get('voice', 'tr-TR-AhmetNeural')

        if not text:
            self.send_json(400, {"error": "text gerekli"})
            return

        try:
            loop = asyncio.new_event_loop()
            output_file = loop.run_until_complete(
                text_to_speech(text, voice, "tts_output.mp3")
            )
            loop.close()

            with open(output_file, 'rb') as f:
                audio_data = f.read()

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
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length))

        text = body.get('text', '')
        voice = body.get('voice', 'tr-TR-AhmetNeural')

        if not text:
            self.send_json(400, {"error": "text gerekli"})
            return

        try:
            loop = asyncio.new_event_loop()
            chunk_files = loop.run_until_complete(
                text_to_speech_chunks(text, voice)
            )
            loop.close()

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
        """MP3 dosyasını sun"""
        try:
            with open(filename, 'rb') as f:
                audio_data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', len(audio_data))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(audio_data)
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
