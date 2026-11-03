/* Alwi Hub: site behavior (library, search, dialogs, cookie notice, copy buttons) */
// Alwi Hub — vanilla JS port of the React site
let games = []
let query = ''
let category = 'All'
let visible = 12
let copiedTimeout = null

const ACCENTS = [
  '#E63946',
  '#2EC4B6',
  '#4CC9F0',
  '#F4A261',
  '#B5179E',
  '#52B788',
  '#F72585',
  '#3A86FF',
  '#FFB703',
  '#8338EC',
]

function accentFor(game) {
  const str = String(game.universeId || game.name)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return ACCENTS[hash % ACCENTS.length]
}

function placeLabel(game) {
  return game.placeId ? `Place ${game.placeId}` : `Universe ${game.universeId}`
}

// Fades/slides elements in once they scroll into view, then leaves them alone.
let revealObserver = null
function getRevealObserver() {
  if (!revealObserver) {
    if (!('IntersectionObserver' in window)) {
      return null
    }
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            revealObserver.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
  }
  return revealObserver
}

function observeReveal(elements) {
  const observer = getRevealObserver()
  if (!observer) {
    elements.forEach((node) => node.classList.add('is-visible'))
    return
  }
  elements.forEach((node) => observer.observe(node))
}

// Staggers a list's entrance, then clears the delay so later hovers stay snappy.
function staggerReveal(elements, stepMs = 55, maxSteps = 8) {
  elements.forEach((node, index) => {
    node.style.setProperty('--reveal-delay', `${Math.min(index, maxSteps) * stepMs}ms`)
    const clearDelay = (event) => {
      if (event.propertyName === 'opacity') {
        node.style.setProperty('--reveal-delay', '0ms')
        node.removeEventListener('transitionend', clearDelay)
      }
    }
    node.addEventListener('transitionend', clearDelay)
  })
  observeReveal(elements)
}

const el = {
  menuToggle: document.querySelector('.menu-toggle'),
  mainNav: document.querySelector('.main-nav'),
  navLinks: document.querySelectorAll('.main-nav a'),
  searchInput: document.querySelector('.search-box input'),
  resultCount: document.querySelector('.result-count'),
  categoryRow: document.querySelector('.category-row'),
  gameGrid: document.querySelector('.game-grid'),
  loadMoreWrap: document.querySelector('.load-more-wrap'),
  emptyState: document.querySelector('.empty-state'),
  librarySection: document.querySelector('.library-section'),
  copyDiscordBtn: document.querySelector('[data-copy-discord]'),
  copyLoaderBtn: document.querySelector('[data-copy-loader]'),
  discordOnline: document.querySelector('[data-discord-online]'),
  discordOffline: document.querySelector('[data-discord-offline]'),
  discordMembers: document.querySelector('[data-discord-members]'),
  discordNote: document.querySelector('[data-discord-note]'),
  communityIcon: document.querySelector('.community-icon'),
  privacyOpenBtns: document.querySelectorAll('[data-open-privacy]'),
  privacyBackdrop: document.querySelector('.policy-backdrop'),
  privacyClose: document.querySelector('.policy-close'),
  heroStatGames: document.querySelector('[data-stat-games]'),
  resetFiltersBtn: document.querySelector('[data-reset-filters]'),
}

// Pulls live player counts, current names, and a root place ID (for games
// whose placeId was blank) straight from Roblox's public games API. Browsers
// aren't allowed to read cross-origin responses from games.roblox.com unless
// the server opts in with an Access-Control-Allow-Origin header, and Roblox's
// API doesn't send one for arbitrary sites — so this quietly fails and the
// static numbers from games.json stay in place when that happens.
async function fetchLiveGameData(gamesList, { timeoutMs = 5000 } = {}) {
  const ids = gamesList.map((g) => g.universeId).filter(Boolean)
  if (!ids.length) return false

  const chunks = []
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100))
  }

  try {
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetch(`https://games.roblox.com/v1/games?universeIds=${chunk.join(',')}`, {
            signal: controller.signal,
          })
          if (!res.ok) throw new Error('Roblox games API unavailable')
          const body = await res.json()
          return body.data || []
        } finally {
          clearTimeout(timer)
        }
      }),
    )

    const liveById = new Map()
    chunkResults.flat().forEach((entry) => liveById.set(String(entry.id), entry))

    gamesList.forEach((game) => {
      const live = liveById.get(String(game.universeId))
      if (!live) return
      if (typeof live.playing === 'number') game.playing = live.playing
      if (!game.placeId && live.rootPlaceId) game.placeId = String(live.rootPlaceId)
      if (live.name) game.name = live.name
    })

    return true
  } catch (err) {
    return false
  }
}

function updateVisibleGameStats() {
  el.gameGrid.querySelectorAll('.game-card').forEach((card) => {
    const game = games.find((g) => String(g.universeId) === card.dataset.universeId)
    if (!game) return
    const sub = card.querySelector('.game-sub')
    if (sub) sub.textContent = `${game.category} · ${game.playing.toLocaleString()} playing`
  })
}

function startLiveRefresh() {
  setInterval(async () => {
    if (document.hidden) return
    const ok = await fetchLiveGameData(games)
    if (ok) updateVisibleGameStats()
    if (discordLoaded) loadDiscordStats()
  }, 90000)
}

function gameUrl(placeId, name) {
  return placeId
    ? `https://www.roblox.com/games/${placeId}`
    : `https://www.roblox.com/discover/?Keyword=${encodeURIComponent(name)}`
}

function getFilteredGames() {
  const normalized = query.trim().toLowerCase()
  return games.filter((game) => {
    const inCategory = category === 'All' || game.category === category
    const inSearch =
      !normalized ||
      game.name.toLowerCase().includes(normalized) ||
      game.universeId.includes(normalized) ||
      game.category.toLowerCase().includes(normalized)
    return inCategory && inSearch
  })
}

function renderCategories() {
  const categories = [
    'All',
    ...Array.from(new Set(games.map((g) => g.category).filter((category) => category.toLowerCase() !== 'all'))).sort(),
  ]
  el.categoryRow.innerHTML = ''
  categories.forEach((item, index) => {
    const button = document.createElement('button')
    button.style.setProperty('--tab-delay', `${index * 45}ms`)
    button.type = 'button'
    button.textContent = item
    if (item === category) button.classList.add('active')
    button.addEventListener('click', () => {
      category = item
      visible = 12
      render()
    })
    el.categoryRow.appendChild(button)
  })
}

function renderGames() {
  const filtered = getFilteredGames()
  el.resultCount.textContent = `${filtered.length} results`

  if (!filtered.length) {
    el.gameGrid.hidden = true
    el.loadMoreWrap.hidden = true
    el.emptyState.hidden = false
    return
  }

  el.emptyState.hidden = true
  el.gameGrid.hidden = false
  el.gameGrid.innerHTML = ''

  const slice = filtered.slice(0, visible)
  slice.forEach((game) => {
    const url = gameUrl(game.placeId, game.name)
    const accent = accentFor(game)
    const article = document.createElement('article')
    article.className = 'game-card'
    article.dataset.universeId = game.universeId
    article.style.setProperty('--accent', accent)
    article.innerHTML = `
      <img class="game-card-bg" src="${game.thumbnail}" alt="" loading="lazy" />
      <a class="game-card-link" href="${url}" target="_blank" rel="noreferrer">
        <div class="game-card-body">
          <h3>${game.name}</h3>
          <div class="game-meta">
            <span class="dot"></span>
            <span>${placeLabel(game)}</span>
          </div>
          <div class="game-sub">${game.category} · ${game.playing.toLocaleString()} playing</div>
        </div>
      </a>
      <div class="game-card-footer">
        <a class="game-card-action" href="${url}" target="_blank" rel="noreferrer">
          Link Game <span class="arrow" aria-hidden="true"></span>
        </a>
      </div>
    `
    el.gameGrid.appendChild(article)
  })

  staggerReveal(Array.from(el.gameGrid.querySelectorAll('.game-card')))

  if (visible < filtered.length) {
    el.loadMoreWrap.hidden = false
    el.loadMoreWrap.innerHTML = `
      <button class="load-more" type="button">
        Load more games
        <span>${visible} / ${filtered.length}</span>
      </button>
    `
    el.loadMoreWrap.querySelector('.load-more').addEventListener('click', () => {
      visible += 12
      renderGames()
    })
  } else {
    el.loadMoreWrap.hidden = true
  }
}

function render() {
  renderCategories()
  renderGames()
}

function initSearch() {
  el.searchInput.addEventListener('input', (event) => {
    query = event.target.value
    visible = 12
    renderGames()
  })
}

function initResetFilters() {
  el.resetFiltersBtn.addEventListener('click', () => {
    query = ''
    category = 'All'
    visible = 12
    el.searchInput.value = ''
    render()
  })
}

function initMenu() {
  el.menuToggle.addEventListener('click', () => {
    const isOpen = el.mainNav.classList.toggle('is-open')
    el.menuToggle.classList.toggle('is-open', isOpen)
    el.menuToggle.setAttribute('aria-expanded', String(isOpen))
  })
  el.navLinks.forEach((link) =>
    link.addEventListener('click', () => {
      el.mainNav.classList.remove('is-open')
      el.menuToggle.classList.remove('is-open')
      el.menuToggle.setAttribute('aria-expanded', 'false')
    }),
  )
}

function initPrivacyModal() {
  const backdrop = el.privacyBackdrop
  const dialog = backdrop.querySelector('[role="dialog"]')
  const tabs = backdrop.querySelectorAll('[data-policy-tab]')
  const panels = backdrop.querySelectorAll('[data-policy-panel]')
  let lastFocus = null

  const show = (name) => {
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.policyTab === name)))
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.policyPanel !== name
    })
    const heading = backdrop.querySelector(`[data-policy-panel="${name}"] h2`)
    if (heading) dialog.setAttribute('aria-labelledby', heading.id)
  }
  const open = (name) => {
    lastFocus = document.activeElement
    show(name)
    backdrop.hidden = false
    document.body.style.overflow = 'hidden'
    el.privacyClose.focus()
  }
  const close = () => {
    backdrop.hidden = true
    document.body.style.overflow = ''
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }

  document.querySelectorAll('[data-open-privacy]').forEach((btn) => btn.addEventListener('click', () => open('privacy')))
  document.querySelectorAll('[data-open-terms]').forEach((btn) => btn.addEventListener('click', () => open('terms')))
  document.querySelectorAll('[data-open-cookies]').forEach((btn) => btn.addEventListener('click', () => open('cookies')))
  tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.policyTab)))
  el.privacyClose.addEventListener('click', close)
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.hidden) close()
  })
}

function initCookieBanner() {
  const banner = document.querySelector('.cookie-banner')
  if (!banner) return
  const KEY = 'alwi-cookie-notice'
  try {
    if (localStorage.getItem(KEY) === 'closed') return
  } catch (err) {
    /* storage blocked: show the notice every visit */
  }
  banner.hidden = false
  banner.querySelector('[data-cookie-accept]').addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, 'closed')
    } catch (err) {
      /* storage blocked: notice will show again next visit */
    }
    banner.hidden = true
  })
}

function initFaq() {
  const items = document.querySelectorAll('.faq-list details')
  items.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return
      items.forEach((other) => {
        if (other !== item) other.open = false
      })
    })
  })
}

// Drag-to-compare, built on raw pointer events rather than a native
// <input type="range">: stretching a range thumb to fill its whole track is
// a common trick, but several mobile browsers won't recognize a touch as
// "grabbing the thumb" unless it lands very close to the thumb's reported
// center, which makes that approach unreliable for dragging anywhere across
// the image. Tracking pointerdown/move/up directly on the container works
// the same everywhere.
function initCompareSliders() {
  document.querySelectorAll('[data-compare]').forEach((wrap) => {
    const card = wrap.closest('.project-card')
    let dragging = false

    const setPos = (clientX) => {
      const rect = wrap.getBoundingClientRect()
      const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
      wrap.style.setProperty('--pos', `${pct}%`)
      wrap.setAttribute('aria-valuenow', String(Math.round(pct)))
    }

    const startDrag = (event) => {
      dragging = true
      wrap.classList.add('is-dragging')
      if (card) card.classList.add('is-dragging')
      if (wrap.setPointerCapture) {
        try {
          wrap.setPointerCapture(event.pointerId)
        } catch (err) {
          /* pointer capture not available for this pointer */
        }
      }
      setPos(event.clientX)
      event.preventDefault()
    }
    const moveDrag = (event) => {
      if (!dragging) return
      setPos(event.clientX)
    }
    const endDrag = () => {
      dragging = false
      wrap.classList.remove('is-dragging')
      if (card) card.classList.remove('is-dragging')
    }

    wrap.addEventListener('pointerdown', startDrag)
    wrap.addEventListener('pointermove', moveDrag)
    wrap.addEventListener('pointerup', endDrag)
    wrap.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', endDrag)

    wrap.addEventListener('keydown', (event) => {
      const current = parseFloat(wrap.style.getPropertyValue('--pos')) || 50
      if (event.key === 'ArrowLeft') {
        const next = Math.max(0, current - 5)
        wrap.style.setProperty('--pos', `${next}%`)
        wrap.setAttribute('aria-valuenow', String(Math.round(next)))
      } else if (event.key === 'ArrowRight') {
        const next = Math.min(100, current + 5)
        wrap.style.setProperty('--pos', `${next}%`)
        wrap.setAttribute('aria-valuenow', String(Math.round(next)))
      }
    })

    wrap.style.setProperty('--pos', '50%')
  })
}

// On Android, tries to open the GitHub/YouTube/Discord apps directly via an
// intent:// URI instead of just the mobile web page. Android normally does
// this on its own for links to verified app domains, but that auto-handoff
// often doesn't fire for links opened inside an embedded webview (like this
// page running inside the Claude app's preview), so this forces it. Desktop
// and iOS are untouched — intent:// is an Android-only scheme — and if the
// app isn't installed, Android falls back to the plain https:// link itself.
const ANDROID_APP_LINKS = {
  github: { host: 'github.com', path: '/Mainery-foxxie', package: 'com.github.android' },
  youtube: { host: 'www.youtube.com', path: '/@synaiz', package: 'com.google.android.youtube' },
  discord: { host: 'discord.gg', path: '/KPYspdpJvY', package: 'com.discord' },
}

function initAndroidAppLinks() {
  if (!/Android/i.test(navigator.userAgent)) return

  document.querySelectorAll('[data-app-link]').forEach((link) => {
    const config = ANDROID_APP_LINKS[link.dataset.appLink]
    if (!config) return
    const fallbackUrl = link.href

    link.addEventListener('click', (event) => {
      event.preventDefault()
      const intentUrl = `intent://${config.host}${config.path}#Intent;scheme=https;package=${config.package};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end;`
      window.location.href = intentUrl
    })
  })
}

// Swaps to a styled initial if the avatar can't load — this preview runs in
// a sandbox that blocks images from most outside hosts, so the GitHub
// avatar never loads here even though it loads fine on a normal host.
function initAvatarFallback() {
  document.querySelectorAll('[data-fallback-img]').forEach((img) => {
    img.addEventListener('error', () => {
      const frame = img.closest('.identity-frame')
      if (frame) frame.classList.add('is-broken')
    })
  })
}

function initCopyDiscord() {
  el.copyDiscordBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('https://discord.gg/KPYspdpJvY')
    } catch (err) {
      /* clipboard unavailable */
    }
    el.copyDiscordBtn.textContent = 'Invite copied'
    clearTimeout(copiedTimeout)
    copiedTimeout = setTimeout(() => {
      el.copyDiscordBtn.textContent = 'Copy invite'
    }, 1800)
  })
}

function initCopyEmail() {
  const btn = document.querySelector('[data-copy-email]')
  if (!btn) return
  btn.addEventListener('click', async (event) => {
    event.preventDefault()
    let copied = true
    try {
      await navigator.clipboard.writeText('lestilehendsy@gmail.com')
    } catch (err) {
      copied = false
    }
    if (!copied) {
      /* clipboard blocked (e.g. file:// viewer): fall back to a hidden textarea */
      const ta = document.createElement('textarea')
      ta.value = 'lestilehendsy@gmail.com'
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
      document.body.appendChild(ta)
      ta.select()
      try {
        copied = document.execCommand('copy')
      } catch (err) {
        copied = false
      }
      ta.remove()
    }
    if (!btn._original) btn._original = btn.innerHTML
    btn.textContent = copied ? 'Email copied: lestilehendsy@gmail.com' : 'Email: lestilehendsy@gmail.com'
    clearTimeout(btn._timeout)
    btn._timeout = setTimeout(() => {
      btn.innerHTML = btn._original
    }, 2600)
  })
}

function initCopyLoader() {
  const script =
    'loadstring(game:HttpGet("https://raw.githubusercontent.com/Mainery-foxxie/Main/refs/heads/main/Velocity%20X/Loader.lua"))()'
  el.copyLoaderBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(script)
    } catch (err) {
      /* clipboard unavailable */
    }
    const original = el.copyLoaderBtn.innerHTML
    el.copyLoaderBtn.textContent = 'Copied!'
    clearTimeout(el.copyLoaderBtn._timeout)
    el.copyLoaderBtn._timeout = setTimeout(() => {
      el.copyLoaderBtn.innerHTML = original
    }, 1800)
  })
}

let discordLoaded = false

function lazyLoadDiscordStats() {
  const section = document.querySelector('.discord-section')
  if (!section) return
  const load = () => {
    discordLoaded = true
    loadDiscordStats()
  }
  if (!('IntersectionObserver' in window)) {
    load()
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        io.disconnect()
        load()
      }
    },
    { rootMargin: '300px 0px' },
  )
  io.observe(section)
}

function loadDiscordStats() {
  fetch('https://discord.com/api/v10/invites/KPYspdpJvY?with_counts=true')
    .then((res) => {
      if (!res.ok) throw new Error('Discord stats unavailable')
      return res.json()
    })
    .then((data) => {
      const online = data.approximate_presence_count ?? 0
      const members = data.approximate_member_count ?? 0
      el.discordOnline.textContent = online.toLocaleString()
      el.discordOffline.textContent = Math.max(members - online, 0).toLocaleString()
      el.discordMembers.textContent = members.toLocaleString()
      el.discordNote.hidden = true

      const guild = data.guild
      if (guild && guild.icon && el.communityIcon) {
        const ext = guild.icon.startsWith('a_') ? 'gif' : 'png'
        const iconUrl = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=128`
        el.communityIcon.innerHTML = `<img src="${iconUrl}" alt="${guild.name || 'Discord server'} icon" />`
      }
    })
    .catch(() => {
      el.discordNote.hidden = false
    })
}

async function init() {
  const normalizeCategory = (game) => {
    const cat = String(game.category || '').trim()
    return { ...game, category: !cat || cat.toLowerCase() === 'all' ? 'Other' : cat }
  }

  if (typeof window !== 'undefined' && Array.isArray(window.__EMBEDDED_GAMES__)) {
    games = window.__EMBEDDED_GAMES__.map(normalizeCategory)
  } else {
    const res = await fetch('games.json')
    games = (await res.json()).map(normalizeCategory)
  }
  el.heroStatGames.textContent = games.length

  await fetchLiveGameData(games)

  initSearch()
  initMenu()
  initResetFilters()
  initPrivacyModal()
  initCookieBanner()
  initFaq()
  initCompareSliders()
  initAndroidAppLinks()
  initAvatarFallback()
  initCopyDiscord()
  initCopyLoader()
  initCopyEmail()
  lazyLoadDiscordStats()
  observeReveal(document.querySelectorAll('.reveal, .about-identity, .project-card'))
  render()
  startLiveRefresh()
}

document.addEventListener('DOMContentLoaded', init)
