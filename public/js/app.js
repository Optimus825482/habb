// ===== AI Haber Takip - Frontend Uygulaması =====

const API = '';
let currentCategory = 'all';
let currentPage = 0;
const PAGE_SIZE = 30;
let allNews = [];
let isScanning = false;
let currentModalNews = null;
let activeProvider = 'openrouter';
let ttsAudio = null;
let isRecording = false;
let recognition = null;

// ===== Başlangıç =====
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  registerSW();
  initVoiceRecognition();
});

async function initApp() {
  setupNavigation();
  setupCategoryTabs();
  setupModalClose();
  await loadSettings();
  showSkeletonLoading();
  await loadNews();
  await loadStats();
}

// ===== Service Worker =====
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (e) {}
  }
}

// ===== VERİ YÜKLEME =====
async function loadNews(category = 'all') {
  currentCategory = category;
  currentPage = 0;
  showSkeletonLoading();
  try {
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: 0 });
    if (category === 'video') params.set('content_type', 'video');
    else if (category !== 'all') params.set('category', category);
    const res = await fetch(`${API}/api/news?${params}`);
    const json = await res.json();
    if (json.success) { allNews = json.data; renderNews(allNews); }
  } catch (err) {
    renderEmpty('Bağlantı hatası', 'Sunucuya ulaşılamıyor.');
  }
}

async function loadMoreNews() {
  currentPage++;
  try {
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: currentPage * PAGE_SIZE });
    if (currentCategory === 'video') params.set('content_type', 'video');
    else if (currentCategory !== 'all') params.set('category', currentCategory);
    const res = await fetch(`${API}/api/news?${params}`);
    const json = await res.json();
    if (json.success && json.data.length > 0) { allNews = [...allNews, ...json.data]; appendNews(json.data); }
  } catch (err) {}
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const json = await res.json();
    if (json.success) {
      updateStatsBadge(json.data.total);
      updateTabCounts(json.data.byCategory);
    }
  } catch (err) {}
}

// ===== RENDER =====
function renderNews(news) {
  const container = document.getElementById('news-grid');
  const emptyEl = document.getElementById('empty-state');
  if (news.length === 0) { container.innerHTML = ''; emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  container.innerHTML = news.map((item, i) => createNewsCard(item, i)).join('');
  container.onclick = (e) => {
    const card = e.target.closest('.news-card');
    if (!card) return;
    const id = parseInt(card.dataset.id);
    if (e.target.closest('.tts-btn')) { e.stopPropagation(); readAloud(id); return; }
    if (e.target.closest('.featured-btn')) { e.stopPropagation(); toggleFeatured(id, card); return; }
    if (e.target.closest('.link-btn')) { e.stopPropagation(); openSourceUrl(id); return; }
    openDetail(id);
  };
}

function appendNews(news) {
  const container = document.getElementById('news-grid');
  container.insertAdjacentHTML('beforeend', news.map((item, i) => createNewsCard(item, allNews.length - news.length + i)).join(''));
}

function createNewsCard(item, index) {
  const catClass = item.category || 'ai';
  const catLabels = { 'ai': 'Yapay Zeka', 'vibe-coding': 'Vibe Coding', 'devtools': 'DevTools' };
  const typeIcon = item.content_type === 'video' ? '🎬' : '🌐';
  const typeLabel = item.content_type === 'video' ? 'Video' : 'Makale';
  const readClass = item.is_read ? 'read' : '';
  const featuredClass = item.is_featured ? 'featured' : '';
  return `
    <div class="news-card ${readClass} ${featuredClass}" data-id="${item.id}" style="animation-delay:${index * 0.05}s">
      ${item.thumbnail ? `<img class="card-thumbnail" src="${esc(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="card-body">
        <div class="card-meta">
          <span class="card-category ${catClass}">${catLabels[catClass] || catClass}</span>
          <span class="card-type">${typeIcon} ${typeLabel}</span>
          <span class="card-source">${esc(item.source_name || '')}</span>
        </div>
        <h3 class="card-title">${esc(item.title)}</h3>
        ${item.summary ? `<p class="card-summary">${esc(item.summary)}</p>` : ''}
        <div class="card-footer">
          <span class="card-date">${fmtDate(item.published_at)}</span>
          <div class="card-actions">
            <button class="tts-btn" title="Sesli Oku">🔊</button>
            <button class="card-btn featured-btn ${item.is_featured ? 'active' : ''}" title="Öne Çıkar">⭐</button>
            <button class="card-btn link-btn" title="Kaynağa Git">🔗</button>
          </div>
        </div>
      </div>
    </div>`;
}

function showSkeletonLoading() {
  const c = document.getElementById('news-grid');
  c.innerHTML = Array.from({length:6}, () => `
    <div class="skeleton-card"><div class="skeleton skeleton-thumb"></div>
    <div class="skeleton-body"><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line medium"></div></div></div>`).join('');
  document.getElementById('empty-state').style.display = 'none';
}

function renderEmpty(title, desc) {
  document.getElementById('news-grid').innerHTML = '';
  const e = document.getElementById('empty-state');
  e.style.display = 'block';
  e.innerHTML = `<div class="empty-icon">📭</div><h3>${title}</h3><p>${desc}</p><button class="btn-primary" onclick="startScan()">Taramayı Başlat</button>`;
}

// ===== DETAY MODAL =====
async function openDetail(id) {
  try {
    const res = await fetch(`${API}/api/news/${id}`);
    const json = await res.json();
    if (!json.success) return;
    const item = json.data;
    currentModalNews = item;
    const catLabels = {'ai':'Yapay Zeka','vibe-coding':'Vibe Coding','devtools':'DevTools'};
    document.getElementById('modal-thumbnail').src = item.thumbnail || '';
    document.getElementById('modal-thumbnail').style.display = item.thumbnail ? 'block' : 'none';
    document.getElementById('modal-title').textContent = item.title;
    document.getElementById('modal-category').textContent = catLabels[item.category] || item.category;
    document.getElementById('modal-category').className = `card-category ${item.category}`;
    document.getElementById('modal-type').textContent = item.content_type === 'video' ? '🎬 Video' : '🌐 Makale';
    document.getElementById('modal-source').textContent = item.source_name || '';
    document.getElementById('modal-date').textContent = fmtDate(item.published_at);
    document.getElementById('modal-summary').textContent = item.summary || 'Özet mevcut değil.';
    document.getElementById('modal-source-link').href = item.source_url;
    document.getElementById('detail-modal').classList.add('visible');
    document.body.style.overflow = 'hidden';
    await fetch(`${API}/api/news/${id}/read`, { method: 'PUT' });
  } catch (err) {}
}

function setupModalClose() {
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('detail-modal').onclick = (e) => { if (e.target === e.currentTarget) closeModal(); };
}

function closeModal() { document.getElementById('detail-modal').classList.remove('visible'); document.body.style.overflow = ''; }

// ===== KAYNAĞA GİT =====
async function openSourceUrl(id) {
  try {
    const res = await fetch(`${API}/api/news/${id}`);
    const json = await res.json();
    if (json.success && json.data.source_url) window.open(json.data.source_url, '_blank');
  } catch (err) {}
}

// ===== ÖNE ÇIKAR =====
async function toggleFeatured(id, card) {
  try {
    await fetch(`${API}/api/news/${id}/featured`, { method: 'PUT' });
    card.classList.toggle('featured');
    card.querySelector('.featured-btn').classList.toggle('active');
    showToast(card.classList.contains('featured') ? 'Öne çıkarıldı' : 'Kaldırıldı');
  } catch (err) {}
}

// ===== TARAMA =====
async function startScan() {
  if (isScanning) return;
  isScanning = true;
  const btn = document.getElementById('scan-btn');
  const bar = document.getElementById('scan-progress');
  btn.classList.add('scanning');
  btn.innerHTML = '<div class="spinner"></div>';
  bar.style.width = '0%'; bar.style.display = 'block';
  let p = 0;
  const iv = setInterval(() => { p = Math.min(p + Math.random()*8, 90); bar.style.width = p+'%'; }, 300);
  try {
    const res = await fetch(`${API}/api/scrape`, { method: 'POST' });
    const json = await res.json();
    clearInterval(iv); bar.style.width = '100%';
    if (json.success) { showToast(json.message); await loadNews(currentCategory); await loadStats(); }
    else showToast('Hata: ' + (json.error || ''));
  } catch (err) { clearInterval(iv); showToast('Sunucuya bağlanamadı'); }
  finally { setTimeout(() => { bar.style.display='none'; bar.style.width='0%'; }, 500); btn.classList.remove('scanning'); btn.innerHTML = '🔍 Tarama'; isScanning = false; }
}

// ===== SESLI OKUMA (Edge TTS) =====
async function readAloud(newsId) {
  if (ttsAudio && !ttsAudio.ended) { ttsAudio.pause(); ttsAudio = null; document.querySelectorAll('.tts-btn').forEach(b => b.classList.remove('playing')); return; }
  try {
    const res = await fetch(`${API}/api/news/${newsId}`);
    const json = await res.json();
    if (!json.success) return;
    const item = json.data;
    const text = `${item.title}. ${item.summary || ''}`;
    await playTts(text, newsId);
  } catch (err) { showToast('Sesli okuma hatası'); }
}

async function readAloudModal() {
  if (!currentModalNews) return;
  const text = `${currentModalNews.title}. ${currentModalNews.summary || ''}`;
  const btn = document.getElementById('modal-tts-btn');
  if (ttsAudio && !ttsAudio.ended) { ttsAudio.pause(); ttsAudio = null; btn.classList.remove('playing'); return; }
  await playTts(text, 'modal', btn);
}

async function playTts(text, id, btn) {
  const voice = document.getElementById('voice-select')?.value || 'tr-TR-AhmetNeural';
  showToast('Ses hazırlanıyor...');
  try {
    const res = await fetch(`${API}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 2000), voice })
    });
    if (!res.ok) throw new Error('TTS hatası');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsAudio = new Audio(url);
    if (btn) btn.classList.add('playing');
    const cardBtn = id !== 'modal' ? document.querySelector(`.news-card[data-id="${id}"] .tts-btn`) : null;
    if (cardBtn) cardBtn.classList.add('playing');
    ttsAudio.onended = () => {
      if (btn) btn.classList.remove('playing');
      if (cardBtn) cardBtn.classList.remove('playing');
      URL.revokeObjectURL(url);
    };
    ttsAudio.play();
  } catch (err) { showToast('Sesli okuma başlatılamadı'); if (btn) btn.classList.remove('playing'); }
}

// ===== SESLİ GİRİŞ (Web Speech API) =====
function initVoiceRecognition() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'tr-TR';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    document.getElementById('chat-input').value = text;
    stopRecording();
    sendChat();
  };
  recognition.onerror = () => stopRecording();
  recognition.onend = () => stopRecording();
}

function startVoiceInput() {
  if (!recognition) { showToast('Tarayıcınız sesli girişi desteklemiyor'); return; }
  if (isRecording) { recognition.stop(); stopRecording(); return; }
  isRecording = true;
  document.getElementById('voice-btn').classList.add('recording');
  recognition.start();
}

function stopRecording() {
  isRecording = false;
  document.getElementById('voice-btn')?.classList.remove('recording');
}

// ===== SOHBET =====
async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addChatMsg('user', msg);
  const typing = addChatMsg('assistant', 'Düşünüyorum...');
  typing.classList.add('typing');
  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const json = await res.json();
    typing.remove();
    if (json.success) addChatMsg('assistant', json.reply);
    else addChatMsg('assistant', 'Hata: ' + (json.error || 'Yanıt alınamadı'));
  } catch (err) { typing.remove(); addChatMsg('assistant', 'Sunucuya bağlanılamadı'); }
}

function addChatMsg(role, text) {
  const container = document.getElementById('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `${esc(text)}`;
  if (role === 'assistant') {
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'msg-tts';
    ttsBtn.textContent = '🔊';
    ttsBtn.title = 'Sesli oku';
    ttsBtn.onclick = async (e) => {
      e.stopPropagation();
      if (ttsAudio && !ttsAudio.ended) { ttsAudio.pause(); ttsAudio = null; ttsBtn.classList.remove('playing'); return; }
      await playTts(text, 'chat-' + Date.now(), ttsBtn);
    };
    div.appendChild(ttsBtn);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function loadChatHistory() {
  try {
    const res = await fetch(`${API}/api/chat/history`);
    const json = await res.json();
    if (json.success && json.data.length > 0) {
      document.querySelector('.chat-welcome')?.remove();
      json.data.forEach(m => addChatMsg(m.role, m.content));
    }
  } catch (err) {}
}

// ===== AYARLAR =====
async function loadSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    const json = await res.json();
    if (!json.success) return;
    const s = json.data;

    // Kullanıcı adı
    if (s.user_name) {
      document.getElementById('user-name-input').value = s.user_name;
      document.getElementById('app-title').textContent = `${s.user_name} - AI Haber`;
      document.getElementById('chat-greeting').textContent = `Merhaba ${s.user_name}!`;
    }

    // Provider
    activeProvider = s.active_provider || 'openrouter';
    document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-provider-${activeProvider}`)?.classList.add('active');
    document.querySelectorAll('.provider-section').forEach(el => el.style.display = 'none');
    document.getElementById(`section-${activeProvider}`).style.display = '';

    // API Key'ler
    if (s.llm_api_key) document.getElementById('or-key-status').innerHTML = `✅ Kayıtlı: ${s.llm_api_key_masked || '***'}`;
    if (s.opencode_api_key) document.getElementById('oc-key-status').innerHTML = `✅ Kayıtlı: ${s.opencode_api_key_masked || '***'}`;
    if (s.kilogateway_api_key) document.getElementById('kg-key-status').innerHTML = `✅ Kayıtlı: ${s.kilogateway_api_key_masked || '***'}`;
    if (s.exa_api_key) document.getElementById('exa-key-status').innerHTML = `✅ Kayıtlı: ${s.exa_api_key_masked || '***'} · Web arama aktif`;

    // Model
    if (s.llm_model || s.opencode_model || s.kilogateway_model) {
      const keys = { openrouter: 'llm_model', opencode: 'opencode_model', kilogateway: 'kilogateway_model' };
      const m = s[keys[activeProvider]];
      if (m) document.getElementById('model-status').textContent = `Seçili: ${m}`;
    }

    // Ses
    if (s.tts_voice) document.getElementById('voice-select').value = s.tts_voice;

    // İstatistikler
    const statsRes = await fetch(`${API}/api/stats`);
    const statsJson = await statsRes.json();
    if (statsJson.success) {
      const st = statsJson.data;
      document.getElementById('stat-total').textContent = st.total;
      document.getElementById('stat-today').textContent = st.today;
      document.getElementById('stat-web').textContent = st.byType.find(t => t.content_type === 'web')?.count || 0;
      document.getElementById('stat-video').textContent = st.byType.find(t => t.content_type === 'video')?.count || 0;
    }

    // Loglar
    const logsRes = await fetch(`${API}/api/scrape-logs`);
    const logsJson = await logsRes.json();
    if (logsJson.success) {
      const list = document.getElementById('logs-list');
      if (!logsJson.data.length) { list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Henüz tarama yok</p>'; }
      else {
        list.innerHTML = logsJson.data.map(l => `<div class="log-item"><div style="display:flex;align-items:center;"><span class="log-status ${l.status==='success'?'success':'error'}"></span><span>${fmtDateTime(l.started_at)}</span></div><span style="color:${l.status==='success'?'var(--accent-secondary)':'#e17055'}">${l.new_items} yeni</span></div>`).join('');
      }
    }
  } catch (err) {}
}

function selectProvider(provider) {
  activeProvider = provider;
  document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-provider-${provider}`)?.classList.add('active');
  document.querySelectorAll('.provider-section').forEach(el => el.style.display = 'none');
  document.getElementById(`section-${provider}`).style.display = '';
  saveSetting('active_provider', provider);
}

async function saveProviderKey(provider) {
  const inputIds = { openrouter: 'or-key-input', opencode: 'oc-key-input', kilogateway: 'kg-key-input' };
  const keyFields = { openrouter: 'llm_api_key', opencode: 'opencode_api_key', kilogateway: 'kilogateway_api_key' };
  const names = { openrouter: 'OpenRouter', opencode: 'OpenCode', kilogateway: 'KiloGateway' };

  const inputId = inputIds[provider];
  const key = document.getElementById(inputId).value.trim();
  if (!key) return showToast('API Key boş olamaz');
  await saveSetting(keyFields[provider], key);
  document.getElementById(inputId).value = '';
  showToast(`${names[provider]} API Key kaydedildi`);
  await loadSettings();
  loadModels();
}

async function loadModels() {
  const select = document.getElementById('model-select');
  select.disabled = true;
  select.innerHTML = '<option>Modeller yükleniyor...</option>';
  try {
    const res = await fetch(`${API}/api/llm/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: activeProvider })
    });
    const json = await res.json();
    if (json.success && json.data.length > 0) {
      select.innerHTML = '<option value="">Model seçin</option>' +
        json.data.map(m => `<option value="${m.id}" ${m.free ? 'style="color:var(--accent-secondary)"' : ''}>${m.name || m.id} ${m.free ? '✨ ÜCRETSİZ' : ''}</option>`).join('');
      select.disabled = false;
      const savedKeys = { openrouter: 'llm_model', opencode: 'opencode_model', kilogateway: 'kilogateway_model' };
      const savedModel = savedKeys[activeProvider] || 'llm_model';
      const current = await (await fetch(`${API}/api/settings`)).json();
      const modelVal = current.data?.[savedModel];
      if (modelVal) select.value = modelVal;
    } else {
      select.innerHTML = '<option>Model bulunamadı</option>';
      showToast(json.message || 'Model bulunamadı');
    }
  } catch (err) { select.innerHTML = '<option>Hata oluştu</option>'; }
}

async function selectModel(modelId) {
  if (!modelId) return;
  const fields = { openrouter: 'llm_model', opencode: 'opencode_model', kilogateway: 'kilogateway_model' };
  const field = fields[activeProvider] || 'llm_model';
  await saveSetting(field, modelId);
  document.getElementById('model-status').textContent = `Seçili: ${modelId}`;
  showToast('Model kaydedildi');
}

async function startTranslation() {
  const btn = document.getElementById('btn-translate');
  const prog = document.getElementById('translate-progress');
  btn.classList.add('scanning'); btn.innerHTML = '<div class="spinner"></div> Çevriliyor...';
  prog.textContent = 'Lütfen bekleyin...';
  try {
    const res = await fetch(`${API}/api/llm/translate`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ batch_size: 10 }) });
    const json = await res.json();
    if (json.success) { showToast(json.message); prog.textContent = json.message; }
    else showToast('Hata: ' + (json.error || ''));
  } catch (err) { showToast('Çeviri hatası'); }
  finally { btn.classList.remove('scanning'); btn.innerHTML = '🔄 Haberleri Çevir'; }
}

async function saveUserName() {
  const name = document.getElementById('user-name-input').value.trim();
  if (!name) return;
  await saveSetting('user_name', name);
  document.getElementById('app-title').textContent = `${name} - AI Haber`;
  document.getElementById('chat-greeting').textContent = `Merhaba ${name}!`;
  showToast(`${name} olarak kaydedildi`);
}

async function saveExaKey() {
  const key = document.getElementById('exa-key-input').value.trim();
  if (!key) return showToast('API Key boş olamaz');
  // Önce doğrula
  try {
    const res = await fetch(`${API}/api/exa/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key })
    });
    const json = await res.json();
    if (!json.valid) return showToast('Geçersiz Exa API Key: ' + (json.error || ''));
  } catch (e) {}
  await saveSetting('exa_api_key', key);
  document.getElementById('exa-key-input').value = '';
  document.getElementById('exa-key-status').innerHTML = '✅ Kaydedildi · Web arama aktif';
  showToast('Exa API Key kaydedildi — Web arama aktif!');
}

async function saveVoiceSetting(voice) {
  await saveSetting('tts_voice', voice);
}

async function saveSetting(key, value) {
  try { await fetch(`${API}/api/settings`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ [key]: value }) }); } catch (err) {}
}

// ===== NAVİGASYON =====
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const target = item.dataset.page;
      document.getElementById('home-page').style.display = 'none';
      document.getElementById('chat-page').style.display = 'none';
      document.getElementById('settings-page').style.display = 'none';
      document.querySelector('.category-tabs').style.display = 'none';
      if (target === 'home') {
        document.getElementById('home-page').style.display = 'block';
        document.querySelector('.category-tabs').style.display = 'flex';
        loadNews(currentCategory);
      } else if (target === 'chat') {
        document.getElementById('chat-page').style.display = 'flex';
        loadChatHistory();
      } else if (target === 'featured') {
        document.getElementById('home-page').style.display = 'block';
        document.querySelector('.category-tabs').style.display = 'flex';
        loadFeaturedNews();
      } else if (target === 'settings') {
        document.getElementById('settings-page').style.display = 'block';
        loadSettings();
      }
    };
  });
}

async function loadFeaturedNews() {
  showSkeletonLoading();
  try {
    const res = await fetch(`${API}/api/news?featured=true&limit=50`);
    const json = await res.json();
    if (json.success) { allNews = json.data; renderNews(allNews); if (!allNews.length) renderEmpty('Öne çıkan yok', '⭐ butonu ile haberleri öne çıkarabilirsiniz.'); }
  } catch (err) { renderEmpty('Bağlantı hatası', ''); }
}

// ===== KATEGORİ SEKMLERİ =====
function setupCategoryTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); loadNews(tab.dataset.category); };
  });
}

function updateTabCounts(byCategory) {
  const counts = {}; byCategory.forEach(c => counts[c.category] = c.count);
  const total = Object.values(counts).reduce((a,b) => a+b, 0);
  document.querySelectorAll('.tab').forEach(tab => {
    const cat = tab.dataset.category;
    const el = tab.querySelector('.tab-count');
    if (el) el.textContent = cat === 'all' ? total : (counts[cat] || 0);
  });
}

function updateStatsBadge(total) { const b = document.getElementById('stats-badge'); if (b) b.innerHTML = `<span>${total}</span> haber`; }

// ===== TOAST =====
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ===== YARDIMCI =====
function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d), now = new Date(), diff = now - date;
  const m = Math.floor(diff/60000), h = Math.floor(diff/3600000), dy = Math.floor(diff/86400000);
  if (m < 1) return 'Az önce'; if (m < 60) return `${m} dk önce`; if (h < 24) return `${h} saat önce`;
  if (dy < 7) return `${dy} gün önce`;
  return date.toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('tr-TR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ===== INFINITE SCROLL =====
let scrollTimeout;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && allNews.length >= PAGE_SIZE) loadMoreNews();
  }, 100);
}, { passive: true });
