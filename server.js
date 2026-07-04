import express from 'express';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dbFunctions } from './db.js';
import { scrapeAllWeb } from './scraper/web-scraper.js';
import { scrapeAllYoutube } from './scraper/youtube-scraper.js';
import { fetchModels, translateAllUntranslated, validateApiKey, chat, getProviders, searchWeb } from './llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3036;

// Provider'a göre key/model setting adlarını döndür
function getProviderCreds(provider) {
  const map = {
    openrouter: { key: 'llm_api_key', model: 'llm_model' },
    opencode: { key: 'opencode_api_key', model: 'opencode_model' },
    kilogateway: { key: 'kilogateway_api_key', model: 'kilogateway_model' }
  };
  const p = map[provider] || map.openrouter;
  return {
    apiKey: dbFunctions.getSetting(p.key),
    modelId: dbFunctions.getSetting(p.model)
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== HABER API =====

app.get('/api/news', (req, res) => {
  try {
    const { category, content_type, limit = 50, offset = 0, featured } = req.query;
    const news = dbFunctions.getNews({
      category, contentType: content_type,
      limit: parseInt(limit), offset: parseInt(offset),
      featured: featured === 'true' ? true : featured === 'false' ? false : undefined
    });
    res.json({ success: true, data: news, total: news.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/news/:id', (req, res) => {
  try {
    const news = dbFunctions.getNewsById(parseInt(req.params.id));
    if (!news) return res.status(404).json({ success: false, error: 'Haber bulunamadı' });
    res.json({ success: true, data: news });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/news/:id/read', (req, res) => {
  try { dbFunctions.markAsRead(parseInt(req.params.id)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/news/:id/featured', (req, res) => {
  try { dbFunctions.toggleFeatured(parseInt(req.params.id)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== TARAMA =====

async function runScrape() {
  const startedAt = new Date().toISOString();
  let totalNew = 0, sourcesScraped = 0;

  // LLM config oluştur (video transcript özetleme için)
  const active = dbFunctions.getSetting('active_provider') || 'openrouter';
  const llmConfig = llmGetConfig(active);

  const webItems = await scrapeAllWeb();
  totalNew += dbFunctions.insertManyNews(webItems);
  sourcesScraped += webItems.length > 0 ? 1 : 0;
  const ytItems = await scrapeAllYoutube(llmConfig);
  totalNew += dbFunctions.insertManyNews(ytItems);
  sourcesScraped += ytItems.length > 0 ? 1 : 0;
  dbFunctions.insertScrapeLog({ started_at: startedAt, finished_at: new Date().toISOString(), sources_scraped: sourcesScraped, new_items: totalNew, status: 'success' });
  return { webItems: webItems.length, ytItems: ytItems.length, newItems: totalNew };
}

function llmGetConfig(provider) {
  const providers = {
    openrouter: { keySetting: 'llm_api_key', modelSetting: 'llm_model' },
    opencode: { keySetting: 'opencode_api_key', modelSetting: 'opencode_model' },
    kilogateway: { keySetting: 'kilogateway_api_key', modelSetting: 'kilogateway_model' }
  };
  const p = providers[provider];
  if (!p) return null;

  const apiKey = dbFunctions.getSetting(p.keySetting);
  const modelId = dbFunctions.getSetting(p.modelSetting);
  return apiKey && modelId ? { apiKey, modelId, provider } : null;
}

app.post('/api/scrape', async (req, res) => {
  try {
    const result = await runScrape();
    res.json({ success: true, message: `Tarama tamamlandı. ${result.newItems} yeni haber eklendi.`, data: result });
  } catch (err) {
    dbFunctions.insertScrapeLog({ started_at: new Date().toISOString(), finished_at: new Date().toISOString(), sources_scraped: 0, new_items: 0, status: 'error: ' + err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== AYARLAR =====

app.get('/api/settings', (req, res) => {
  try {
    const settings = dbFunctions.getAllSettings();
    if (settings.llm_api_key) settings.llm_api_key_masked = settings.llm_api_key.substring(0, 4) + '****' + settings.llm_api_key.slice(-4);
    if (settings.opencode_api_key) settings.opencode_api_key_masked = settings.opencode_api_key.substring(0, 4) + '****' + settings.opencode_api_key.slice(-4);
    if (settings.kilogateway_api_key) settings.kilogateway_api_key_masked = settings.kilogateway_api_key.substring(0, 4) + '****' + settings.kilogateway_api_key.slice(-4);
    if (settings.exa_api_key) settings.exa_api_key_masked = settings.exa_api_key.substring(0, 4) + '****' + settings.exa_api_key.slice(-4);
    res.json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/settings', (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      dbFunctions.setSetting(key, value);
    }
    res.json({ success: true, message: 'Ayarlar kaydedildi' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/settings/:key', (req, res) => {
  try { dbFunctions.setSetting(req.params.key, req.body.value); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== LLM API =====

app.get('/api/llm/providers', (req, res) => {
  res.json({ success: true, data: getProviders() });
});

app.post('/api/llm/models', async (req, res) => {
  try {
    const { provider = 'openrouter', api_key } = req.body;
    if (api_key) {
      // Geçici key ile model listesi çek
      const models = await (async () => {
        const fetch = (await import('node-fetch')).default;
        const modelsUrls = {
          opencode: 'https://opencode.ai/zen/v1/models',
          kilogateway: 'https://api.kilo.ai/api/gateway/models',
          openrouter: 'https://openrouter.ai/api/v1/models'
        };
        const modelsUrl = modelsUrls[provider] || modelsUrls.openrouter;
        const res = await fetch(modelsUrl, { headers: { 'Authorization': `Bearer ${api_key}` } });
        if (!res.ok) throw new Error(`API hatası: ${res.status}`);
        const data = await res.json();
        const models = data.data || data.models || [];
        if (provider === 'opencode') {
          return models.map(m => ({ id: m.id, name: m.name || m.id, description: m.description || '', contextLength: m.context_length || 4096, free: m.id.toLowerCase().includes('free') || m.pricing?.prompt === '0' }));
        }
        if (provider === 'kilogateway') {
          const isFreeModel = (m) => {
            if (m.isFree === true) return true;
            const p = m.pricing || {};
            const prompt = parseFloat(p.prompt ?? '1');
            const completion = parseFloat(p.completion ?? '1');
            return prompt === 0 && completion === 0;
          };
          let freeModels = models.filter(isFreeModel).map(m => ({ id: m.id, name: m.name || m.id, description: `${m.description || ''} | ${m.context_length || m.top_provider?.context_length || ''} ctx`, contextLength: m.context_length || m.top_provider?.context_length || 4096, free: true }));
          if (freeModels.length === 0) {
            freeModels = models.map(m => ({ id: m.id, name: m.name || m.id, description: `${m.description || ''} | ${m.context_length || m.top_provider?.context_length || ''} ctx`, contextLength: m.context_length || m.top_provider?.context_length || 4096, free: false }));
          }
          return freeModels;
        }
        return models.filter(m => parseFloat(m.pricing?.prompt || '1') === 0).map(m => ({ id: m.id, name: m.name, description: m.description?.substring(0, 100) || '', contextLength: m.context_length, free: true }));
      })();
      return res.json({ success: true, data: models });
    }
    const models = await fetchModels(provider);
    res.json({ success: true, data: models });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/llm/validate', async (req, res) => {
  try {
    const { api_key, provider = 'openrouter' } = req.body;
    const valid = await validateApiKey(api_key, provider);
    res.json({ success: true, valid });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Exa API Key doğrulama
app.post('/api/exa/validate', async (req, res) => {
  try {
    const { api_key } = req.body;
    if (!api_key) return res.status(400).json({ success: false, error: 'API Key gerekli' });
    const results = await searchWeb('test', api_key, 1);
    res.json({ success: true, valid: true, resultCount: results.length });
  } catch (err) { res.json({ success: true, valid: false, error: err.message }); }
});

app.post('/api/llm/translate', async (req, res) => {
  try {
    const provider = dbFunctions.getSetting('active_provider') || 'openrouter';
    const creds = getProviderCreds(provider);
    if (!creds.apiKey) return res.status(400).json({ success: false, error: 'API Key girilmedi' });
    if (!creds.modelId) return res.status(400).json({ success: false, error: 'Model seçilmedi' });
    const { batch_size = 5 } = req.body || {};
    const result = await translateAllUntranslated(creds.apiKey, creds.modelId, provider, batch_size);
    res.json({ success: true, message: `${result.translated} haber çevirildi.`, data: result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== SOHBET =====

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Mesaj gerekli' });
    const provider = dbFunctions.getSetting('active_provider') || 'openrouter';
    const creds = getProviderCreds(provider);
    if (!creds.apiKey || !creds.modelId) return res.status(400).json({ success: false, error: 'API Key ve model seçilmeli' });
    const exaApiKey = dbFunctions.getSetting('exa_api_key');
    const reply = await chat(message, creds.apiKey, creds.modelId, provider, exaApiKey);
    res.json({ success: true, reply });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/chat/history', (req, res) => {
  try { res.json({ success: true, data: dbFunctions.getChatHistory(parseInt(req.query.limit) || 20) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/chat/history', (req, res) => {
  try { dbFunctions.clearChatHistory(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== HAFIZA =====

app.get('/api/knowledge', (req, res) => {
  try { res.json({ success: true, data: dbFunctions.getAllKnowledge(parseInt(req.query.limit) || 50) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== TTS (Edge TTS proxy) =====

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'tr-TR-AhmetNeural' } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Metin gerekli' });
    const { execSync } = await import('child_process');
    const fs = await import('fs');
    const tmpFile = `tts_${Date.now()}.mp3`;
    const script = `import asyncio, edge_tts\nasync def main():\n    c = edge_tts.Communicate("""${text.replace(/"/g, '\\"').replace(/`/g, '\\`')}""", "${voice}")\n    await c.save("${tmpFile}")\nasyncio.run(main())`;
    const scriptFile = `tts_${Date.now()}.py`;
    fs.writeFileSync(scriptFile, script);
    try {
      // python3 veya python dene
      let pythonCmd = 'python3';
      try { execSync('python3 --version', { stdio: 'pipe' }); } catch { pythonCmd = 'python'; }
      execSync(`${pythonCmd} "${scriptFile}"`, { timeout: 30000, stdio: 'pipe' });
      const audio = fs.readFileSync(tmpFile);
      res.set({ 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': '*' });
      res.send(audio);
    } finally {
      try { fs.unlinkSync(scriptFile); } catch (e) {}
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== İSTATİSTİKLER =====

app.get('/api/stats', (req, res) => {
  try { res.json({ success: true, data: dbFunctions.getStats() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/scrape-logs', (req, res) => {
  try { res.json({ success: true, data: dbFunctions.getScrapeLogs(parseInt(req.query.limit) || 10) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== CRON =====
cron.schedule('0 9,13,17,21 * * *', async () => {
  console.log('[CRON] Otomatik tarama...');
  try {
    const result = await runScrape();
    const provider = dbFunctions.getSetting('active_provider') || 'openrouter';
    const creds = getProviderCreds(provider);
    if (creds.apiKey && creds.modelId) await translateAllUntranslated(creds.apiKey, creds.modelId, provider, 10);
    console.log(`[CRON] Tamamlandı. ${result.newItems} yeni.`);
  } catch (err) { console.error('[CRON] Hata:', err.message); }
});

// ===== SPA Fallback =====
app.get('/{*splat}', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`\n🚀 AI Haber Takip: http://localhost:${PORT}`);
  console.log(`📰 Tarama: 09:00, 13:00, 17:00, 21:00`);
  console.log(`🤖 Providers: OpenRouter + OpenCode Zen`);
  console.log(`💬 Sohbet + 🔊 Sesli okuma destekli\n`);
});
