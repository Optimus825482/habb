import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'ai-haber.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tabloları oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT,
    source_url TEXT NOT NULL UNIQUE,
    source_name TEXT,
    category TEXT DEFAULT 'ai',
    content_type TEXT DEFAULT 'web',
    thumbnail TEXT,
    published_at TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    is_read INTEGER DEFAULT 0,
    is_featured INTEGER DEFAULT 0,
    translated INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS scrape_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    sources_scraped INTEGER,
    new_items INTEGER,
    status TEXT
  );

  -- HAFIZA SİSTEMİ: Çevrilen haberlerin özeti
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'news_summary',
    title TEXT NOT NULL,
    content TEXT,
    source_url TEXT,
    source_name TEXT,
    category TEXT,
    keywords TEXT,
    original_title TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- SOHBET GEÇMİŞİ
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
  CREATE INDEX IF NOT EXISTS idx_news_content_type ON news(content_type);
  CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);
  CREATE INDEX IF NOT EXISTS idx_news_is_featured ON news(is_featured);
  CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
  CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge(created_at);
`);

// Eski tabloya yeni kolonlar ekle (eğer yoksa)
try { db.exec("ALTER TABLE news ADD COLUMN translated INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE news ADD COLUMN video_links TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE news ADD COLUMN video_id TEXT"); } catch (e) {}

// CRUD fonksiyonları
export const dbFunctions = {
  // Haber ekle (duplicate kontrolü ile)
  insertNews(item) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO news (title, summary, source_url, source_name, category, content_type, thumbnail, published_at, video_links, video_id)
      VALUES (@title, @summary, @source_url, @source_name, @category, @content_type, @thumbnail, @published_at, @video_links, @video_id)
    `);
    const result = stmt.run(item);
    return result.changes > 0;
  },

  // Toplu haber ekle
  insertManyNews(items) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO news (title, summary, source_url, source_name, category, content_type, thumbnail, published_at, video_links, video_id)
      VALUES (@title, @summary, @source_url, @source_name, @category, @content_type, @thumbnail, @published_at, @video_links, @video_id)
    `);
    const insertMany = db.transaction((items) => {
      let inserted = 0;
      for (const item of items) {
        const result = stmt.run(item);
        if (result.changes > 0) inserted++;
      }
      return inserted;
    });
    return insertMany(items);
  },

  // Haberleri listele (filtre + sayfalama)
  getNews({ category, contentType, limit = 50, offset = 0, featured } = {}) {
    let query = 'SELECT * FROM news WHERE 1=1';
    const params = {};

    if (category && category !== 'all') {
      query += ' AND category = @category';
      params.category = category;
    }
    if (contentType) {
      query += ' AND content_type = @contentType';
      params.contentType = contentType;
    }
    if (featured !== undefined) {
      query += ' AND is_featured = @featured';
      params.featured = featured ? 1 : 0;
    }

    query += ' ORDER BY published_at DESC LIMIT @limit OFFSET @offset';
    params.limit = limit;
    params.offset = offset;

    return db.prepare(query).all(params);
  },

  // Tekil haber
  getNewsById(id) {
    return db.prepare('SELECT * FROM news WHERE id = ?').get(id);
  },

  // Çevrilmemiş haberleri getir
  getUntranslatedNews(limit = 10) {
    return db.prepare(
      "SELECT * FROM news WHERE translated = 0 ORDER BY scraped_at DESC LIMIT ?"
    ).all(limit);
  },

  // Haberi güncelle (çeviri için)
  updateNewsTranslation(id, title, summary) {
    return db.prepare(
      "UPDATE news SET title = ?, summary = ?, translated = 1 WHERE id = ?"
    ).run(title, summary, id);
  },

  // Okundu işaretle
  markAsRead(id) {
    return db.prepare('UPDATE news SET is_read = 1 WHERE id = ?').run(id);
  },

  // Öne çıkar
  toggleFeatured(id) {
    return db.prepare('UPDATE news SET is_featured = CASE WHEN is_featured = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  },

  // Tarama logu ekle
  insertScrapeLog(log) {
    const stmt = db.prepare(`
      INSERT INTO scrape_logs (started_at, finished_at, sources_scraped, new_items, status)
      VALUES (@started_at, @finished_at, @sources_scraped, @new_items, @status)
    `);
    return stmt.run(log);
  },

  // Son tarama logları
  getScrapeLogs(limit = 10) {
    return db.prepare('SELECT * FROM scrape_logs ORDER BY id DESC LIMIT ?').all(limit);
  },

  // İstatistikler
  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM news').get();
    const today = db.prepare("SELECT COUNT(*) as count FROM news WHERE scraped_at >= date('now')").get();
    const byCategory = db.prepare('SELECT category, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC').all();
    const byType = db.prepare('SELECT content_type, COUNT(*) as count FROM news GROUP BY content_type').all();
    const featured = db.prepare('SELECT COUNT(*) as count FROM news WHERE is_featured = 1').get();
    const translated = db.prepare('SELECT COUNT(*) as count FROM news WHERE translated = 1').get();
    const untranslated = db.prepare('SELECT COUNT(*) as count FROM news WHERE translated = 0').get();
    const lastScrape = db.prepare('SELECT * FROM scrape_logs ORDER BY id DESC LIMIT 1').get();

    return {
      total: total.count,
      today: today.count,
      byCategory,
      byType,
      featured: featured.count,
      translated: translated.count,
      untranslated: untranslated.count,
      lastScrape
    };
  },

  // ===== AYARLAR =====
  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
  },

  // ===== HAFIZA SİSTEMİ =====
  addKnowledge(item) {
    const stmt = db.prepare(`
      INSERT INTO knowledge (type, title, content, source_url, source_name, category, keywords, original_title)
      VALUES (@type, @title, @content, @source_url, @source_name, @category, @keywords, @original_title)
    `);
    return stmt.run(item);
  },

  searchKnowledge(query, limit = 10) {
    // Basit anahtar kelime araması
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return [];

    const conditions = words.map(() =>
      "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ? OR LOWER(category) LIKE ?)"
    ).join(' OR ');

    const params = [];
    for (const word of words) {
      const like = `%${word}%`;
      params.push(like, like, like, like);
    }
    params.push(limit);

    return db.prepare(
      `SELECT * FROM knowledge WHERE ${conditions} ORDER BY created_at DESC LIMIT ?`
    ).all(...params);
  },

  getTodayKnowledge(limit = 20) {
    return db.prepare(
      "SELECT * FROM knowledge WHERE date(created_at) = date('now') ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  },

  getAllKnowledge(limit = 50) {
    return db.prepare(
      'SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  },

  getKnowledgeCount() {
    return db.prepare('SELECT COUNT(*) as count FROM knowledge').get().count;
  },

  // ===== SOHBET =====
  addChatMessage(role, content) {
    return db.prepare(
      'INSERT INTO chat_messages (role, content) VALUES (?, ?)'
    ).run(role, content);
  },

  getChatHistory(limit = 20) {
    return db.prepare(
      'SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?'
    ).all(limit).reverse();
  },

  clearChatHistory() {
    return db.prepare('DELETE FROM chat_messages').run();
  },

  // Toplam haber sayısı
  getCount() {
    return db.prepare('SELECT COUNT(*) as count FROM news').get().count;
  }
};

export default db;
