// PhotoRank Service Worker
const CACHE = 'photorank-v1'

// Static shell to cache on install
const SHELL = [
  './',
  './index.html',
  './vote.html',
  './leaderboard.html',
  './profile.html',
  './upload.html',
  './settings.html',
  './match-history.html',
  './search.html',
  './style.css',
  './common.js',
  './config.js',
  './manifest.json',
]

// ── Install: cache shell ────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

// ── Activate: clear old caches ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// ── Fetch strategy ──────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Never cache Supabase API or external CDNs — always network
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('cdn.jsdelivr') ||
    url.hostname.includes('fonts.googleapis') ||
    url.hostname.includes('fonts.gstatic') ||
    request.method !== 'GET'
  ) {
    e.respondWith(fetch(request))
    return
  }

  // Cache-first for same-origin static assets
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached

      return fetch(request).then(response => {
        // Only cache successful same-origin responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }
        const clone = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, clone))
        return response
      }).catch(() => {
        // Offline fallback for HTML pages → serve index.html
        if (request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html')
        }
      })
    })
  )
})
