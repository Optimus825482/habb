// ===== LLM Servisi - OpenRouter + OpenCode Zen + KiloGateway + Hafıza Sistemi =====

import fetch from 'node-fetch';
import { dbFunctions } from './db.js';

// Provider'lar
const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    keySetting: 'llm_api_key',
    modelSetting: 'llm_model',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    extraHeaders: { 'HTTP-Referer': 'http://localhost:3036', 'X-Title': 'AI Haber Takip' }
  },
  opencode: {
    name: 'OpenCode Zen',
    apiBase: 'https://opencode.ai/zen/v1',
    modelsUrl: 'https://opencode.ai/zen/v1/models',
    chatUrl: 'https://opencode.ai/zen/v1/chat/completions',
    keySetting: 'opencode_api_key',
    modelSetting: 'opencode_model',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    extraHeaders: {}
  },
  kilogateway: {
    name: 'KiloGateway',
    apiBase: 'https://api.kilo.ai/api/gateway',
    modelsUrl: 'https://api.kilo.ai/api/gateway/models',
    chatUrl: 'https://api.kilo.ai/api/gateway/chat/completions',
    keySetting: 'kilogateway_api_key',
    modelSetting: 'kilogateway_model',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    extraHeaders: {}
  }
};

// Aktif provider'ı al
function getActiveProvider() {
  const active = dbFunctions.getSetting('active_provider') || 'openrouter';
  return PROVIDERS[active] || PROVIDERS.openrouter;
}

// Provider'a ait API key ve model'i al
function getProviderCredentials(provider) {
  return {
    apiKey: dbFunctions.getSetting(provider.keySetting),
    modelId: dbFunctions.getSetting(provider.modelSetting)
  };
}

// ===== MODEL LİSTELEME =====

export async function fetchModels(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error('Bilinmeyen provider');

  // API key'i ilgili provider'dan al
  const { apiKey } = getProviderCredentials(provider);
  if (!apiKey) throw new Error(`${provider.name} API Key girilmedi`);

  try {
    const res = await fetch(provider.modelsUrl, {
      headers: {
        [provider.headerKey]: `${provider.headerPrefix}${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`API hatası: ${res.status}`);
    const data = await res.json();
    const models = data.data || data.models || [];

    if (providerName === 'opencode') {
      // OpenCode Zen - tüm modelleri listele (ücretsiz olanları işaretle)
      return models.map(m => ({
        id: m.id,
        name: m.name || m.id,
        description: m.description || '',
        contextLength: m.context_length || m.max_tokens || 4096,
        free: m.id.toLowerCase().includes('free') ||
              m.pricing?.prompt === '0' ||
              m.pricing?.completion === '0'
      }));
    }

    if (providerName === 'kilogateway') {
      // KiloGateway - isFree field'ı var, pricing.prompt/completion string olarak geliyor
      const isFreeModel = (m) => {
        if (m.isFree === true) return true;
        const p = m.pricing || {};
        const prompt = parseFloat(p.prompt ?? '1');
        const completion = parseFloat(p.completion ?? '1');
        return prompt === 0 && completion === 0;
      };

      let freeModels = models.filter(isFreeModel).map(m => ({
        id: m.id,
        name: m.name || m.id,
        description: `${m.description || ''} | ${m.context_length || m.top_provider?.context_length || ''} ctx`,
        contextLength: m.context_length || m.top_provider?.context_length || 4096,
        free: true
      }));

      // Ücretsiz model bulunamazsa tüm modelleri döndür
      if (freeModels.length === 0) {
        freeModels = models.map(m => ({
          id: m.id,
          name: m.name || m.id,
          description: `${m.description || ''} | ${m.context_length || m.top_provider?.context_length || ''} ctx`,
          contextLength: m.context_length || m.top_provider?.context_length || 4096,
          free: false
        }));
      }

      return freeModels;
    }

    // OpenRouter - ücretsiz modelleri filtrele
    return models.filter(m => {
      const promptPrice = parseFloat(m.pricing?.prompt || '1');
      const completionPrice = parseFloat(m.pricing?.completion || '1');
      return promptPrice === 0 && completionPrice === 0;
    }).map(m => ({
      id: m.id,
      name: m.name,
      description: m.description?.substring(0, 100) || '',
      contextLength: m.context_length,
      free: true
    }));
  } catch (err) {
    console.error(`[LLM] ${provider.name} model listesi hatası:`, err.message);
    throw err;
  }
}

// ===== ÇEVİRİ =====

export async function translateAndSummarize(article, apiKey, modelId, providerName) {
  if (!apiKey || !modelId) throw new Error('API Key ve model seçilmedi');

  const provider = PROVIDERS[providerName] || getActiveProvider();

  const prompt = `Sen profesyonel bir Türkçe haber editörüsün. Aşağıdaki haberi Türkçe'ye çevir VE kısa bir özet çıkar.
SADECE Türkçe yanıt ver. Başka dil kullanma.

BAŞLIK: ${article.title}
ÖZET: ${article.summary || 'Özet mevcut değil'}
KAYNAK: ${article.source_name || 'Bilinmeyen'}
KATEGORİ: ${article.category}

Lütfen şu formatta yanıt ver (SADECE Türkçe):
BAŞLIK: <Türkçe başlık>
ÖZET: <Türkçe özet (2-3 cümle)>
ANAHTAR KELİMELER: <haberin ana konusu, 3-5 kelime>`;

  try {
    const res = await fetch(provider.chatUrl, {
      method: 'POST',
      headers: {
        [provider.headerKey]: `${provider.headerPrefix}${apiKey}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: 'Sen profesyonel bir Türkçe haber editörüsün. Haberleri doğal ve akıcı Türkçe ile çevirirsin. SADECE Türkçe yanıt ver, asla başka dil kullanma.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600,
        temperature: 0.3
      })
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`API hatası ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    const titleMatch = content.match(/BAŞLIK:\s*(.+)/i);
    const summaryMatch = content.match(/ÖZET:\s*([\s\S]+?)(?=\n\n|ANAHTAR|$)/i);
    const keywordsMatch = content.match(/ANAHTAR KELİMELER:\s*(.+)/i);

    return {
      title: titleMatch ? titleMatch[1].trim() : article.title,
      summary: (summaryMatch ? summaryMatch[1].trim() : article.summary || '').substring(0, 500),
      keywords: keywordsMatch ? keywordsMatch[1].trim() : ''
    };
  } catch (err) {
    console.error(`[LLM] Çeviri hatası:`, err.message);
    throw err;
  }
}

// ===== TOPLU ÇEVİRİ + HAFIZA =====

export async function translateAllUntranslated(apiKey, modelId, providerName, batchSize = 5) {
  const provider = PROVIDERS[providerName] || getActiveProvider();
  const untranslated = dbFunctions.getUntranslatedNews(batchSize);
  let translated = 0;
  let errors = 0;

  for (const article of untranslated) {
    try {
      const result = await translateAndSummarize(article, apiKey, modelId, providerName);
      dbFunctions.updateNewsTranslation(article.id, result.title, result.summary);

      dbFunctions.addKnowledge({
        type: 'news_summary',
        title: result.title,
        content: result.summary,
        source_url: article.source_url,
        source_name: article.source_name,
        category: article.category,
        keywords: result.keywords,
        original_title: article.title
      });

      translated++;
      console.log(`[LLM] Çevrildi + hafıza: ${result.title.substring(0, 40)}...`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors++;
      console.error(`[LLM] Çeviri başarısız (#${article.id}):`, err.message);
    }
  }

  return { translated, errors, total: untranslated.length };
}

// ===== VIDEO TRANSKRİPT ÖZETLEME =====

export async function summarizeVideoTranscript(transcriptText, title, apiKey, modelId, providerName) {
  if (!apiKey || !modelId) throw new Error('API Key ve model seçilmedi');
  if (!transcriptText || transcriptText.length < 20) throw new Error('Transcript çok kısa veya boş');

  const provider = PROVIDERS[providerName] || getActiveProvider();

  const prompt = `Aşağıdaki YouTube video transcript'ini Türkçe'ye çevir ve özetle.
SADECE Türkçe yanıt ver. Başka dil kullanma.

Video Başlığı: ${title}

TRANSCRIPT:
${transcriptText}

Lütfen şu formatta yanıt ver (SADECE Türkçe):

ÖZET: <2-4 cümlelik Türkçe özet>

ÖNEMLİ NOKTALAR:
- <madde 1>
- <madde 2>
- ...

VİDEODAKİ BAĞLANTILAR:
- <URL 1>
- <URL 2>
...

Eğer videoda bağlantı yoksa "VİDEODAKİ BAĞLANTILAR: Yok" yaz.`;

  try {
    const res = await fetch(provider.chatUrl, {
      method: 'POST',
      headers: {
        [provider.headerKey]: `${provider.headerPrefix}${apiKey}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: 'Sen profesyonel bir Türkçe video içerik editörüsün. Videoları özetler, önemli noktaları çıkarır ve içerikteki bağlantıları listelersin. SADECE Türkçe yanıt ver, asla başka dil kullanma.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.3
      })
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`API hatası ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    const summaryMatch = content.match(/ÖZET:\s*([\s\S]+?)(?=\n\n|ÖNEMLİ|ANAHTAR|$)/i);
    const pointsMatch = content.match(/ÖNEMLİ NOKTALAR?:?\s*([\s\S]+?)(?=\n\n|VİDEODAKİ|BAĞLANTILAR|$)/i);
    const linksMatch = content.match(/(?:VİDEODAKİ BAĞLANTILAR|BAĞLANTILAR):?\s*([\s\S]+?)$/i);
    const keywordsMatch = content.match(/ANAHTAR KELİMELER?:?\s*(.+)/i);

    const summary = summaryMatch ? summaryMatch[1].trim() : content.substring(0, 300);
    let links = [];
    if (linksMatch) {
      const linkText = linksMatch[1].trim();
      if (!linkText.toLowerCase().includes('yok')) {
        links = (linkText.match(/https?:\/\/[^\s<>"'\])}]+/gi) || [])
          .map(u => u.replace(/[.,;:!?)]+$/, ''));
      }
    }

    return {
      summary: summary.substring(0, 1000),
      importantPoints: pointsMatch ? pointsMatch[1].trim() : '',
      keywords: keywordsMatch ? keywordsMatch[1].trim() : '',
      links: [...new Set(links)]
    };
  } catch (err) {
    console.error(`[LLM] Video özet hatası:`, err.message);
    throw err;
  }
}

// ===== API KEY DOĞRULAMA =====

export async function validateApiKey(apiKey, providerName) {
  const provider = PROVIDERS[providerName] || getActiveProvider();
  try {
    const res = await fetch(provider.modelsUrl, {
      headers: { [provider.headerKey]: `${provider.headerPrefix}${apiKey}` }
    });
    return res.ok;
  } catch { return false; }
}

// ===== EXA WEB ARAMA =====

export async function searchWeb(query, exaApiKey, numResults = 5) {
  if (!exaApiKey) throw new Error('Exa API Key girilmedi');

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'x-api-key': exaApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      numResults,
      type: 'auto',
      contents: { highlights: true }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Exa API hatası ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    text: (r.highlights || []).join(' ') || r.text || '',
    score: r.score || 0
  }));
}

// ===== SOHBET (Hafıza + Web Arama Destekli) =====

export async function chat(userMessage, apiKey, modelId, providerName, exaApiKey = null) {
  if (!apiKey || !modelId) throw new Error('API Key ve model seçilmedi');

  const provider = PROVIDERS[providerName] || getActiveProvider();
  const userName = dbFunctions.getSetting('user_name') || 'Kullanıcı';

  // Hafızadan ilgili bilgileri çek
  const knowledgeContext = dbFunctions.searchKnowledge(userMessage, 10);
  const todayNews = dbFunctions.getTodayKnowledge(10);

  let contextBlock = '';
  if (knowledgeContext.length > 0) {
    contextBlock += '\n\n## İLGİLİ HAFIZA BİLGİLERİ:\n';
    knowledgeContext.forEach((k, i) => {
      contextBlock += `${i + 1}. [${k.category}] ${k.title}\n   ${k.content}\n   Kaynak: ${k.source_name}\n\n`;
    });
  }
  if (todayNews.length > 0) {
    contextBlock += '\n\n## BUGÜNÜN HABERLERİ:\n';
    todayNews.forEach((k, i) => {
      contextBlock += `${i + 1}. ${k.title} - ${k.content.substring(0, 150)}\n`;
    });
  }

  // Web arama yeteneği varsa system prompt'a ekle
  let searchAbility = '';
  if (exaApiKey) {
    searchAbility = `
\n\n## WEB ARAMA YETENEĞİ:
Gerektiğinde internetten bilgi alabilirsin. Kullanıcı güncel bilgi, son gelişmeler veya hafızanda olmayan bir konu sorduğunda web araması yapmak istersen, yanıtının BAŞINA şunu yaz:
[ARA: <arama sorgusu>]
Örneğin: [ARA: yapay zeka son gelişmeler 2026]
Sistem otomatik olarak arama yapıp sonuçları sana iletecek. Arama sonuçlarını kullanarak Türkçe ve kapsamlı yanıt ver.`;
  }

  const systemPrompt = `Sen "${userName}" adlı kullanıcının kişisel yapay zeka asistanısın.
Senin adın "AI Asistan". Kullanıcının haber takip uygulamasındaki bilgilere erişimin var.
Hafızandaki bilgileri kullanarak kullanıcıya yardımcı ol.
SADECE Türkçe yanıt ver. Hiçbir zaman İngilizce veya başka dil kullanma. Doğal ve samimi ol. Kısa ve öz yanıt ver.
${searchAbility}

HAFIZA BİLGİLERİ:${contextBlock}`;

  // İlk aşama: LLM'den yanıt al
  let reply = await callLLM(provider, apiKey, modelId, systemPrompt, userMessage);

  // Web arama gerekiyorsa
  if (exaApiKey && reply.includes('[ARA:')) {
    const searchMatch = reply.match(/\[ARA:\s*(.+?)\]/);
    if (searchMatch) {
      const searchQuery = searchMatch[1].trim();
      try {
        const searchResults = await searchWeb(searchQuery, exaApiKey);
        if (searchResults.length > 0) {
          const searchContext = searchResults.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.text.substring(0, 500)}`
          ).join('\n\n');

          const followUpPrompt = `Aşağıdaki web arama sonuçlarını kullanarak kullanıcıya kapsamlı bir yanıt ver.
SADECE Türkçe yanıt ver.

ARAMA SONUÇLARI (${searchQuery}):
${searchContext}

Kullanıcının sorusu: ${userMessage}

Önceki yanıtın (arama yapılmamış hali): ${reply.replace(/\[ARA:\s*.+?\]/, '').trim()}

Şimdi web sonuçlarını kullanarak güncel ve kapsamlı bir Türkçe yanıt ver:`;

          reply = await callLLM(provider, apiKey, modelId, 'Sen profesyonel bir Türkçe araştırma asistanısın. Web sonuçlarını kullanarak güncel ve doğru bilgi ver. SADECE Türkçe yanıt ver.', followUpPrompt);
        }
      } catch (err) {
        console.error('[LLM] Web arama hatası:', err.message);
        reply = reply.replace(/\[ARA:\s*.+?\]/, '').trim() + '\n\n(⚠️ Web araması başarısız oldu)';
      }
    }
  }

  dbFunctions.addChatMessage('user', userMessage);
  dbFunctions.addChatMessage('assistant', reply);

  return reply;
}

// LLM çağrısı (tek seferlik)
async function callLLM(provider, apiKey, modelId, systemPrompt, userMessage) {
  const res = await fetch(provider.chatUrl, {
    method: 'POST',
    headers: {
      [provider.headerKey]: `${provider.headerPrefix}${apiKey}`,
      'Content-Type': 'application/json',
      ...provider.extraHeaders
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`API hatası ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Yanıt alınamadı.';
}

// Provider listesini döndür
export function getProviders() {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    id: key,
    name: p.name,
    apiBase: p.apiBase
  }));
}
