// Haber Kaynakları Merkezi Yönetimi

export const webSources = [
  // === AI Genel ===
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    type: 'rss',
    category: 'ai'
  },
  {
    name: 'The Verge AI',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    type: 'rss',
    category: 'ai'
  },
  {
    name: 'MIT Technology Review AI',
    url: 'https://www.technologyreview.com/feed/',
    type: 'rss',
    category: 'ai'
  },
  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
    type: 'rss',
    category: 'ai'
  },
  // === Vibe Coding / AI Coding ===
  {
    name: 'Hacker News',
    url: 'https://hnrss.org/newest?q=AI+coding+vibe+coding',
    type: 'rss',
    category: 'vibe-coding'
  },
  {
    name: 'Dev.to AI',
    url: 'https://dev.to/feed/tag/ai',
    type: 'rss',
    category: 'vibe-coding'
  },
  {
    name: 'Reddit r/LocalLLaMA',
    url: 'https://www.reddit.com/r/LocalLLaMA/.rss',
    type: 'rss',
    category: 'vibe-coding'
  },
  {
    name: 'GitHub Blog',
    url: 'https://github.blog/feed/',
    type: 'rss',
    category: 'devtools'
  },
  // === Developer Tools ===
  {
    name: 'InfoWorld DevOps',
    url: 'https://www.infoworld.com/feed/',
    type: 'rss',
    category: 'devtools'
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    type: 'rss',
    category: 'devtools'
  }
];

// YouTube Kanalları (RSS Feed)
export const youtubeSources = [
  {
    name: 'Fireship',
    channelId: 'UCsBjURrPoezykLs9EqgamOA',
    category: 'vibe-coding'
  },
  {
    name: 'Two Minute Papers',
    channelId: 'UCbfYPyITQ-7l4upoX8nvctg',
    category: 'ai'
  },
  {
    name: 'Matt Wolfe',
    channelId: 'UCjZOFmBCfOAp1J5aFa2P7ZA',
    category: 'ai'
  },
  {
    name: 'AI Jason',
    channelId: 'UCpoJkK7pNgv0JYjNdMFd03Q',
    category: 'ai'
  },
  {
    name: 'NetworkChuck',
    channelId: 'UC9x0AN7BWHpCDHSm9NiJxJQ',
    category: 'devtools'
  },
  {
    name: 'The Coding Train',
    channelId: 'UCvjgXvBlbQiydffZU7m1_aw',
    category: 'vibe-coding'
  },
  {
    name: 'Figma',
    channelId: 'UCQmQoRqCBbYVxC7GkRMHQpA',
    category: 'devtools'
  },
  {
    name: 'Web Dev Simplified',
    channelId: 'UCFbNIlppjAuEX4zn8h89L8Q',
    category: 'devtools'
  }
];

// YouTube RSS URL oluşturucu
export function getYoutubeRssUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}
