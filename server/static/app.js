/* ============================================================
   抖音下载工作台 · Web UI 前端（源自 webui3 合并原型正式接线）
   纯原生 JS，无框架、无外部资源；全部数据经 fetch 访问同源 /api/v1。
   安全铁律：服务端返回的文本只经 textContent 输出（el() 构造），
   禁止 innerHTML 拼接动态数据。
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

  /* 轻量识别：只依据域名/路径形态给出“预计类型”，真实解析以服务端为准 */
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
    if (!unixSec) return '—'
    var d = new Date(unixSec * 1000)
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  /* 服务端 created_at 为 UTC ISO 串（如 2026-09-12T12:00:00Z），转本地展示 */
  function fmtIso(s) {
    if (!s) return '—'
    var t = Date.parse(s)
    if (isNaN(t)) return s
    return fmtDateTime(Math.floor(t / 1000))
  }

  function timeAgo(iso) {
    var t = Date.parse(iso)
    if (isNaN(t)) return ''
    var diff = Math.max(0, Date.now() - t)
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

  /* ---------------- 状态 ---------------- */
  /* jobs/history 为 null = 从未成功加载；[] = 成功但为空（错误三态模型依赖该区分） */
  var state = {
    jobs: null,
    history: null,
    histTotal: 0,
    authors: null,
    authorsLoaded: false,
    route: 'download',
    jobsFilter: 'all',
    health: 'unknown',     // unknown | ok | down（仅由健康检查与请求成功/失败驱动）
    lastNetOk: null,
    pageLastOk: {},        // 每页最后成功时间（横幅显示用）
    hist: { page: 1, size: 50, searchField: 'author', search: '', type: 'all',
            from: '', to: '', sort: 'download_time', job: '' },
    histSeq: 0,            // 废弃过期响应：请求前 ++，响应回来比对
    jobsSeq: 0,
    submitting: false,
    pollTimer: null,
    pollInFlight: false
  }

  /* ---------------- fetch 基础 ---------------- */
  function api(method, path, body) {
    var opt = { method: method, headers: {} }
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json'
      opt.body = JSON.stringify(body)
    }
    return fetch(path, opt).then(function (resp) {
      return resp.json().catch(function () { return null }).then(function (data) {
        return { ok: resp.ok, status: resp.status, data: data }
      })
    })
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
    try { localStorage.setItem('dyui-theme', theme) } catch (e) {}
  }
  $('#themeToggle').addEventListener('click', function () {
    applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark')
  })
  ;(function initTheme() {
    var saved = null
    try { saved = localStorage.getItem('dyui-theme') } catch (e) {}
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
    var fullPage = isBroken() && !pageHasContent(state.route)
    state.route = currentRoute()
    ROUTES.forEach(function (r) {
      $('#page-' + r).hidden = r !== state.route || fullPage
    })
    $('#global-state').hidden = !fullPage
    $$('.top-nav a').forEach(function (a) {
      var active = a.dataset.route === state.route
      a.classList.toggle('is-active', active)
      if (active) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    if (state.route === 'history') {
      loadHistory()
      loadAuthors()
    }
  }
  window.addEventListener('hashchange', function () { renderRoute(); renderBanners() })

  /* ---------------- 数据层：加载/错误三态 ---------------- */
  function isBroken() {
    return state.health === 'down'
  }

  function pageHasContent(route) {
    if (route === 'jobs' || route === 'download') {
      return Array.isArray(state.jobs) && state.jobs.length > 0
    }
    if (route === 'history') {
      return Array.isArray(state.history) && state.history.length > 0
    }
    if (route === 'settings') return state.lastNetOk !== null
    return false
  }

  function markNetOk() {
    var first = state.lastNetOk === null
    state.lastNetOk = Date.now()
    if (state.health !== 'ok') state.health = 'ok'
    if (first) {
      // 首次联通后整页错误卡需要退场，页面重新可见
      renderRoute()
    }
  }

  function markNetDown() {
    state.health = 'down'
  }

  /* 主资源从未加载成功且失败 → 整页卡；已有数据 → 顶部横幅，数据保留 */
  function netFailScope(route) {
    if (!isBroken()) return 'none'
    return pageHasContent(route) ? 'banner' : 'fullpage'
  }

  function renderBanners() {
    var liveN = Array.isArray(state.jobs) ? state.jobs.filter(isLive).length : 0
    var poll = $('#pollBanner')
    if (liveN > 0 && !isBroken()) {
      poll.hidden = false
      $('#pollBannerText').textContent = liveN + ' 个任务进行中，每 2 秒更新一次' +
        (state.lastNetOk ? ' · 最后更新 ' + fmtClock(state.lastNetOk) : '')
    } else {
      poll.hidden = true
    }

    var scope = netFailScope(state.route)
    ROUTES.forEach(function (route) {
      $('#page-' + route).hidden = route !== state.route || scope === 'fullpage'
    })
    $('#global-state').hidden = scope !== 'fullpage'
    $('#netBanner').hidden = scope !== 'banner'
    if (scope === 'fullpage') {
      $('#globalStateTitle').textContent = '连接不到下载服务'
      $('#globalStateMessage').textContent =
        '网络请求未成功，当前没有可展示的数据。请确认服务已启动，再重新加载。输入内容仍会保留。'
      $('#globalRetry').textContent = '重新连接'
    } else if (scope === 'banner') {
      $('#netBannerText').textContent = '网络请求失败，展示最后一份数据。'
      var updated = state.pageLastOk[state.route]
      $('#netBannerTime').textContent = updated ? '最后成功 ' + fmtClock(updated) : '尚无成功获取记录'
    }
  }

  /* ---------------- 顶部与胶囊 ---------------- */
  function isLive(job) { return job.status === 'running' || job.status === 'pending' }

  function renderChrome() {
    var liveN = Array.isArray(state.jobs) ? state.jobs.filter(isLive).length : 0
    var ind = $('#navJobsIndicator')
    ind.classList.toggle('is-live', liveN > 0)
    var cnt = $('#navJobsCount')
    cnt.hidden = liveN === 0
    cnt.textContent = String(liveN)

    var netPill = $('#netPill')
    var netDot = $('#netDot')
    var netText = $('#netPillText')
    var netTime = $('#netPillTime')
    netPill.classList.remove('is-ok')
    if (state.health === 'ok') {
      netDot.className = 'dot dot-ok'
      netText.textContent = '服务正常'
      netTime.textContent = state.lastNetOk ? ' · ' + fmtClock(state.lastNetOk) : ''
      netPill.classList.add('is-ok')
    } else if (state.health === 'down') {
      netDot.className = 'dot dot-failed'
      netText.textContent = '服务不可达'
      netTime.textContent = state.lastNetOk ? ' · 最后联通 ' + fmtClock(state.lastNetOk) : ''
    } else {
      netDot.className = 'dot dot-unknown'
      netText.textContent = '服务未检查'
      netTime.textContent = ''
    }
  }

  /* ---------------- 任务加载与轮询 ---------------- */
  function loadJobs() {
    var seq = ++state.jobsSeq
    return api('GET', '/api/v1/jobs').then(function (r) {
      if (seq !== state.jobsSeq) return // 过期响应，丢弃
      if (r.ok) {
        var fresh = (r.data && r.data.jobs) || []
        if (state.jobs === null || hasShapeChange(state.jobs, fresh)) {
          state.jobs = fresh
          renderRecent()
          renderJobs()
        } else {
          updateJobsInPlace(fresh)
        }
        markNetOk()
      } else {
        markNetDown()
      }
      renderAll()
      schedulePoll()
    }, function () {
      markNetDown()
      renderAll()
      schedulePoll()
    })
  }

  /* 轮询只更新数字/进度/徽章/时间，不重建整卡 DOM、不打断焦点 */
  function updateJobsInPlace(fresh) {
    var byId = {}
    fresh.forEach(function (j) { byId[j.job_id] = j })
    var changed = false
    state.jobs.forEach(function (job, idx) {
      var f = byId[job.job_id]
      if (!f) return
      ;['status', 'total', 'success', 'failed', 'skipped', 'started_at', 'finished_at', 'error']
        .forEach(function (k) {
          if (job[k] !== f[k]) { job[k] = f[k]; changed = true }
        })
      state.jobs[idx] = job
    })
    if (changed) {
      renderJobs()
      renderRecent()
    }
  }

  /* 结构变化（新任务/任务消失/顺序变化）才整列重渲染 */
  function hasShapeChange(old, fresh) {
    if (old.length !== fresh.length) return true
    for (var i = 0; i < fresh.length; i++) {
      if (!old[i] || old[i].job_id !== fresh[i].job_id) return true
    }
    return false
  }

  function schedulePoll() {
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null }
    if (!Array.isArray(state.jobs)) return
    var live = state.jobs.some(isLive)
    if (!live) return
    state.pollTimer = setTimeout(pollOnce, 2000)
  }

  function pollOnce() {
    if (document.hidden) { schedulePoll(); return }
    if (state.pollInFlight) return
    state.pollInFlight = true
    api('GET', '/api/v1/jobs').then(function (r) {
      state.pollInFlight = false
      if (r.ok) {
        var fresh = (r.data && r.data.jobs) || []
        if (hasShapeChange(state.jobs || [], fresh)) {
          state.jobs = fresh
          renderRecent()
          renderJobs()
        } else {
          state.jobs = fresh
          updateJobsInPlace(fresh)
        }
        markNetOk()
      } else {
        markNetDown()
      }
      renderAll()
      schedulePoll()
    }, function () {
      state.pollInFlight = false
      markNetDown()
      renderAll()
      schedulePoll()
    })
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      // 回前台立即刷一次，对齐服务端真相
      loadJobs()
      if (state.route === 'history') loadHistory()
    }
  })

  /* ---------------- 下载页 ---------------- */
  var dlInput = $('#dlInput')

  function parseInput() {
    var raw = extractUrls(dlInput.value)
    var seen = {}
    var rows = raw.map(function (u) {
      var d = detectType(u)
      var dup = false
      if (isDouyinUrl(u)) {
        if (seen[u]) dup = true
        seen[u] = true
      }
      return { url: u, valid: isDouyinUrl(u), dup: dup, type: d.type, typeSub: d.sub, key: d.key }
    })
    return { rows: rows, invalid: rows.filter(function (r) { return !r.valid }) }
  }

  function renderDl() {
    var parsed = parseInput()
    var rows = parsed.rows
    var chips = $('#dlChips')
    chips.innerHTML = ''
    var validRows = rows.filter(function (r) { return r.valid })
    var count = validRows.filter(function (r) { return !r.dup }).length

    if (rows.length) {
      chips.hidden = false
      var head = el('div', 'chips-head')
      var dupN = rows.filter(function (r) { return r.dup }).length
      head.textContent = '识别到 ' + rows.length + ' 条链接' +
        (dupN ? ' · 重复 ' + dupN + ' 条（只提交首条，可移除）' : '')
      chips.appendChild(head)
      rows.forEach(function (r) {
        var c = el('div', 'chip')
        if (r.dup) { c.style.opacity = '.55' }
        c.appendChild(el('span', 'badge-type' + (r.key === 'unknown' ? ' unknown' : ''), r.type))
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
        var rm = el('button', 'chip-keep', '移除')
        rm.type = 'button'
        rm.setAttribute('aria-label', '从本次提交中移除 ' + r.url)
        rm.addEventListener('click', function () {
          /* 从输入框删掉该行 */
          var lines = dlInput.value.split('\n').filter(function (line) {
            return line.indexOf(r.url) === -1
          })
          dlInput.value = lines.join('\n').replace(/\n{2,}/g, '\n').replace(/^\n+/, '')
          renderDl()
        })
        c.appendChild(rm)
        chips.appendChild(c)
      })
    } else {
      chips.hidden = true
    }

    $('#dlCount').textContent = String(count)
    $('#dlSubmit').disabled = count === 0 || state.submitting || isBroken()
    renderNotice(parsed)
  }

  function renderNotice(parsed) {
    var box = $('#dlNotice')
    box.innerHTML = ''
    box.hidden = true
    if (isBroken()) {
      box.hidden = false
      var n = el('div', 'notice-inline')
      n.appendChild(el('span', null, '服务不可达，无法提交。'))
      var go = el('a', null, '查看设置页')
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

  dlInput.addEventListener('input', function () { renderDl() })

  $('#fillVideo').addEventListener('click', function () {
    dlInput.value = 'https://www.douyin.com/video/7346971177114611826'
    renderDl()
    dlInput.focus()
  })
  $('#fillMulti').addEventListener('click', function () {
    dlInput.value = [
      'https://www.douyin.com/video/7346971177114611826',
      'https://www.douyin.com/user/MS4wLjABAAAA6O7EZyfDRYXxJrUTpf91K3tmB4rBROkAw-nYMfld8ss'
    ].join('\n')
    renderDl()
    dlInput.focus()
  })

  /* 提交：逐条串行 POST /download，间隔 ≥2000ms；失败条目保留在输入框 */
  function submitDownload() {
    if (state.submitting || isBroken()) return
    var parsed = parseInput()
    var toSubmit = parsed.rows.filter(function (r) { return r.valid && !r.dup })
    if (!toSubmit.length) return

    state.submitting = true
    $('#dlSubmit').disabled = true
    renderDl()

    var i = 0
    var failedLines = []
    function next() {
      if (isBroken()) {
        state.submitting = false
        // 未提交的条目保留在输入框
        dlInput.value = toSubmit.slice(i).map(function (row) { return row.url }).join('\n')
        toast('提交中断，未提交的链接已保留', 'warn')
        renderDl()
        return
      }
      if (i >= toSubmit.length) {
        state.submitting = false
        renderDl()
        // 批量完成后跳任务中心并对齐服务端真相
        location.hash = '#jobs'
        loadJobs()
        return
      }
      var item = toSubmit[i]
      api('POST', '/api/v1/download', { url: item.url }).then(function (r) {
        i++
        if (r.ok && r.data && r.data.job_id) {
          // 用响应构造 pending job 放到列表最前
          state.jobs = state.jobs || []
          state.jobs.unshift({
            job_id: r.data.job_id,
            url: item.url,
            status: r.data.status || 'pending',
            created_at: new Date().toISOString(),
            started_at: null, finished_at: null,
            total: 0, success: 0, failed: 0, skipped: 0,
            error: null
          })
          var remain = toSubmit.length - i
          toast('已排队：' + item.type + (remain ? '，剩余 ' + remain + ' 条间隔 2 秒提交' : ''), 'ok')
          renderAll()
          schedulePoll()
        } else {
          // 失败条目保留在输入框，toast 原因
          failedLines.push(item.url)
          var reason = (r.data && r.data.detail) ? r.data.detail : 'HTTP ' + r.status
          toast('提交失败：' + item.url.slice(0, 40) + ' · ' + reason, 'err')
          renderAll()
        }
        if (i < toSubmit.length) {
          setTimeout(next, 2000)
        } else {
          if (failedLines.length) {
            dlInput.value = failedLines.join('\n')
            renderDl()
          } else {
            dlInput.value = ''
            renderDl()
          }
          state.submitting = false
          renderDl()
          location.hash = '#jobs'
          loadJobs()
        }
      }, function () {
        i++
        failedLines.push(item.url)
        markNetDown()
        renderAll()
        if (i < toSubmit.length) {
          setTimeout(next, 2000)
        } else {
          state.submitting = false
          dlInput.value = failedLines.join('\n')
          toast('网络请求失败，未提交的链接已保留', 'err')
          renderDl()
        }
      })
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
    parts.push('总数 ' + (job.total ? job.total : (isLive(job) ? '获取中' : '0')))
    parts.push('成功 ' + job.success)
    if (job.failed) parts.push('失败 ' + job.failed)
    if (job.skipped) parts.push('跳过 ' + job.skipped)
    return parts.join(' / ')
  }

  function renderRecent() {
    var row = $('#recentRow')
    row.innerHTML = ''
    var jobs = Array.isArray(state.jobs) ? state.jobs.slice(0, 6) : []
    $('#recentEmpty').hidden = jobs.length > 0
    $('#recentBlock').hidden = jobs.length === 0 && isBroken()
    jobs.forEach(function (job) {
      var card = el('a', 'mini-card')
      card.href = '#jobs'
      var top = el('div', 'mini-top')
      top.appendChild(statusBadge(job.status))
      top.appendChild(el('span', 'mini-meta', timeAgo(job.created_at)))
      card.appendChild(top)
      card.appendChild(el('div', 'mini-title', detectType(job.url).type + ' · ' + shortUrl(job.url)))
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
    var counts = { all: 0, live: 0, success: 0, failed: 0, cancelled: 0 }
    var jobs = Array.isArray(state.jobs) ? state.jobs : []
    counts.all = jobs.length
    jobs.forEach(function (j) {
      if (isLive(j)) counts.live++
      if (counts[j.status] !== undefined) counts[j.status]++
    })
    Object.keys(counts).forEach(function (k) {
      var n = $('[data-tab-count="' + k + '"]')
      if (n) n.textContent = String(counts[k])
    })

    if (state.jobs === null) {
      if (isBroken()) {
        // 整页错误卡由 renderBanners 处理；此处仅清空列表
        $('#jobsEmpty').hidden = true
      } else {
        for (var s = 0; s < 3; s++) list.appendChild(el('div', 'skeleton-card'))
        $('#jobsEmpty').hidden = true
      }
      return
    }

    var shown = jobs.filter(function (j) { return jobMatches(j, state.jobsFilter) })
    $('#jobsEmpty').hidden = shown.length > 0
    shown.forEach(function (job) { list.appendChild(jobCard(job)) })
  }

  function jobCard(job) {
    var wrap = el('article', 'job-card')
    var head = el('div', 'job-head')
    head.appendChild(statusBadge(job.status))
    head.appendChild(el('span', 'job-id', '#' + job.job_id))

    var main = el('div', 'job-main')
    var trow = el('div', 'job-title-row')
    trow.appendChild(el('h3', 'job-title', detectType(job.url).type))
    main.appendChild(trow)
    main.appendChild(el('div', 'job-url', job.url))

    var meta = el('div', 'job-meta')
    meta.appendChild(el('span', 'job-counts', fmtCounts(job)))
    meta.appendChild(el('span', 'job-time', '创建 ' + timeAgo(job.created_at)))
    main.appendChild(meta)

    if (job.status === 'running' || job.status === 'pending') {
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
      if (job.error.indexOf('Cookie') !== -1 || job.error.indexOf('cookie') !== -1) {
        var hint = el('div', 'fix-hint')
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
      cancel.disabled = !!job._cancelling || isBroken()
      cancel.addEventListener('click', function () { cancelJob(job.job_id) })
      ops.appendChild(cancel)
    } else {
      var retry = el('button', 'btn-ghost sm', '重试')
      retry.disabled = isBroken()
      retry.addEventListener('click', function () { retryJob(job.job_id) })
      var again = el('button', 'btn-ghost sm', '再次下载')
      again.addEventListener('click', function () {
        dlInput.value = job.url
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

  /* 取消：先置“正在取消…”，POST 后无论结果都重拉对齐服务端 */
  function cancelJob(id) {
    var job = null
    if (Array.isArray(state.jobs)) {
      state.jobs.forEach(function (j) { if (j.job_id === id) job = j })
    }
    if (!job || !isLive(job) || job._cancelling) return
    job._cancelling = true
    renderAll()
    api('POST', '/api/v1/jobs/' + encodeURIComponent(id) + '/cancel').then(function (r) {
      job._cancelling = false
      if (r.status === 404) {
        toast('任务已不在近期列表，可在下载历史中查看', 'warn')
      } else if (r.status === 409) {
        // 已终态，重拉对齐
      } else if (r.ok) {
        toast('已请求取消，保留已处理计数', 'warn')
      } else {
        toast('取消请求失败，稍后再试', 'err')
      }
      loadJobs()
    }, function () {
      job._cancelling = false
      markNetDown()
      renderAll()
      toast('网络请求失败，展示最后一份数据', 'err')
    })
  }

  /* 重试：POST 返回 201 新 job_id；UI 不本地伪造，loadJobs 后新任务自然出现 */
  function retryJob(id) {
    api('POST', '/api/v1/jobs/' + encodeURIComponent(id) + '/retry').then(function (r) {
      if (r.status === 404) {
        toast('任务已不在近期列表，可在下载历史中查看', 'warn')
      } else if (r.status === 409) {
        toast('任务仍在进行中，无法重试', 'warn')
      } else if (r.ok && r.data && r.data.job_id) {
        toast('已创建重试任务 #' + r.data.job_id, 'ok')
        loadJobs()
      } else {
        toast('重试请求失败，稍后再试', 'err')
      }
    }, function () {
      markNetDown()
      renderAll()
      toast('网络请求失败，展示最后一份数据', 'err')
    })
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

  $('#jobsRefresh').addEventListener('click', function () { loadJobs() })
  $('#globalRetry').addEventListener('click', function () { boot() })
  $('#netRetry').addEventListener('click', function () {
    loadJobs()
    if (state.route === 'history') loadHistory()
  })

  /* ---------------- 历史页 ---------------- */
  /* GET /api/v1/downloads：搜索只传 author 或 title 二选一（由 #fSearchField 决定） */
  function buildHistQuery() {
    var h = state.hist
    var params = new URLSearchParams()
    params.set('page', String(h.page))
    params.set('size', String(h.size))
    params.set('sort', h.sort)
    if (h.search) {
      // 绝不同时传 author 与 title
      params.set(h.searchField === 'title' ? 'title' : 'author', h.search)
    }
    if (h.type !== 'all') params.set('aweme_type', h.type)
    if (h.job) params.set('job_id', h.job)
    if (h.from) {
      var f = new Date(h.from + 'T00:00:00+08:00').getTime() / 1000
      params.set('date_from', String(Math.floor(f)))
    }
    if (h.to) {
      var t = new Date(h.to + 'T23:59:59+08:00').getTime() / 1000
      params.set('date_to', String(Math.floor(t)))
    }
    return params.toString()
  }

  var histTimer = null

  function loadHistory() {
    var seq = ++state.histSeq
    return api('GET', '/api/v1/downloads?' + buildHistQuery()).then(function (r) {
      if (seq !== state.histSeq) return // 过期响应，丢弃
      if (r.ok) {
        state.history = (r.data && r.data.items) || []
        state.histTotal = (r.data && r.data.total) || 0
        state.hist.page = (r.data && r.data.page) || state.hist.page
        markNetOk()
      } else if (r.status === 409) {
        // 数据库未启用：按空历史处理，不做成网络错误
        state.history = []
        state.histTotal = 0
        markNetOk()
      } else {
        markNetDown()
        state.history = null
      }
      renderHistory()
      renderAll()
    }, function () {
      if (seq !== state.histSeq) return
      markNetDown()
      state.history = null
      renderHistory()
      renderAll()
    })
  }

  function renderHistory() {
    var wrap = $('.hist-table-wrap')
    var body = $('#histBody')
    body.innerHTML = ''

    if (state.history === null) {
      // 从未成功加载：#histError 块（横幅态时数据为空但服务不可达也走这里）
      wrap.hidden = true
      $('#histEmpty').hidden = true
      $('#histError').hidden = isBroken() && netFailScope('history') === 'fullpage'
      renderPager(0)
      return
    }
    $('#histError').hidden = true

    var total = state.histTotal
    $('#histTotal').textContent = '共 ' + total + ' 条'
    var pages = Math.max(1, Math.ceil(total / state.hist.size))
    if (state.hist.page > pages) state.hist.page = pages

    var empty = $('#histEmpty')
    var items = state.history
    empty.hidden = items.length > 0
    wrap.hidden = items.length === 0

    items.forEach(function (it) {
      var tr = el('tr')
      var tdCover = el('td')
      var covers = it.cover_urls || []
      if (covers[0]) {
        var img = el('img', 'cover')
        img.src = covers[0]
        img.alt = it.title || '封面'
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
      tdTitle.appendChild(el('span', 'cell-title', it.title || '（无标题）'))
      var authorBox = el('span', 'cell-author')
      var ab = el('button', 'author-link', it.author_name || '未知作者')
      ab.type = 'button'
      ab.style.padding = '0'
      ab.addEventListener('click', function () {
        state.hist.searchField = 'author'
        state.hist.search = it.author_name || ''
        state.hist.page = 1
        syncHistForm()
        loadHistory()
      })
      authorBox.appendChild(ab)
      tdTitle.appendChild(authorBox)
      tr.appendChild(tdTitle)

      var tdType = el('td')
      tdType.appendChild(el('span', 'badge-type',
        it.aweme_type === 'video' ? '视频' : (it.aweme_type === 'gallery' ? '图文' : (it.aweme_type || '其他'))))
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
  }

  function renderPager(total) {
    var pages = Math.max(1, Math.ceil(total / state.hist.size))
    $('#pageInfo').textContent = '第 ' + state.hist.page + ' 页 / 共 ' + pages + ' 页'
    $('#pagePrev').disabled = state.hist.page <= 1
    $('#pageNext').disabled = state.hist.page >= pages
    $('#histTotal').textContent = '共 ' + total + ' 条'
  }

  $('#pagePrev').addEventListener('click', function () {
    if (state.hist.page > 1) { state.hist.page--; loadHistory() }
  })
  $('#pageNext').addEventListener('click', function () {
    state.hist.page++
    loadHistory()
  })
  $('#pageSize').addEventListener('change', function (e) {
    state.hist.size = parseInt(e.target.value, 10) || 50
    state.hist.page = 1
    loadHistory()
  })

  $('#histFilters').addEventListener('submit', function (e) {
    e.preventDefault()
    applyHistFilters()
  })
  function applyHistFilters() {
    state.hist.searchField = $('#fSearchField').value
    state.hist.search = $('#fSearch').value.trim()
    state.hist.from = $('#fFrom').value
    state.hist.to = $('#fTo').value
    state.hist.sort = $('#fSort').value
    state.hist.job = $('#fJob').value.trim()
    state.hist.page = 1
    loadHistory()
  }
  $('#histReset').addEventListener('click', function () {
    state.hist = { page: 1, size: state.hist.size, searchField: 'author', search: '', type: 'all',
                   from: '', to: '', sort: 'download_time', job: '' }
    syncHistForm()
    loadHistory()
  })
  $('#fJobClear').addEventListener('click', function () {
    state.hist.job = ''
    state.hist.page = 1
    syncHistForm()
    loadHistory()
  })
  $('#fType').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn')
    if (!b) return
    $$('#fType .seg-btn').forEach(function (x) { x.classList.toggle('is-active', x === b) })
    state.hist.type = b.dataset.type
    state.hist.page = 1
    loadHistory()
  })

  $('#fSearch').addEventListener('input', function () {
    // 300ms 防抖后按当前输入即时筛选（条件变化回第 1 页）
    if (histTimer) clearTimeout(histTimer)
    histTimer = setTimeout(function () {
      state.hist.searchField = $('#fSearchField').value
      state.hist.search = $('#fSearch').value.trim()
      state.hist.page = 1
      loadHistory()
    }, 300)
  })

  $('#fSearchField').addEventListener('change', function () {
    state.hist.searchField = $('#fSearchField').value
    $('#fSearch').placeholder = state.hist.searchField === 'title' ? '搜索标题…' : '搜索作者…'
    state.hist.page = 1
    loadHistory()
  })

  function syncHistForm() {
    $('#fSearchField').value = state.hist.searchField
    $('#fSearch').placeholder = state.hist.searchField === 'title' ? '搜索标题…' : '搜索作者…'
    $('#fSearch').value = state.hist.search
    $('#fFrom').value = state.hist.from
    $('#fTo').value = state.hist.to
    $('#fSort').value = state.hist.sort
    $('#fJob').value = state.hist.job
    $('#fieldJob').hidden = !state.hist.job
    $$('#fType .seg-btn').forEach(function (x) {
      x.classList.toggle('is-active', x.dataset.type === state.hist.type)
    })
  }

  /* Top 作者：独立接口；按发布时间（create_time）聚合，文案只写“近 30 天” */
  function loadAuthors() {
    if (state.authorsLoaded) { renderAuthors(); return }
    return api('GET', '/api/v1/downloads/authors?days=30&limit=20').then(function (r) {
      if (r.ok) {
        state.authors = (r.data && r.data.authors) || []
        state.authorsLoaded = true
        markNetOk()
      } else if (r.status === 409) {
        state.authors = []
        state.authorsLoaded = true
        markNetOk()
      } else {
        state.authors = null
      }
      renderAuthors()
    }, function () {
      state.authors = null
      renderAuthors()
    })
  }

  function renderAuthors() {
    var ol = $('#authorsList')
    ol.innerHTML = ''
    var list = Array.isArray(state.authors) ? state.authors : []
    list.slice(0, 8).forEach(function (a) {
      var li = el('li')
      var b = el('button', null, a.author_name || '未知作者')
      b.type = 'button'
      b.addEventListener('click', function () {
        state.hist.searchField = 'author'
        state.hist.search = a.author_name || ''
        state.hist.page = 1
        syncHistForm()
        loadHistory()
      })
      li.appendChild(b)
      li.appendChild(el('span', 'count', a.download_count + ' 条'))
      ol.appendChild(li)
    })
    $('#topAuthors').querySelector('summary').textContent =
      '近 30 天下载最多作者（点击查看' + (list.length ? ' · ' + Math.min(8, list.length) + ' 位' : '') + '）'
  }
  $('#topAuthors').addEventListener('toggle', function () {
    if ($('#topAuthors').open) loadAuthors()
  })

  /* ---------------- 路径弹窗 ---------------- */
  var pathDialog = $('#pathDialog')
  function openPathDialog(it) {
    $('#pathDialogText').textContent = it.file_path || '（无记录）'
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
  /* Cookie 无检测端点 → 恒“未检测”，只给修复命令（健康 ≠ Cookie 有效） */
  function renderSettings() {
    var dot = $('#setCookieDot')
    var text = $('#setCookieText')
    dot.className = 'dot dot-unknown'
    text.textContent = '未检测'
    var hs = $('#healthState')
    hs.className = 'status-inline'
    if (state.health === 'ok') {
      hs.textContent = '正常' + (state.lastNetOk ? ' · ' + fmtClock(state.lastNetOk) : '')
      hs.classList.add('ok')
    } else if (state.health === 'down') {
      hs.textContent = '不可达'
      hs.classList.add('bad')
    } else {
      hs.textContent = '未检查'
    }
  }

  $('#healthCheck').addEventListener('click', function () {
    api('GET', '/api/v1/health').then(function (r) {
      if (r.ok) {
        markNetOk()
        toast('服务正常' + (state.lastNetOk ? ' · ' + fmtClock(state.lastNetOk) : ''), 'ok')
      } else {
        markNetDown()
        toast('健康检查失败（HTTP ' + r.status + '）', 'err')
      }
      renderAll()
    }, function () {
      markNetDown()
      renderAll()
      toast('服务不可达，请确认服务已启动', 'err')
    })
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

  function boot() {
    state.health = 'unknown'
    renderRoute()
    syncHistForm()
    renderAll()
    api('GET', '/api/v1/health').then(function (r) {
      if (r.ok) markNetOk()
      else markNetDown()
      renderAll()
    }, function () {
      markNetDown()
      renderAll()
    })
    loadJobs()
    if (currentRoute() === 'history') {
      loadHistory()
      loadAuthors()
    }
  }

  boot()
})()