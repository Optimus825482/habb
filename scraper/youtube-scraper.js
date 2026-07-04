// ===== YouTube Scraper - yt-dlp ile Video Özeti + Transcript Çıkarma =====

import { execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { youtubeSources, getYoutubeRssUrl } from './sources.js';
import RssParser from 'rss-parser';
import { summarizeVideoTranscript } from '../llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rssParser = new RssParser({ timeout: 10000 });

// yt-dlp binary yolu (bazı ortamlarda tam yol gerekebilir)
const YT_DLP = 'yt-dlp';

// RSS ile önce video ID'lerini ve başlıklarını çek
async function getYoutubeVideosFromRss(source) {
  const items = [];
  try {
    const rssUrl = getYoutubeRssUrl(source.channelId);
    const feed = await rssParser.parseURL(rssUrl);

    for (const item of (feed.items || []).slice(0, 8)) {
      const title = item.title?.trim();
      const link = item.link;
      if (!title || !link) continue;

      const videoId = extractVideoId(link);
      if (!videoId) continue;

      let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      let summary = '';
      if (item['media:group']?.['media:description']?.[0]) {
        summary = item['media:group']['media:description'][0];
      }

      items.push({
        title,
        summary,
        source_url: link,
        source_name: source.name,
        category: source.category,
        content_type: 'video',
        thumbnail,
        published_at: item.pubDate || item.isoDate || new Date().toISOString(),
        video_id: videoId,
        video_links: null
      });
    }
  } catch (err) {
    console.error(`[YouTube RSS] Hata - ${source.name}: ${err.message}`);
  }
  return items;
}

// ===== TRANSCRIPT İŞLEMLERİ =====

// yt-dlp ile auto-subtitle SRT indir
function downloadTranscript(videoId) {
  const outTmpl = path.join(__dirname, `transcript_${videoId}`);
  const srtPath = `${outTmpl}.en.srt`;
  const trSrtPath = `${outTmpl}.tr.srt`;

  try {
    execSync(
      `${YT_DLP} --write-auto-subs --sub-langs "tr,en" --skip-download --convert-subs srt -o "${outTmpl}" "https://www.youtube.com/watch?v=${videoId}"`,
      { encoding: 'utf-8', timeout: 45000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (existsSync(trSrtPath)) return { path: trSrtPath, lang: 'tr' };
    if (existsSync(srtPath)) return { path: srtPath, lang: 'en' };
    return null;
  } catch (err) {
    return null;
  }
}

// SRT dosyasından saf metin çıkar (timestamp + index satırlarını temizle)
function parseSrtFile(srtPath) {
  try {
    const raw = readFileSync(srtPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const textLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}$/.test(trimmed.replace(/\s*$/, ''))) continue;
      if (/<\/?[a-zA-Z][^>]*>/.test(trimmed)) {
        textLines.push(trimmed.replace(/<[^>]+>/g, ''));
        continue;
      }
      textLines.push(trimmed);
    }

    return textLines.join(' ').replace(/\s+/g, ' ').trim();
  } catch (err) {
    return null;
  }
}

// Geçici SRT dosyasını sil
function cleanupTranscript(srtPath) {
  try {
    if (existsSync(srtPath)) unlinkSync(srtPath);
  } catch (_) {}
}

// Transcript içindeki tüm URL'leri ayıkla
function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"'\])}]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map(u => u.replace(/[.,;:!?)]+$/, '')))];
}

// Transcript metnini LLM'e uygun boyuta kısalt (ilk ~4000 karakter)
function truncateForLLM(text, maxChars = 4000) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  return lastPeriod > maxChars * 0.7 ? truncated.substring(0, lastPeriod + 1) : truncated;
}

// ===== ANA İŞLEV: Transcript indir + LLM özet =====

export async function processVideoTranscript(item, llmConfig = null) {
  const videoId = item.video_id;
  if (!videoId) return item;

  console.log(`[Transcript] İndiriliyor: ${item.title.substring(0, 50)}...`);
  const transcript = downloadTranscript(videoId);

  if (transcript) {
    const text = parseSrtFile(transcript.path);
    cleanupTranscript(transcript.path);

    if (text && text.length > 50) {
      const urls = extractUrls(text);
      const truncated = truncateForLLM(text);

      if (llmConfig && llmConfig.apiKey && llmConfig.modelId) {
        try {
          console.log(`[Transcript] LLM özetleniyor (${transcript.lang})...`);
          const result = await summarizeVideoTranscript(
            truncated, item.title, llmConfig.apiKey, llmConfig.modelId, llmConfig.provider
          );
          item.summary = result.summary || item.summary;
          item.video_links = result.links?.length > 0 ? result.links.join('\n') : (urls.length > 0 ? urls.join('\n') : null);
          if (result.keywords) item.summary += `\n\nAnahtar kelimeler: ${result.keywords}`;
        } catch (err) {
          console.error(`[Transcript] LLM özet hatası: ${err.message}`);
          // Fallback: URL'leri kendi bulduklarımızdan al
          if (urls.length > 0) item.video_links = urls.join('\n');
          item.summary = `[${transcript.lang === 'tr' ? 'Türkçe' : 'İngilizce'} transcript mevcut, LLM özeti başarısız] ${item.summary || ''}`;
        }
      } else {
        // LLM yapılandırılmamış — URL'leri yine de çıkar
        if (urls.length > 0) item.video_links = urls.join('\n');
        item.summary = `[Transcript (${transcript.lang}): ${truncated.substring(0, 300)}...]`;
        console.log(`[Transcript] LLM ayarlanmadı — ham transcript kaydedildi`);
      }
    }
  } else {
    // Fallback: description kullan
    console.log(`[Transcript] Altyazı yok, description kullanılıyor: ${item.title.substring(0, 40)}`);
    const details = fetchVideoDetails(videoId);
    if (details && details.description) {
      item.summary = details.description;
    }
  }

  return item;
}

// yt-dlp ile videonun detaylı bilgisini çek (başlık + açıklama + etiketler)
function fetchVideoDetails(videoId) {
  try {
    const cmd = `${YT_DLP} -j "https://www.youtube.com/watch?v=${videoId}"`;
    const jsonStr = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (!jsonStr) return null;
    const data = JSON.parse(jsonStr);
    return {
      title: data.title || '',
      description: (data.description || '').substring(0, 1500),
      duration: data.duration || 0,
      viewCount: data.view_count || 0,
      tags: (data.tags || []).slice(0, 10).join(', '),
      uploadDate: data.upload_date || '',
      channelName: data.channel || data.uploader || ''
    };
  } catch (err) {
    return null;
  }
}

function extractVideoId(link) {
  if (!link) return null;
  const match = link.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// ===== ANA TARAMA =====

export async function scrapeAllYoutube(llmConfig = null) {
  console.log('[YouTube Scraper] YouTube taraması başlatılıyor (transcript + LLM destekli)...');
  const allItems = [];

  for (const source of youtubeSources) {
    try {
      console.log(`[YouTube Scraper] RSS okunuyor: ${source.name}`);
      const items = await getYoutubeVideosFromRss(source);

      for (const item of items) {
        item.video_id = item.video_id || extractVideoId(item.source_url);
        await processVideoTranscript(item, llmConfig);
        await new Promise(r => setTimeout(r, 800));
      }

      allItems.push(...items);
      console.log(`[YouTube Scraper] ${source.name}: ${items.length} video`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[YouTube Scraper] ${source.name} hatası: ${err.message}`);
    }
  }

  console.log(`[YouTube Scraper] Toplam ${allItems.length} YouTube videosu toplandı`);
  return allItems;
}
