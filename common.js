// ─── Supabase ────────────────────────────────────────────────────────────────
let _sb = null
function getSupabase() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return _sb
}

// ─── ELO ─────────────────────────────────────────────────────────────────────
const ELO_K = 32
function eloExpected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)) }
function eloNew(player, opponent, score) {
  return Math.round(player + ELO_K * (score - eloExpected(player, opponent)))
}
function calcEloUpdate(winnerElo, loserElo) {
  return { winnerNew: eloNew(winnerElo, loserElo, 1), loserNew: eloNew(loserElo, winnerElo, 0) }
}

// ─── Tiers ────────────────────────────────────────────────────────────────────
const TIERS = [
  { name: 'Platinum', min: 1400, color: '#67e8f9', bg: 'rgba(103,232,249,0.12)', border: 'rgba(103,232,249,0.3)', icon: '💎' },
  { name: 'Gold',     min: 1200, color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)',  icon: '🥇' },
  { name: 'Silver',   min: 1000, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)',border: 'rgba(148,163,184,0.3)',icon: '🥈' },
  { name: 'Bronze',   min: 0,    color: '#b45309', bg: 'rgba(180,83,9,0.12)',    border: 'rgba(180,83,9,0.3)',    icon: '🥉' },
]
function getTier(elo) { return TIERS.find(t => elo >= t.min) || TIERS[TIERS.length - 1] }
function tierBadgeHtml(elo) {
  const t = getTier(elo)
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${t.color};background:${t.bg};border:1px solid ${t.border};border-radius:999px;padding:2px 8px;">${t.icon} ${t.name}</span>`
}

// ─── Theme (dark / light) ─────────────────────────────────────────────────────
function getTheme() { return localStorage.getItem('pr_theme') || 'dark' }
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('pr_theme', theme)
}
function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark')
  updateThemeIcon()
}
function updateThemeIcon() {
  const btn = document.getElementById('theme-btn')
  if (btn) btn.textContent = getTheme() === 'dark' ? '☀️' : '🌙'
}
function initTheme() {
  applyTheme(getTheme())
  updateThemeIcon()
}

// ─── Toast notifications ──────────────────────────────────────────────────────
let _toastContainer = null
function getToastContainer() {
  if (_toastContainer) return _toastContainer
  _toastContainer = document.createElement('div')
  _toastContainer.id = 'toast-container'
  _toastContainer.style.cssText = 'position:fixed;top:72px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;'
  document.body.appendChild(_toastContainer)
  return _toastContainer
}

function showToast(msg, type = 'info', duration = 4000) {
  const colors = {
    info:    { bg: 'rgba(155,0,0,0.9)',   border: 'rgba(155,0,0,0.5)' },
    success: { bg: 'rgba(22,163,74,0.9)',   border: 'rgba(34,197,94,0.5)' },
    warning: { bg: 'rgba(180,83,9,0.9)',    border: 'rgba(251,146,60,0.5)' },
    error:   { bg: 'rgba(185,28,28,0.9)',   border: 'rgba(239,68,68,0.5)' },
    match:   { bg: 'rgba(155,0,0,0.95)', border: 'rgba(167,139,250,0.5)' },
  }
  const c = colors[type] || colors.info
  const el = document.createElement('div')
  el.style.cssText = `
    background:${c.bg};border:1px solid ${c.border};border-radius:12px;
    padding:12px 16px;font-size:13px;font-weight:500;color:white;
    backdrop-filter:blur(12px);pointer-events:auto;cursor:pointer;
    max-width:300px;word-break:break-word;
    box-shadow:0 4px 24px rgba(0,0,0,0.4);
    animation:toastIn .3s cubic-bezier(.22,1,.36,1) both;
  `
  el.textContent = msg
  el.onclick = () => dismissToast(el)

  const container = getToastContainer()
  container.appendChild(el)

  const timer = setTimeout(() => dismissToast(el), duration)
  el._timer = timer
}

function dismissToast(el) {
  clearTimeout(el._timer)
  el.style.animation = 'toastOut .25s ease forwards'
  setTimeout(() => el.remove(), 250)
}

// Inject toast keyframes once
;(function() {
  const s = document.createElement('style')
  s.textContent = `
    @keyframes toastIn  { from{opacity:0;transform:translateX(24px)} to{opacity:1;transform:translateX(0)} }
    @keyframes toastOut { from{opacity:1;transform:translateX(0)} to{opacity:0;transform:translateX(24px)} }
  `
  document.head.appendChild(s)
})()

// ─── Session expiry ───────────────────────────────────────────────────────────
function initSessionWatch() {
  getSupabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
      if (event === 'SIGNED_OUT' && !window.location.href.includes('index.html')) {
        showToast('Your session expired. Please log in again.', 'warning', 5000)
        setTimeout(() => { window.location.href = 'index.html' }, 2000)
      }
    }
  })
}

// ─── Offline detection + vote queue ──────────────────────────────────────────
let _isOnline = navigator.onLine

window.addEventListener('online',  () => { _isOnline = true;  showToast('Back online — syncing votes…', 'success'); flushOfflineQueue() })
window.addEventListener('offline', () => { _isOnline = false; showToast('You\'re offline. Votes will be saved and sent when you reconnect.', 'warning', 6000) })

function isOnline() { return _isOnline }

function queueVote(vote) {
  const q = getOfflineQueue()
  q.push({ ...vote, _ts: Date.now() })
  localStorage.setItem('pr_vote_queue', JSON.stringify(q))
}

function getOfflineQueue() {
  return JSON.parse(localStorage.getItem('pr_vote_queue') || '[]')
}

async function flushOfflineQueue() {
  const q = getOfflineQueue()
  if (!q.length) return

  const { data: { user } } = await getSupabase().auth.getUser()
  if (!user) return

  let flushed = 0
  for (const v of q) {
    try {
      await getSupabase().from('votes').insert({ voter_id: user.id, winner_id: v.winner_id, loser_id: v.loser_id })
      flushed++
    } catch {}
  }

  localStorage.removeItem('pr_vote_queue')
  if (flushed > 0) showToast(`Synced ${flushed} offline vote${flushed === 1 ? '' : 's'}!`, 'success')
}

// ─── Realtime notifications (beatings received) ───────────────────────────────
let _notifChannel = null
let _notifCount = 0

async function initNotifications() {
  const { data: { user } } = await getSupabase().auth.getUser()
  if (!user) return

  _notifChannel = getSupabase()
    .channel('my-losses')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'votes', filter: `loser_id=eq.${user.id}` },
      async (payload) => {
        const { winner_id } = payload.new
        const { data: winner } = await getSupabase().from('profiles').select('username').eq('id', winner_id).single()
        const name = winner?.username ?? 'Someone'
        showToast(`${name} beat you in a matchup!`, 'match')
        _notifCount++
        updateNotifBadge()
      }
    )
    .subscribe()
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge')
  if (!badge) return
  badge.textContent = _notifCount
  badge.style.display = _notifCount > 0 ? 'flex' : 'none'
}

// ─── Rate limiter (100 votes / hour) ─────────────────────────────────────────
function checkRateLimit() {
  const now = Date.now(), HOUR = 3600000
  const stored = JSON.parse(localStorage.getItem('pr_vote_ts') || '[]').filter(t => now - t < HOUR)
  if (stored.length >= 100) return false
  stored.push(now)
  localStorage.setItem('pr_vote_ts', JSON.stringify(stored))
  return true
}
function votesThisHour() {
  const now = Date.now(), HOUR = 3600000
  return JSON.parse(localStorage.getItem('pr_vote_ts') || '[]').filter(t => now - t < HOUR).length
}

// ─── Streak ───────────────────────────────────────────────────────────────────
function getStreak() {
  const data = JSON.parse(localStorage.getItem('pr_streak') || '{"count":0,"lastVote":0}')
  const HOUR = 3600000 * 24
  if (Date.now() - data.lastVote > HOUR) { data.count = 0 }
  return data
}
function incrementStreak() {
  const data = getStreak()
  data.count++
  data.lastVote = Date.now()
  localStorage.setItem('pr_streak', JSON.stringify(data))
  return data.count
}

// ─── Matchup deduplication ────────────────────────────────────────────────────
function pairKey(a, b) { return [a, b].sort().join('|') }
function getSeenPairs() { return new Set(JSON.parse(sessionStorage.getItem('pr_seen') || '[]')) }
function markPairSeen(a, b) {
  const s = getSeenPairs(); s.add(pairKey(a, b))
  sessionStorage.setItem('pr_seen', JSON.stringify([...s]))
}
function hasPairBeenSeen(a, b) { return getSeenPairs().has(pairKey(a, b)) }

// ─── Image resize ─────────────────────────────────────────────────────────────
function resizeImage(file, maxPx = 800) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width <= maxPx && height <= maxPx) { resolve(file); return }
      const ratio = Math.min(maxPx / width, maxPx / height)
      width = Math.round(width * ratio); height = Math.round(height * ratio)
      const c = document.createElement('canvas')
      c.width = width; c.height = height
      c.getContext('2d').drawImage(img, 0, 0, width, height)
      c.toBlob(b => resolve(new File([b], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.85)
    }
    img.src = url
  })
}

// ─── Share card (canvas) ──────────────────────────────────────────────────────
async function generateShareCard(username, elo, rank, photoUrl) {
  const canvas = document.createElement('canvas')
  canvas.width = 600; canvas.height = 340
  const ctx = canvas.getContext('2d')

  // Background
  const grad = ctx.createLinearGradient(0, 0, 600, 340)
  grad.addColorStop(0, '#0d0d1f')
  grad.addColorStop(1, '#1a0533')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 600, 340)

  // Purple glow
  const glow = ctx.createRadialGradient(480, 80, 0, 480, 80, 200)
  glow.addColorStop(0, 'rgba(155,0,0,0.3)')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 600, 340)

  // Avatar circle
  try {
    const img = await loadImg(photoUrl)
    ctx.save()
    ctx.beginPath()
    ctx.arc(100, 170, 72, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, 28, 98, 144, 144)
    ctx.restore()
    // Ring
    ctx.beginPath()
    ctx.arc(100, 170, 74, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(155,0,0,0.7)'
    ctx.lineWidth = 3
    ctx.stroke()
  } catch {}

  // Logo
  ctx.font = '700 16px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText('Maroon Match', 210, 60)

  // Tier
  const tier = getTier(elo)
  ctx.font = '700 13px Inter, sans-serif'
  ctx.fillStyle = tier.color
  ctx.fillText(`${tier.icon} ${tier.name}`, 210, 90)

  // Name
  ctx.font = '800 36px Inter, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(username, 210, 140)

  // ELO
  ctx.font = '700 22px Inter, sans-serif'
  ctx.fillStyle = '#FECACA'
  ctx.fillText(`ELO ${elo}`, 210, 180)

  // Rank
  ctx.font = '500 15px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`Global Rank #${rank}`, 210, 210)

  // Bottom bar
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, 280, 600, 60)
  ctx.font = '500 13px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillText('photorank.app  ·  Head-to-head photo voting', 24, 315)

  return canvas.toDataURL('image/png')
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// ─── ELO sparkline SVG ───────────────────────────────────────────────────────
function eloSparklineSvg(points, width = 300, height = 60) {
  if (!points || points.length < 2) return '<p style="color:var(--muted);font-size:13px;">Not enough data yet</p>'

  const min = Math.min(...points) - 20
  const max = Math.max(...points) + 20
  const range = max - min || 1
  const W = width, H = height
  const xs = points.map((_, i) => (i / (points.length - 1)) * W)
  const ys = points.map(v => H - ((v - min) / range) * H)

  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  // Area fill path
  const area = d + ` L${W},${H} L0,${H} Z`

  const lastY = ys[ys.length - 1]
  const lastX = xs[xs.length - 1]
  const trend = points[points.length - 1] >= points[0]
  const lineColor = trend ? '#86efac' : '#fca5a5'
  const areaColor = trend ? 'rgba(134,239,172,0.08)' : 'rgba(252,165,165,0.08)'

  return `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity=".3"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#sg)" />
      <path d="${d}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="4" fill="${lineColor}" />
    </svg>
  `
}

// ─── Nav helpers ──────────────────────────────────────────────────────────────
async function initNav() {
  initTheme()
  initSessionWatch()

  const sb = getSupabase()
  const { data: { user } } = await sb.auth.getUser()
  const el = document.getElementById('nav-actions')
  if (!el) return

  if (user) {
    el.innerHTML = `
      <div style="position:relative;display:inline-block;">
        <button id="notif-btn" onclick="clearNotifs()" title="Notifications"
          style="background:none;border:none;cursor:pointer;font-size:18px;padding:4px 6px;line-height:1;color:var(--muted);transition:color .15s;"
          onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--muted)'">🔔</button>
        <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;width:16px;height:16px;background:#ef4444;border-radius:50%;font-size:9px;font-weight:700;color:white;align-items:center;justify-content:center;border:1.5px solid var(--bg);">0</span>
      </div>
      <button id="theme-btn" onclick="toggleTheme()"
        style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;"></button>
      <a href="settings.html" style="color:var(--muted);text-decoration:none;font-size:14px;padding:6px 12px;border-radius:8px;transition:color .15s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--muted)'">Settings</a>
      <button onclick="logout()"
        style="background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:13px;padding:6px 14px;cursor:pointer;font-weight:500;transition:border-color .15s,color .15s;"
        onmouseover="this.style.color='white';this.style.borderColor='rgba(255,255,255,0.3)'"
        onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border)'">Logout</button>
    `
    updateThemeIcon()
    initNotifications()
  } else {
    el.innerHTML = `
      <button id="theme-btn" onclick="toggleTheme()"
        style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;"></button>
      <a href="index.html" class="btn-accent" style="text-decoration:none;font-size:13px;padding:7px 16px;">Log In</a>
    `
    updateThemeIcon()
  }
}

function clearNotifs() { _notifCount = 0; updateNotifBadge() }
async function logout() { await getSupabase().auth.signOut(); window.location.href = 'index.html' }

// ─── Invite code ──────────────────────────────────────────────────────────────
async function getOrCreateInviteCode(userId) {
  const sb = getSupabase()
  const { data: profile } = await sb.from('profiles').select('invite_code').eq('id', userId).single()
  if (profile?.invite_code) return profile.invite_code
  const code = Math.random().toString(36).substring(2, 10).toUpperCase()
  await sb.from('profiles').update({ invite_code: code }).eq('id', userId)
  return code
}

function getInviteCodeFromUrl() {
  return new URLSearchParams(window.location.search).get('invite')
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function fmtElo(n) { return n > 0 ? `+${n}` : String(n) }
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}
