import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import RssParser from 'rss-parser';
import { webSources } from './sources.js';

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'AI-Haber-Takip/1.0 (PWA Haber Aggregator)'
  }
});

// HTML'den temiz metin çıkar
function stripHtml(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.text().trim().substring(0, 500);
}

// RSS feed'inden haber çek
async function fetchRssFeed(source) {
  const items = [];
  try {
    const feed = await rssParser.parseURL(source.url);

    for (const item of (feed.items || []).slice(0, 15)) {
      const title = item.title?.trim();
      const link = item.link || item.guid;

      if (!title || !link) continue;

      // Özet çıkar
      let summary = '';
      if (item.contentSnippet) {
        summary = item.contentSnippet.substring(0, 300);
      } else if (item.content) {
        summary = stripHtml(item.content).substring(0, 300);
      } else if (item.description) {
        summary = stripHtml(item.description).substring(0, 300);
      }

      // Thumbnail çıkar
      let thumbnail = '';
      if (item.enclosure?.url) {
        thumbnail = item.enclosure.url;
      } else if (item['media:content']?.$?.url) {
        thumbnail = item['media:content'].$.url;
      } else if (item.content) {
        const $ = cheerio.load(item.content);
        const img = $('img').first();
        if (img.length) thumbnail = img.attr('src') || '';
      }

      items.push({
        title,
        summary,
        source_url: link,
        source_name: source.name,
        category: source.category,
        content_type: 'web',
        thumbnail,
        published_at: item.pubDate || item.isoDate || new Date().toISOString()
      });
    }
  } catch (err) {
    console.error(`[Web Scraper] Hata - ${source.name}: ${err.message}`);
  }
  return items;
}

// Tüm web kaynaklarını tara
export async function scrapeAllWeb() {
  console.log('[Web Scraper] Web taraması başlatılıyor...');
  const allItems = [];

  for (const source of webSources) {
    try {
      console.log(`[Web Scraper] Taranıyor: ${source.name}`);
      const items = await fetchRssFeed(source);
      allItems.push(...items);
      console.log(`[Web Scraper] ${source.name}: ${items.length} haber bulundu`);
      // Rate limiting - kaynaklar arası 1 saniye bekle
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Web Scraper] ${source.name} tarama hatası: ${err.message}`);
    }
  }

  console.log(`[Web Scraper] Toplam ${allItems.length} web haberi toplandı`);
  return allItems;
}
