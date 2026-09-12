/* ============================================================
   抖音下载工作台 webui3 · 设计原型交互
   说明：本文件为离线原型，不发起真实请求。
   真实接入时已用注释标出对应接口（POST /api/v1/download 等）。
   ============================================================ */
(function () {
  'use strict'

  /* ---------------- 工具 ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel) }
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined && text !== null) n.textContent = text
    return n
  }

  var URL_RE = /https?:\/\/[^\s"'<>）\)】]+/g
  var DOUYIN_HOST_RE = /(^|\.)douyin\.com$|(^\.)?iesdouyin\.com$/i

  function extractUrls(text) {
    var found = text.match(URL_RE) || []
    return found.map(function (u) { return u.replace(/[.,;!?\u3002\uff0c\uff1b\uff01]+$/, '') })
  }

  function isDouyinUrl(u) {
    try {
      var h = new URL(u).hostname
      return /(^|\.)douyin\.com$/i.test(h) || /(^|\.)iesdouyin\.com$/i.test(h)
    } catch (e) { return false }
  }

  /* 轻量识别：只依据路径形态给出“预计类型”，类型以提交后服务端解析为准 */
  function detectType(u) {
    try {
      var url = new URL(u)
      var host = url.hostname
      var p = url.pathname
      if (host === 'v.douyin.com') return { type: '短链接', sub: '提交后解析', key: 'short' }
      if (host === 'live.douyin.com') return { type: '直播', sub: '仅识别，不保证可下载', key: 'live' }
      if (/^\/(share\/)?video\//.test(p)) return { type: '视频', sub: '', key: 'video' }
      if (/^\/(share\/)?(note|gallery|slides)\//.test(p)) return { type: '图文', sub: '', key: 'gallery' }
      if (/^\/user\//.test(p)) return { type: '用户主页', sub: '', key: 'user' }
      if (/^\/(collection|mix)\//.test(p)) return { type: '合集', sub: '', key: 'mix' }
      if (/^\/(share\/)?music\//.test(p)) return { type: '音乐', sub: '', key: 'music' }
      return { type: '未知', sub: '提交后由服务端验证', key: 'unknown' }
    } catch (e) {
      return { type: '未知', sub: '无法解析', key: 'unknown' }
    }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n }

  function fmtClock(ts) {
    var d = new Date(ts)
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  }

  function fmtDateTime(unixSec) {
    var d = new Date(unixSec * 1000)
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  function timeAgo(ts) {
    var diff = Math.max(0, Date.now() - ts)
    var m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return m + ' 分钟前'
    var h = Math.floor(m / 60)
    if (h < 24) return h + ' 小时前'
    return Math.floor(h / 24) + ' 天前'
  }

  function shortUrl(u) {
    try {
      var url = new URL(u)
      var s = url.host + url.pathname
      return s.length > 52 ? s.slice(0, 52) + '…' : s
    } catch (e) { return u }
  }

  function makeId() {
    return Math.random().toString(16).slice(2, 8) + Math.random().toString(16).slice(2, 8)
  }

  /* ---------------- 演示数据：任务 ---------------- */
  /* 真实接入：
     - 任务列表 GET /api/v1/jobs
     - 单任务   GET /api/v1/jobs/{job_id}
     - 取消     POST /api/v1/jobs/{job_id}/cancel
     - 重试     POST /api/v1/jobs/{job_id}/retry（201 返回新 job_id，原任务保留） */
  function seedJobs(now) {
    return [
      {
        job_id: 'a1b2c3d4e5f6', url: 'https://www.douyin.com/user/MS4wLjABAAAA7J0Wv8kQv9x0y1z2',
        typeLabel: '用户主页', status: 'running',
        created_at: now - 4 * 60000,
        total: 36, success: 18, failed: 2, skipped: 3,
        error: null
      },
      {
        job_id: 'f6e5d4c3b2a1', url: 'https://www.douyin.com/collection/7341234567890123456',
        typeLabel: '合集', status: 'pending',
        created_at: now - 2 * 60000,
        total: null, success: 0, failed: 0, skipped: 0,
        error: null
      },
      {
        job_id: '0f1e2d3c4b5a', url: 'https://www.douyin.com/video/7346971177114611826',
        typeLabel: '视频', status: 'success',
        created_at: now - 26 * 60000,
        total: 1, success: 1, failed: 0, skipped: 0,
        error: null
      },
      {
        job_id: '9a8b7c6d5e4f', url: 'https://www.douyin.com/user/MS4wLjABAAAAkL3mN8pQrStUvWxY',
        typeLabel: '用户主页', status: 'failed',
        created_at: now - 52 * 60000,
        total: 24, success: 9, failed: 15, skipped: 0,
        error: 'Cookie 已失效：接口返回“验证失败”，请先重新获取 Cookie。'
      },
      {
        job_id: '1a2b3c4d5e6f', url: 'https://v.douyin.com/kXyZ1234/',
        typeLabel: '短链接 · 视频', status: 'cancelled',
        created_at: now - 90 * 60000,
        total: 12, success: 4, failed: 0, skipped: 0,
        error: null
      }
    ]
  }

  /* ---------------- 演示数据：历史 ---------------- */
  var AUTHORS = [
    { sec_uid: 'MS4wLjABAAAA001', name: '陈师傅的修表铺' },
    { sec_uid: 'MS4wLjABAAAA002', name: '小满与猫' },
    { sec_uid: 'MS4wLjABAAAA003', name: '阿灿在路上' },
    { sec_uid: 'MS4wLjABAAAA004', name: '半岛铁盒旧货店' },
    { sec_uid: 'MS4wLjABAAAA005', name: '深夜食堂复刻' },
    { sec_uid: 'MS4wLjABAAAA006', name: '山城棒棒军' }
  ]
  var TITLES = [
    '用三十年前的机芯修好一块停走的上海牌', '凌晨四点的猫食堂开饭了', '骑行 400 公里去追一场日出',
    '旧货市场淘到一台能开机的红灯收音机', '复刻《深夜食堂》的猫饭', '挑夫的一天，从一级台阶开始',
    '梅雨季的胶片相机防潮指南', '给猫搭了一个带暖气的纸箱屋', '凌晨的江边还有人在钓鱼',
    '拆开一台 90 年代的随身听', '菜市场里藏着的修车铺', '一碗小面的完整做法',
    '山城步道的 2000 级台阶', '猫把整卷卫生纸拆了', '修复一台漏电的老功放',
    '雨夜的路边摊', '用旧的 5 号电池还有电吗', '猫和扫地机器人的对峙'
  ]

  function seedHistory(now) {
    var items = []
    var day = 86400
    for (var i = 0; i < 58; i++) {
      var a = AUTHORS[i % 6 === 5 ? (i % 3) : (i % AUTHORS.length)]
      var t = TITLES[i % TITLES.length]
      var created = Math.floor((now - (2 + i * 1.7) * day * 1000) / 1000)
      var downloaded = Math.floor((now - (1 + i * 0.9) * day * 1000) / 1000)
      var awemeId = String(7340000000000000000 + i * 137000000000 + 11826).slice(0, 19)
      var isGallery = i % 5 === 3
      items.push({
        aweme_id: awemeId,
        aweme_type: isGallery ? 'gallery' : 'video',
        title: t + (i >= TITLES.length ? '（第 ' + (Math.floor(i / TITLES.length) + 1) + ' 期）' : ''),
        author_name: a.name,
        author_sec_uid: a.sec_uid,
        create_time: created,
        download_time: downloaded,
        file_path: 'Downloaded/' + a.name + '/post/' +
          new Date(created * 1000).toISOString().slice(0, 10) + '_' + t.slice(0, 12) + '_' + awemeId.slice(-4) +
          (isGallery ? '/img_01.jpg' : '/video.mp4'),
        cover_urls: [i % 11 === 7 ? '' : 'assets/cover-' + (i % 8) + '.svg'],
        job_id: ['a1b2c3d4e5f6', '0f1e2d3c4b5a', '9a8b7c6d5e4f'][i % 3]
      })
    }
    return items
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    jobs: seedJobs(Date.now()),
    history: seedHistory(Date.now()),
    route: 'download',
    devData: 'populated',
    pageLastOk: { download: Date.now(), jobs: Date.now(), history: Date.now(), settings: Date.now() },
    jobsFilter: 'all',
    devState: 'normal',       // normal | loading | error | offline
    cookie: 'unknown',        // unknown | ok | stale
    health: 'unknown',
    lastNetOk: Date.now(),
    pollInterval: 2,
    submitting: false,
    keptUrls: [],             // 下载页已确认保留的链接
    hist: { page: 1, size: 50, search: '', searchField: 'author', type: 'all', from: '', to: '', sort: 'download_time', job: '' },
    timer: null
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, kind) {
    var box = $('#toasts')
    var t = el('div', 'toast ' + (kind || ''))
    t.textContent = msg
    box.appendChild(t)
    setTimeout(function () {
      t.classList.add('leaving')
      setTimeout(function () { t.remove() }, 280)
    }, 3400)
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme(theme) {
    document.body.dataset.theme = theme
    var btn = $('#themeToggle')
    btn.textContent = theme === 'dark' ? '浅色' : '深色'
    btn.setAttribute('aria-label', theme === 'dark' ? '切换浅色外观' : '切换深色外观')
    try { localStorage.setItem('webui3-theme', theme) } catch (e) {}
  }
  $('#themeToggle').addEventListener('click', function () {
    applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark')
  })
  ;(function initTheme() {
    var saved = null
    try { saved = localStorage.getItem('webui3-theme') } catch (e) {}
    if (saved === 'light' || saved === 'dark') { applyTheme(saved); return }
    applyTheme('dark')
  })()

  /* ---------------- 路由 ---------------- */
  var ROUTES = ['download', 'jobs', 'history', 'settings']
  function currentRoute() {
    var h = (location.hash || '#download').replace('#', '')
    return ROUTES.indexOf(h) >= 0 ? h : 'download'
  }
  function renderRoute() {
    state.route = currentRoute()
    ROUTES.forEach(function (r) {
      $('#page-' + r).hidden = r !== state.route
    })
    $$('.top-nav a').forEach(function (a) {
      var active = a.dataset.route === state.route
      a.classList.toggle('is-active', active)
      if (active) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
  }
  window.addEventListener('hashchange', function () { renderRoute(); renderBanners() })

  /* ---------------- 顶部与胶囊 ---------------- */
  function isLive(job) { return job.status === 'running' || job.status === 'pending' }

  function renderChrome() {
    var liveN = state.jobs.filter(isLive).length
    var ind = $('#navJobsIndicator')
    ind.classList.toggle('is-live', liveN > 0)
    var cnt = $('#navJobsCount')
    cnt.hidden = liveN === 0
    cnt.textContent = String(liveN)

    var netPill = $('#netPill')
    var netDot = $('#netDot')
    var netText = $('#netPillText')
    var netTime = $('#netPillTime')
    netPill.classList.remove('is-ok', 'is-stale')
    if (state.devState === 'normal' && state.health === 'ok') {
      netDot.className = 'dot dot-ok'
      netText.textContent = '服务正常'
      netTime.textContent = fmtClock(state.lastNetOk)
      netPill.classList.add('is-ok')
    } else if (state.devState === 'error' || state.devState === 'offline') {
      netDot.className = 'dot dot-failed'
      netText.textContent = state.devState === 'offline' ? '服务离线' : '服务异常'
      netTime.textContent = ' · 最后联通 ' + fmtClock(state.lastNetOk)
    } else {
      netDot.className = 'dot dot-unknown'
      netText.textContent = '服务未检查'
      netTime.textContent = ''
    }

    var cp = $('#cookiePill')
    cp.hidden = state.cookie !== 'stale'
  }

  /* ---------------- 下载页 ---------------- */
  var dlInput = $('#dlInput')

  function parseInput() {
    var raw = extractUrls(dlInput.value)
    var rows = raw.map(function (u) {
      var d = detectType(u)
      return { url: u, valid: isDouyinUrl(u), type: d.type, typeSub: d.sub, key: d.key }
    })
    var seen = {}
    rows.forEach(function (r) { r.dup = false })
    var kept = []
    if (state.keptUrls.length) {
      /* 已确认的保留集合以“加入队列”时的快照顺序为准 */
      var inputMap = {}
      rows.forEach(function (r) { inputMap[r.url] = r })
      state.keptUrls.forEach(function (u) {
        if (inputMap[u]) kept.push(inputMap[u])
      })
      rows = kept.length ? kept : rows
    }
    var count = 0
    rows.forEach(function (r) {
      if (r.valid && !r.dup) count++
    })
    return { rows: rows, count: count, invalid: rows.filter(function (r) { return !r.valid }) }
  }

  function defaultDedupe(rows) {
    /* 未确认去重时按首次出现去重，仅用于计数展示 */
    var seen = {}
    var out = []
    rows.forEach(function (r) {
      if (!r.valid) { out.push(r); return }
      if (seen[r.url]) { r.dup = true; out.push(r); return }
      seen[r.url] = true
      out.push(r)
    })
    return out
  }

  function renderDl() {
    var parsed = parseInput()
    var rows = state.keptUrls.length ? parsed.rows : defaultDedupe(parsed.rows)
    var chips = $('#dlChips')
    chips.innerHTML = ''
    var validRows = rows.filter(function (r) { return r.valid })
    var submitCount = state.keptUrls.length
      ? validRows.filter(function (r) { return !r._removed }).length
      : validRows.filter(function (r) { return !r.dup }).length

    if (rows.length) {
      chips.hidden = false
      var head = el('div', 'chips-head')
      var dupN = rows.filter(function (r) { return r.dup }).length
      head.textContent = '识别到 ' + rows.length + ' 条链接' +
        (dupN ? ' · 已去重 ' + dupN + ' 条' : '') +
        (state.keptUrls.length ? ' · 可移除后重新计数' : '')
      chips.appendChild(head)
      rows.forEach(function (r) {
        if (r._removed) return
        var c = el('div', 'chip')
        if (r.dup) { c.style.opacity = '.55' }
        var badge = el('span', 'badge-type' + (r.key === 'unknown' ? ' unknown' : ''), r.type)
        c.appendChild(badge)
        c.appendChild(el('span', 'chip-url', r.valid ? shortUrl(r.url) : r.url))
        if (r.typeSub) c.appendChild(el('span', 'dup-flag', r.typeSub))
        if (!r.valid) {
          var bad = el('span', 'dup-flag', '非抖音链接')
          bad.style.color = 'var(--failed)'
          bad.style.borderColor = 'color-mix(in srgb, var(--failed) 40%, var(--line))'
          c.appendChild(bad)
        } else if (r.dup) {
          c.appendChild(el('span', 'dup-flag', '重复'))
        }
        if (r.valid && !r.dup) {
          var rm = el('button', 'chip-keep', '移除')
          rm.type = 'button'
          rm.setAttribute('aria-label', '从本次提交中移除 ' + r.url)
          rm.addEventListener('click', function () {
            /* 原型行为：从输入框删掉该行 */
            var lines = dlInput.value.split('\n').filter(function (line) {
              return line.indexOf(r.url) === -1
            })
            dlInput.value = lines.join('\n').replace(/\n{2,}/g, '\n').replace(/^\n+/, '')
            state.keptUrls = state.keptUrls.filter(function (u) { return u !== r.url })
            renderDl()
          })
          c.appendChild(rm)
        }
        chips.appendChild(c)
      })
    } else {
      chips.hidden = true
    }

    $('#dlCount').textContent = String(submitCount)
    $('#dlSubmit').disabled = submitCount === 0 || state.submitting || (state.devState === 'offline' || state.devState === 'error')
    renderNotice(parsed)
  }

  function renderNotice(parsed) {
    var box = $('#dlNotice')
    box.innerHTML = ''
    box.hidden = true
    if (state.devState === 'offline') {
      box.hidden = false
      var n = el('div', 'notice-inline')
      n.appendChild(el('span', null, '服务离线，无法提交。'))
      var go = el('a', null, '前往设置检查服务')
      go.href = '#settings'
      n.appendChild(go)
      box.appendChild(n)
      return
    }
    if (parsed.invalid.length) {
      box.hidden = false
      var n2 = el('div', 'notice-inline')
      n2.appendChild(document.createTextNode(
        parsed.invalid.length + ' 条非抖音域名，已自动忽略:'
      ))
      parsed.invalid.slice(0, 3).forEach(function (r) {
        n2.appendChild(el('div', null, r.url))
      })
      box.appendChild(n2)
    }
  }

  dlInput.addEventListener('input', function () {
    state.keptUrls = []
    renderDl()
  })

  $('#fillVideo').addEventListener('click', function () {
    dlInput.value = 'https://v.douyin.com/kXyZ1234/'
    state.keptUrls = []
    renderDl()
    dlInput.focus()
  })
  $('#fillMulti').addEventListener('click', function () {
    dlInput.value = [
      'https://v.douyin.com/kXyZ1234/',
      '5.31 复制打开抖音，看看【陈师傅的修表铺的作品】https://www.douyin.com/video/7346971177114611826',
      'https://www.douyin.com/user/MS4wLjABAAAA7J0Wv8kQv9x0y1z2',
      'https://www.douyin.com/collection/7341234567890123456',
      'https://v.douyin.com/kXyZ1234/'
    ].join('\n')
    state.keptUrls = []
    renderDl()
    dlInput.focus()
  })

  function submitDownload() {
    if (state.submitting || state.devState === 'offline' || state.devState === 'error') return
    var parsed = parseInput()
    var rows = state.keptUrls.length ? parsed.rows.filter(function (r) { return !r._removed })
      : defaultDedupe(parsed.rows)
    var toSubmit = rows.filter(function (r) { return r.valid && !r.dup })
    if (!toSubmit.length) return

    /* 重复确认：原型在 chips 中直接给出“移除”，此处若检测到重复则先做快照确认 */
    var dupN = rows.filter(function (r) { return r.dup }).length

    state.submitting = true
    $('#devData').disabled = true
    renderDl()

    /* 真实接入：对每条链接调用 POST /api/v1/download {url}；
       逐条串行提交，间隔至少 2 秒；部分失败时保留失败行和原因。
       原型用定时器模拟“每 2 秒一条”的节奏。 */
    var i = 0
    function next() {
      if (state.devState === 'offline' || state.devState === 'error') {
        state.submitting = false
        $('#devData').disabled = false
        dlInput.value = toSubmit.slice(i).map(function (row) { return row.url }).join('\n')
        toast('提交中断，未提交的链接已保留', 'warn')
        renderDl()
        return
      }
      if (i >= toSubmit.length) {
        state.submitting = false
        $('#devData').disabled = false
        state.keptUrls = []
        renderDl()
        return
      }
      var item = toSubmit[i]
      var job = {
        job_id: makeId().slice(0, 12),
        url: item.url,
        typeLabel: item.type + (item.typeSub ? ' · ' + item.typeSub : ''),
        status: 'pending',
        created_at: Date.now(),
        total: null, success: 0, failed: 0, skipped: 0,
        error: null,
        _simPlan: 'willRun'
      }
      state.jobs.unshift(job)
      i++
      var remain = toSubmit.length - i
      toast('已排队：' + item.type + (i === 1 && dupN ? '（去重 ' + dupN + ' 条）' : '') +
        (remain ? '，剩余 ' + remain + ' 条间隔 2 秒提交' : ''), 'ok')
      renderAll()
      if (i < toSubmit.length) setTimeout(next, 2000)
      else {
        state.submitting = false
        $('#devData').disabled = false
        setTimeout(function () {
          state.keptUrls = []
          dlInput.value = ''
          renderDl()
        }, 400)
      }
    }
    next()
  }

  $('#dlForm').addEventListener('submit', function (e) {
    e.preventDefault()
    submitDownload()
  })
  dlInput.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submitDownload()
    }
  })

  /* ---------------- 最近任务横带 ---------------- */
  function fmtCounts(job) {
    var parts = []
    parts.push('总数 ' + (job.total === null || job.total === undefined ? '获取中' : job.total))
    parts.push('成功 ' + job.success)
    if (job.failed) parts.push('失败 ' + job.failed)
    if (job.skipped) parts.push('跳过 ' + job.skipped)
    return parts.join(' / ')
  }

  function renderRecent() {
    var row = $('#recentRow')
    row.innerHTML = ''
    var jobs = state.jobs.slice(0, 6)
    $('#recentEmpty').hidden = jobs.length > 0
    jobs.forEach(function (job) {
      var card = el('a', 'mini-card')
      card.href = '#jobs'
      var top = el('div', 'mini-top')
      top.appendChild(statusBadge(job.status))
      top.appendChild(el('span', 'mini-meta', timeAgo(job.created_at)))
      card.appendChild(top)
      card.appendChild(el('div', 'mini-title', job.typeLabel + ' · ' + shortUrl(job.url)))
      card.appendChild(el('div', 'mini-meta', fmtCounts(job)))
      var bar = el('div', 'mini-bar')
      var i = el('i')
      if (job.total) {
        var done = job.success + job.failed + job.skipped
        i.style.width = Math.min(100, Math.round(done / job.total * 100)) + '%'
      } else {
        i.style.width = '0%'
        bar.classList.add('indet')
      }
      bar.appendChild(i)
      card.appendChild(bar)
      if (isLive(job)) {
        var ops = el('div', 'mini-actions')
        var cancel = el('button', 'btn-ghost', '取消')
        cancel.type = 'button'
        cancel.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          cancelJob(job.job_id)
        })
        ops.appendChild(cancel)
        card.appendChild(ops)
      }
      row.appendChild(card)
    })
  }

  /* ---------------- 任务中心 ---------------- */
  var STATUS_LABEL = {
    pending: '排队中', running: '进行中', success: '已完成',
    failed: '失败', cancelled: '已取消'
  }
  function statusBadge(status) {
    var b = el('span', 'badge badge-' + status)
    b.appendChild(el('span', 'dot dot-' + status))
    b.appendChild(el('span', null, STATUS_LABEL[status] || status))
    return b
  }

  function jobMatches(job, filter) {
    if (filter === 'all') return true
    if (filter === 'live') return isLive(job)
    return job.status === filter
  }

  function renderJobs() {
    var list = $('#jobsList')
    list.innerHTML = ''

    $$('#jobsTabs .tab').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.filter === state.jobsFilter))
    })

    /* 计数 */
    var counts = { all: state.jobs.length, live: 0, success: 0, failed: 0, cancelled: 0 }
    state.jobs.forEach(function (j) {
      if (isLive(j)) counts.live++
      if (counts[j.status] !== undefined) counts[j.status]++
    })
    Object.keys(counts).forEach(function (k) {
      var n = $('[data-tab-count="' + k + '"]')
      if (n) n.textContent = String(counts[k])
    })

    if (state.devState === 'loading') {
      for (var s = 0; s < 3; s++) list.appendChild(el('div', 'skeleton-card'))
      $('#jobsEmpty').hidden = true
      return
    }

    var jobs = state.jobs.filter(function (j) { return jobMatches(j, state.jobsFilter) })
    $('#jobsEmpty').hidden = jobs.length > 0
    jobs.forEach(function (job) { list.appendChild(jobCard(job)) })
  }

  function jobCard(job) {
    var wrap = el('article', 'job-card')
    var head = el('div', 'job-head')
    head.appendChild(statusBadge(job.status))
    head.appendChild(el('span', 'job-id', '#' + job.job_id))

    var main = el('div', 'job-main')
    var trow = el('div', 'job-title-row')
    trow.appendChild(el('h3', 'job-title', job.typeLabel))
    main.appendChild(trow)
    main.appendChild(el('div', 'job-url', job.url))

    var meta = el('div', 'job-meta')
    meta.appendChild(el('span', 'job-counts', fmtCounts(job)))
    meta.appendChild(el('span', 'job-time', '创建 ' + timeAgo(job.created_at)))
    main.appendChild(meta)

    if (job.status === 'running' || (job.status === 'pending')) {
      var prog = el('div', 'job-progress' + (job.total ? '' : ' indet'))
      var bar = el('div', 'pbar')
      var fill = el('i')
      var done = job.success + job.failed + job.skipped
      if (job.total) fill.style.width = Math.min(100, Math.round(done / job.total * 100)) + '%'
      bar.appendChild(fill)
      prog.appendChild(bar)
      prog.appendChild(el('span', 'pct', job.total ? Math.min(100, Math.round(done / job.total * 100)) + '%' : ''))
      main.appendChild(prog)
    }

    if (job.status === 'failed' && job.error) {
      var err = el('div', 'job-error')
      err.appendChild(el('div', null, job.error))
      if (job.error.indexOf('Cookie') !== -1) {
        var hint = el('div', 'fix-hint')
        hint.innerHTML = ''
        hint.appendChild(document.createTextNode('修复命令: '))
        hint.appendChild(el('code', null, 'python -m tools.cookie_fetcher --config config.yml'))
        hint.appendChild(document.createTextNode(' '))
        var a = el('a', null, '查看设置页指引')
        a.href = '#settings'
        hint.appendChild(a)
        err.appendChild(hint)
      }
      main.appendChild(err)
    }
    head.appendChild(main)

    var ops = el('div', 'job-ops')
    if (isLive(job)) {
      var cancel = el('button', 'btn-ghost sm danger', job._cancelling ? '正在取消…' : '取消')
      cancel.disabled = !!job._cancelling || state.devState === 'offline' || state.devState === 'error'
      cancel.addEventListener('click', function () { cancelJob(job.job_id) })
      ops.appendChild(cancel)
    } else {
      var retry = el('button', 'btn-ghost sm', '重试')
      retry.disabled = state.devState === 'offline' || state.devState === 'error'
      retry.addEventListener('click', function () { retryJob(job.job_id) })
      var again = el('button', 'btn-ghost sm', '再次下载')
      again.addEventListener('click', function () {
        dlInput.value = job.url
        state.keptUrls = []
        location.hash = '#download'
        renderDl()
        dlInput.focus()
      })
      var hist = el('button', 'btn-ghost sm', '下载记录')
      hist.addEventListener('click', function () {
        state.hist.job = job.job_id
        state.hist.page = 1
        syncHistForm()
        location.hash = '#history'
        renderHistory()
      })
      ops.appendChild(retry)
      ops.appendChild(again)
      ops.appendChild(hist)
    }
    if (job.status === 'failed') {
      ops.appendChild(el('span', 'job-note', '重试整个任务（原 URL），并非只重试失败的作品'))
    }
    if (job.status === 'cancelled') {
      ops.appendChild(el('span', 'job-note', '已处理 ' + (job.success + job.failed + job.skipped) + ' 条后取消'))
    }
    ops.appendChild(el('span', 'job-note', 'ID ' + job.job_id))
    wrap.appendChild(head)
    wrap.appendChild(ops)
    return wrap
  }

  /* 真实接入：POST /api/v1/jobs/{job_id}/cancel；409 表示已进入终态，需重新拉取 */
  function cancelJob(id) {
    var job = null
    state.jobs.forEach(function (j) { if (j.job_id === id) job = j })
    if (!job || !isLive(job) || state.devState === 'offline' || state.devState === 'error') return
    job._cancelling = true
    renderAll()
    setTimeout(function () {
      job._cancelling = false
      job.status = 'cancelled'
      toast('已取消，保留已处理计数', 'warn')
      renderAll()
    }, 600)
  }

  /* 真实接入：POST /api/v1/jobs/{job_id}/retry → 201 新 job_id，原任务保留 */
  function retryJob(id) {
    var job = null
    state.jobs.forEach(function (j) { if (j.job_id === id) job = j })
    if (!job || isLive(job) || state.devState === 'offline' || state.devState === 'error') return
    var nj = {
      job_id: makeId().slice(0, 12),
      url: job.url,
      typeLabel: job.typeLabel,
      status: 'pending',
      created_at: Date.now(),
      total: null, success: 0, failed: 0, skipped: 0,
      error: null,
      _simPlan: 'willRun'
    }
    state.jobs.unshift(nj)
    toast('已创建重试任务 #' + nj.job_id, 'ok')
    renderAll()
  }

  $('#jobsTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab')
    if (!b) return
    state.jobsFilter = b.dataset.filter
    $$('#jobsTabs .tab').forEach(function (t) {
      var on = t === b
      t.classList.toggle('is-active', on)
      t.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    renderJobs()
  })

  $('#jobsRefresh').addEventListener('click', function () {
    setDevState('normal')
    toast('演示任务列表已恢复', 'ok')
  })
  $('#globalRetry').addEventListener('click', function () { setDevState('normal') })
  $('#netRetry').addEventListener('click', function () {
    setDevState('normal')
    toast('重试成功，已恢复轮询', 'ok')
  })

  function renderBanners() {
    var liveN = state.jobs.filter(isLive).length
    var poll = $('#pollBanner')
    if (liveN > 0 && state.devState === 'normal') {
      poll.hidden = false
      $('#pollBannerText').textContent = liveN + ' 个任务进行中，每 2 秒更新一次 · 最后更新 ' + fmtClock(state.lastNetOk)
    } else {
      poll.hidden = true
    }
    var broken = state.devState === 'error' || state.devState === 'offline'
    var hasContent = state.route === 'settings' ? state.devData === 'populated'
      : (state.route === 'history' ? state.history.length > 0 : state.jobs.length > 0)
    var fullPage = broken && !hasContent
    ROUTES.forEach(function (route) {
      $('#page-' + route).hidden = route !== state.route || fullPage
    })
    $('#global-state').hidden = !fullPage
    $('#netBanner').hidden = !broken || fullPage
    if (fullPage) {
      var offline = state.devState === 'offline'
      $('#globalStateTitle').textContent = offline ? '连接不到下载服务' : '暂时无法获取数据'
      $('#globalStateMessage').textContent = offline
        ? '请确认服务已启动、地址和端口正确，再尝试连接。输入内容仍会保留。'
        : '首次请求失败，当前没有可展示的数据。请重新加载。'
      $('#globalRetry').textContent = offline ? '重新连接' : '重新加载'
    } else if (broken) {
      $('#netBannerText').textContent = state.devState === 'offline'
        ? '服务离线，展示最后一份数据。' : '网络请求失败，展示最后一份数据。'
      var updated = state.pageLastOk[state.route]
      $('#netBannerTime').textContent = updated ? '最后成功 ' + fmtClock(updated) : '尚无成功获取记录'
    }
  }

  /* ---------------- 历史页 ---------------- */
  // 接入 GET /api/v1/downloads：搜索只传 author 或 title 二选一，不能模拟 OR 查询。
  function histFiltered() {
    var h = state.hist
    var items = state.history.slice()
    if (h.search) {
      var q = h.search.toLowerCase()
      items = items.filter(function (it) {
        var value = h.searchField === 'title' ? it.title : it.author_name
        return String(value || '').toLowerCase().indexOf(q) !== -1
      })
    }
    if (h.type !== 'all') items = items.filter(function (it) { return it.aweme_type === h.type })
    if (h.job) items = items.filter(function (it) { return it.job_id === h.job })
    if (h.from) {
      var f = new Date(h.from + 'T00:00:00+08:00').getTime() / 1000
      items = items.filter(function (it) { return it.create_time >= f })
    }
    if (h.to) {
      var t = new Date(h.to + 'T23:59:59+08:00').getTime() / 1000
      items = items.filter(function (it) { return it.create_time <= t })
    }
    items.sort(function (a, b) {
      return h.sort === 'create_time' ? b.create_time - a.create_time : b.download_time - a.download_time
    })
    return items
  }

  function renderHistory() {
    var wrap = $('.hist-table-wrap')
    var body = $('#histBody')
    body.innerHTML = ''
    if (state.devState === 'loading') {
      wrap.hidden = false
      for (var i = 0; i < 5; i++) {
        var tr = el('tr')
        var td = el('td')
        td.colSpan = 6
        var sk = el('div', 'skeleton')
        sk.style.height = '42px'
        td.appendChild(sk)
        tr.appendChild(td)
        body.appendChild(tr)
      }
      $('#histEmpty').hidden = true
      renderPager(0)
      renderAuthors()
      return
    }
    var items = histFiltered()
    var total = items.length
    $('#histTotal').textContent = '共 ' + total + ' 条'
    var pages = Math.max(1, Math.ceil(total / state.hist.size))
    if (state.hist.page > pages) state.hist.page = pages
    var start = (state.hist.page - 1) * state.hist.size
    var pageItems = items.slice(start, start + state.hist.size)

    var empty = $('#histEmpty')
    empty.hidden = total > 0
    wrap.hidden = total === 0

    pageItems.forEach(function (it) {
      var tr = el('tr')
      var tdCover = el('td')
      if (it.cover_urls[0]) {
        var img = el('img', 'cover')
        img.src = it.cover_urls[0]
        img.alt = it.title
        img.loading = 'lazy'
        img.addEventListener('error', function () {
          var fb = el('div', 'cover-fallback', '无封面')
          img.replaceWith(fb)
        }, { once: true })
        tdCover.appendChild(img)
      } else {
        tdCover.appendChild(el('div', 'cover-fallback', '无封面'))
      }
      tr.appendChild(tdCover)

      var tdTitle = el('td')
      tdTitle.appendChild(el('span', 'cell-title', it.title))
      var authorBox = el('span', 'cell-author')
      var ab = el('button', 'author-link', it.author_name)
      ab.type = 'button'
      ab.style.padding = '0'
      ab.addEventListener('click', function () {
        state.hist.searchField = 'author'
        state.hist.search = it.author_name
        state.hist.page = 1
        syncHistForm()
        renderHistory()
      })
      authorBox.appendChild(ab)
      tdTitle.appendChild(authorBox)
      tr.appendChild(tdTitle)

      var tdType = el('td')
      tdType.appendChild(el('span', 'badge-type', it.aweme_type === 'video' ? '视频' : '图文'))
      tr.appendChild(tdType)

      tr.appendChild(el('td', 'cell-time', fmtDateTime(it.create_time)))
      tr.appendChild(el('td', 'cell-time', fmtDateTime(it.download_time)))

      var tdPath = el('td')
      var pb = el('button', 'btn-ghost sm', '位置')
      pb.type = 'button'
      pb.addEventListener('click', function () { openPathDialog(it) })
      tdPath.appendChild(pb)
      tr.appendChild(tdPath)

      body.appendChild(tr)
    })

    renderPager(total)
    renderAuthors()
  }

  function renderPager(total) {
    var pages = Math.max(1, Math.ceil(total / state.hist.size))
    $('#pageInfo').textContent = '第 ' + state.hist.page + ' 页 / 共 ' + pages + ' 页'
    $('#pagePrev').disabled = state.hist.page <= 1
    $('#pageNext').disabled = state.hist.page >= pages
  }

  $('#pagePrev').addEventListener('click', function () {
    if (state.hist.page > 1) { state.hist.page--; renderHistory() }
  })
  $('#pageNext').addEventListener('click', function () {
    state.hist.page++
    renderHistory()
  })
  $('#pageSize').addEventListener('change', function (e) {
    state.hist.size = parseInt(e.target.value, 10) || 50
    state.hist.page = 1
    renderHistory()
  })

  $('#histFilters').addEventListener('submit', function (e) {
    e.preventDefault()
    state.hist.searchField = $('#fSearchField').value
    state.hist.search = $('#fSearch').value.trim()
    state.hist.from = $('#fFrom').value
    state.hist.to = $('#fTo').value
    state.hist.sort = $('#fSort').value
    state.hist.job = $('#fJob').value.trim()
    state.hist.page = 1
    renderHistory()
  })
  $('#histReset').addEventListener('click', function () {
    state.hist = { page: 1, size: state.hist.size, search: '', searchField: 'author', type: 'all', from: '', to: '', sort: 'download_time', job: '' }
    syncHistForm()
    renderHistory()
  })
  $('#fJobClear').addEventListener('click', function () {
    state.hist.job = ''
    state.hist.page = 1
    syncHistForm()
    renderHistory()
  })
  $('#fType').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn')
    if (!b) return
    $$('#fType .seg-btn').forEach(function (x) { x.classList.toggle('is-active', x === b) })
    state.hist.type = b.dataset.type
    state.hist.page = 1
    renderHistory()
  })

  $('#fSearchField').addEventListener('change', function () {
    state.hist.searchField = $('#fSearchField').value
    state.hist.search = $('#fSearch').value.trim()
    state.hist.page = 1
    syncHistForm()
    renderHistory()
  })

  function syncHistForm() {
    $('#fSearchField').value = state.hist.searchField
    $('#fSearch').placeholder = state.hist.searchField === 'title' ? '搜索标题…' : '搜索作者…'
    $('#fSearch').value = state.hist.search
    $('#fFrom').value = state.hist.from
    $('#fTo').value = state.hist.to
    $('#fSort').value = state.hist.sort
    $('#fJob').value = state.hist.job
    $('#fieldJob').hidden = false
    $$('#fType .seg-btn').forEach(function (x) {
      x.classList.toggle('is-active', x.dataset.type === state.hist.type)
    })
  }

  function renderAuthors() {
    /* 真实接入：GET /api/v1/downloads/authors?days=30&limit=20，
       是近 30 天独立统计，不能用当前页结果冒充。原型按全量演示数据聚合。 */
    var map = {}
    state.history.filter(function (it) {
      return it.download_time >= Date.now() / 1000 - 30 * 86400
    }).forEach(function (it) {
      map[it.author_name] = (map[it.author_name] || 0) + 1
    })
    var list = Object.keys(map).map(function (k) { return { name: k, n: map[k] } })
    list.sort(function (a, b) { return b.n - a.n })
    var ol = $('#authorsList')
    ol.innerHTML = ''
    list.slice(0, 8).forEach(function (a, idx) {
      var li = el('li')
      var b = el('button', null, a.name)
      b.type = 'button'
      b.addEventListener('click', function () {
        state.hist.searchField = 'author'
        state.hist.search = a.name
        state.hist.page = 1
        syncHistForm()
        renderHistory()
      })
      li.appendChild(b)
      li.appendChild(el('span', 'count', a.n + ' 条'))
      ol.appendChild(li)
    })
    $('#topAuthors').querySelector('summary').textContent =
      '近 30 天下载最多作者（点击查看 · ' + Math.min(8, list.length) + ' 位）'
  }

  /* ---------------- 路径弹窗 ---------------- */
  var pathDialog = $('#pathDialog')
  function openPathDialog(it) {
    $('#pathDialogText').textContent = it.file_path
    $('#pathDialogHint').hidden = true
    if (typeof pathDialog.showModal === 'function') pathDialog.showModal()
  }
  $('#pathClose').addEventListener('click', function () { pathDialog.close() })
  $('#pathCopy').addEventListener('click', function () {
    var text = $('#pathDialogText').textContent
    function fallback() {
      $('#pathDialogHint').hidden = false
      var range = document.createRange()
      range.selectNodeContents($('#pathDialogText'))
      var sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('路径已复制', 'ok')
      }, function () { fallback() })
    } else {
      fallback()
    }
  })
  pathDialog.addEventListener('click', function (e) {
    if (e.target === pathDialog) pathDialog.close()
  })

  /* ---------------- 设置页 ---------------- */
  function renderSettings() {
    var dot = $('#setCookieDot')
    var text = $('#setCookieText')
    var pill = $('#setCookiePill')
    pill.classList.remove('is-ok', 'is-stale')
    if (state.cookie === 'ok') {
      dot.className = 'dot dot-ok'
      text.textContent = '有效'
      pill.classList.add('is-ok')
      $('#cookieFix').hidden = true
    } else if (state.cookie === 'stale') {
      dot.className = 'dot dot-failed'
      text.textContent = '已失效'
      pill.classList.add('is-stale')
      $('#cookieFix').hidden = false
    } else {
      dot.className = 'dot dot-unknown'
      text.textContent = '未检测'
      $('#cookieFix').hidden = true
    }
    var hs = $('#healthState')
    hs.className = 'status-inline'
    if (state.health === 'ok' && state.devState === 'normal') {
      hs.textContent = '正常 · ' + fmtClock(state.lastNetOk)
      hs.classList.add('ok')
    } else if (state.devState === 'offline') {
      hs.textContent = '不可达'
      hs.classList.add('bad')
    } else {
      hs.textContent = '未检查'
    }
  }

  $('#healthCheck').addEventListener('click', function () {
    /* 真实接入：GET /api/v1/health；健康只能证明服务可达，不证明 Cookie 有效 */
    if (state.devState === 'offline') {
      state.health = 'bad'
      toast('服务不可达，请确认 FastAPI 已启动', 'err')
    } else {
      state.health = 'ok'
      state.lastNetOk = Date.now()
      toast('服务正常 · ' + fmtClock(state.lastNetOk), 'ok')
    }
    renderChrome()
    renderSettings()
  })
  $('#cookieCopy').addEventListener('click', function () {
    var cmd = $('#cookieCmd').textContent
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(function () {
        toast('命令已复制', 'ok')
      }, function () {
        toast('复制失败，请手动选择', 'warn')
      })
    } else {
      toast('复制失败，请手动选择', 'warn')
    }
  })

  /* ---------------- 模拟轮询（原型用） ---------------- */
  function tick() {
    if (document.hidden) return
    if (state.devState !== 'normal') return
    var changed = false
    state.jobs.forEach(function (job) {
      if (job.status === 'running') {
        if (job.total === null || job.total === undefined) return
        var remain = job.total - job.success - job.failed - job.skipped
        if (remain > 0) {
          var step = Math.min(remain, 1 + Math.floor(Math.random() * 3))
          for (var i = 0; i < step; i++) {
            var r = Math.random()
            if (r < 0.82) job.success++
            else if (r < 0.92) job.failed++
            else job.skipped++
          }
          changed = true
        }
        var done = job.success + job.failed + job.skipped
        if (done >= job.total) {
          /* 终态由服务端 status 判定，不因计数完成提前转正 */
          job.status = job.failed >= job.total ? 'failed' : (job.failed > Math.floor(job.total / 2) ? 'failed' : 'success')
          if (job.status === 'failed') job.error = '任务存在大量失败（' + job.failed + '/' + job.total + '），请检查网络与 Cookie 后重试。'
          changed = true
        }
      } else if (job.status === 'pending' && job._simPlan === 'willRun') {
        job.status = 'running'
        job.total = 4 + Math.floor(Math.random() * 20)
        job.error = null
        changed = true
      } else if (job.status === 'pending' && job.job_id === 'f6e5d4c3b2a1') {
        /* 种子排队任务：演示“领取中” */
        if (Math.random() < 0.25) {
          job.status = 'running'
          job.total = 24
          job.success = 1
          changed = true
        }
      }
    })
    if (changed) {
      state.pageLastOk.jobs = Date.now()
      state.pageLastOk.download = Date.now()
      state.lastNetOk = Date.now()
      renderAll()
    }
  }

  function startTimer() {
    if (state.timer) clearInterval(state.timer)
    state.timer = setInterval(tick, state.pollInterval * 1000)
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.devState === 'normal') {
      state.lastNetOk = Date.now()
      renderAll()
    }
  })

  /* ---------------- 原型预览控件 ---------------- */
  function setDevState(v) {
    state.devState = v
    $$('#devJobsState .seg-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.state === v)
    })
    if (v === 'normal') {
      state.pageLastOk[state.route] = Date.now()
      state.health = 'ok'
      state.lastNetOk = Date.now()
    }
    if (v === 'offline') {
      toast('服务离线：提交与轮询已暂停', 'err')
    }
    renderAll()
  }
  $('#devJobsState').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn')
    if (b) setDevState(b.dataset.state)
  })
  $('#devCookieState').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn')
    if (!b) return
    state.cookie = b.dataset.cookie
    $$('#devCookieState .seg-btn').forEach(function (x) {
      x.classList.toggle('is-active', x === b)
    })
    renderAll()
  })
  $('#devData').addEventListener('change', function () {
    state.devData = $('#devData').value
    state.jobs = state.devData === 'empty' ? [] : seedJobs(Date.now())
    state.history = state.devData === 'empty' ? [] : seedHistory(Date.now())
    ROUTES.forEach(function (route) {
      state.pageLastOk[route] = state.devData === 'empty' ? null : Date.now()
    })
    state.hist.page = 1
    renderAll()
  })
  $('#devReset').addEventListener('click', function () {
    location.reload()
  })

  /* ---------------- 汇总渲染 ---------------- */
  function renderAll() {
    renderChrome()
    renderDl()
    renderRecent()
    renderJobs()
    renderBanners()
    renderHistory()
    renderSettings()
  }

  renderRoute()
  syncHistForm()
  applyTheme(document.body.dataset.theme)
  state.health = 'ok'
  state.lastNetOk = Date.now()
  renderAll()
  startTimer()
})()
