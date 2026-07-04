// PWA İkonları oluştur (Canvas ile PNG)
// Bu script'i çalıştırarak ikonları oluşturun: node generate-icons.js

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Basit PNG oluşturucu (canvas gerektirmez)
function createSimplePNG(size) {
  // SVG'yi PNG olarak kullanmak için base64 encode
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6c5ce7"/>
      <stop offset="100%" style="stop-color:#00cec9"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#bg)"/>
  <text x="${size/2}" y="${size * 0.58}" font-size="${size * 0.45}" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold">AI</text>
  <circle cx="${size * 0.8}" cy="${size * 0.2}" r="${size * 0.06}" fill="#00cec9" opacity="0.8"/>
</svg>`;

  return svg;
}

// SVG dosyalarını oluştur
const sizes = [192, 512];
const iconsDir = path.join(__dirname, 'public', 'icons');

for (const size of sizes) {
  const svg = createSimplePNG(size);
  const filePath = path.join(iconsDir, `icon-${size}.svg`);
  writeFileSync(filePath, svg);
  console.log(`✓ icon-${size}.svg oluşturuldu`);

  // Manifest'i SVG referanslı PNG olarak ayarla
  // (Tarayıcılar SVG'yi destekler, fallback olarak)
  writeFileSync(path.join(iconsDir, `icon-${size}.png`), svg);
  console.log(`✓ icon-${size}.png (SVG fallback) oluşturuldu`);
}

console.log('\n🎉 İkonlar oluşturuldu!');
console.log('Not: Üretim ortamı için gerçek PNG ikonları oluşturmak için');
console.log('Sharp veya canvas kütüphanesi kullanabilirsiniz.');
