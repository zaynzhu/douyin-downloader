// 离线交互样稿：所有数据仅在内存中，不调用真实接口。
const $ = selector => document.querySelector(selector)
const STATUS_LABELS = { pending: '排队中', running: '进行中', success: '已完成', failed: '失败', cancelled: '已取消' }
const PAGE_LABELS = { download: '下载', jobs: '任务中心', history: '下载历史', settings: '设置' }
const INITIAL_JOBS = [
  { id: 'demo-0912-a', name: '用户主页', url: 'https://www.douyin.com/user/demo-shan', status: 'running', total: 36, success: 18, failed: 0, skipped: 2, time: '今天 14:32', error: null },
  { id: 'demo-0912-b', name: '合集', url: 'https://www.douyin.com/collection/7346000000000000001', status: 'pending', total: 0, success: 0, failed: 0, skipped: 0, time: '今天 14:34', error: null },
  { id: 'demo-0912-c', name: '单个作品', url: 'https://www.douyin.com/video/7346000000000000002', status: 'success', total: 1, success: 1, failed: 0, skipped: 0, time: '今天 13:56', error: null },
  { id: 'demo-0912-d', name: '用户主页', url: 'https://www.douyin.com/user/demo-sea', status: 'failed', total: 12, success: 3, failed: 1, skipped: 0, time: '今天 13:42', error: '请求被拒绝，下载未完成。请检查 Cookie 后重试。' },
  { id: 'demo-0912-e', name: '音乐', url: 'https://www.douyin.com/music/7346000000000000003', status: 'cancelled', total: 24, success: 6, failed: 0, skipped: 2, time: '昨天 21:10', error: null }
]
const TITLES = ['山里的早晨，风从树梢经过', '沿着海岸线，一直走到日落', '记录一场九月的雨', '把周末留给山野', '旧街道里的慢时光', '厨房里的一点烟火气', '开往秋天的列车', '一组留给傍晚的照片']
const AUTHORS = ['山间来信', '沿海散步', '日常切片', '山间来信', '街角观察', '小满的厨房', '沿海散步', '日常切片']
const HISTORY = Array.from({ length: 58 }, (_, index) => ({
  id: `734697117711461${String(index).padStart(4, '0')}`,
  title: TITLES[index % 8], author: AUTHORS[index % 8], type: index % 4 === 3 ? 'gallery' : 'video',
  create_time: Date.UTC(2026, 8, 10 - Math.floor(index / 4)),
  download_time: Date.UTC(2026, 8, 12 - Math.floor(index / 8), 6, 30 - index % 8),
  jobId: index % 2 ? 'demo-0912-c' : 'demo-0912-a'
}))
let jobs = INITIAL_JOBS.map(job => ({ ...job }))
let page = 'download'
let jobFilter = 'all'
let historyPage = 1
let scenario = 'normal'
let parsedLinks = []
let toastTimer

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
function isActive(job) { return ['pending', 'running'].includes(job.status) }
function toast(message) {
  $('#toast').textContent = message
  $('#toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('#toast').hidden = true }, 3400)
}
function emptyState(title, description, action = '') {
  return `<div class="empty-state"><h2>${title}</h2><p>${description}</p>${action}</div>`
}
function jobMarkup(job, compact = false) {
  const active = isActive(job)
  const processed = job.success + job.failed + job.skipped
  const progress = job.total > 0 ? Math.min(100, processed / job.total * 100) : 0
  return `<article class="job-card ${job.status}" data-job="${job.id}">
    <div class="job-top"><span class="job-symbol" aria-hidden="true">${job.name === '用户主页' ? '主页' : '链接'}</span><div class="job-title"><h3>${escapeHtml(job.name)}</h3><p title="${escapeHtml(job.url)}">${escapeHtml(job.url)}</p></div><span class="badge ${job.status}">${STATUS_LABELS[job.status]}</span></div>
    <div class="job-bottom"><div class="counts">${job.status === 'pending' ? '<span>等待开始，作品数量待获取</span>' : `<span><b data-count="total">${job.total}</b>总数</span><span><b data-count="success">${job.success}</b>成功</span><span><b data-count="failed">${job.failed}</b>失败</span><span><b data-count="skipped">${job.skipped}</b>跳过</span>`}</div><span class="job-time">${job.time}</span><div class="job-actions">${active ? '<button data-action="cancel">取消</button>' : `<button data-action="retry">重试</button>${!compact ? '<button data-action="again">再次下载</button>' : ''}`}</div></div>
    ${job.status === 'running' ? `<div class="progress" role="progressbar" aria-label="已处理作品" aria-valuemin="0" aria-valuemax="${job.total}" aria-valuenow="${processed}"><span style="width:${progress}%"></span></div>` : ''}
    ${job.error ? `<p class="error-summary">${escapeHtml(job.error)} <a href="#settings">查看修复指引</a></p>` : ''}
    ${!compact ? `<p class="footnote">任务 ID：${job.id} <button class="quiet" data-action="history">查看下载记录</button></p>` : ''}
  </article>`
}
function renderJobs() {
  const available = scenario === 'empty' ? [] : jobs
  const activeCount = available.filter(isActive).length
  $('#active-count').textContent = activeCount || ''
  $('#recent-count').textContent = available.length ? `最近 ${Math.min(5, available.length)} 项` : ''
  $('#recent-jobs').innerHTML = available.length ? available.slice(0, 5).map(job => jobMarkup(job, true)).join('') : emptyState('还没有下载任务', '粘贴第一条链接，开始保存喜欢的作品。')
  const filtered = available.filter(job => jobFilter === 'all' || (jobFilter === 'active' ? isActive(job) : job.status === jobFilter))
  $('#job-list').innerHTML = filtered.length ? filtered.map(job => jobMarkup(job)).join('') : emptyState('这里还没有任务', '换个筛选条件，或添加一条下载链接。', '<a href="#download">去下载</a>')
  $('#poll-label').innerHTML = activeCount ? '<i class="dot"></i>演示进度 · 每 2 秒更新' : '当前没有进行中的任务'
}
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' })
}
function filteredHistory() {
  const field = $('#search-field').value
  const query = $('#history-search').value.trim().toLowerCase()
  const type = $('#history-type').value
  const from = $('#date-from').value ? new Date(`${$('#date-from').value}T00:00:00+08:00`).getTime() : -Infinity
  const to = $('#date-to').value ? new Date(`${$('#date-to').value}T23:59:59+08:00`).getTime() : Infinity
  const id = $('#job-filter').value.trim()
  // 接入点：GET /api/v1/downloads，日期需毫秒转秒；搜索明确选择 author 或 title。
  return (scenario === 'empty' ? [] : HISTORY).filter(item => item[field].toLowerCase().includes(query) && (type === 'all' || item.type === type) && item.create_time >= from && item.create_time <= to && (!id || item.jobId === id)).sort((a, b) => b[$('#history-sort').value] - a[$('#history-sort').value])
}
function renderHistory() {
  const items = filteredHistory()
  const size = Number($('#page-size').value)
  const pages = Math.max(1, Math.ceil(items.length / size))
  historyPage = Math.min(historyPage, pages)
  const start = (historyPage - 1) * size
  $('#history-total').textContent = `${items.length} 个作品`
  $('#history-rows').innerHTML = items.slice(start, start + size).map(item => `<tr><td><div class="work-cell">${Number(item.id.slice(-4)) % 8 === 7 ? '<span class="cover-placeholder" role="img" aria-label="封面不可用">暂无<br>封面</span>' : `<img class="cover-image" src="assets/cover-${Number(item.id.slice(-4)) % 4}.svg" alt="${item.title}的示意封面" loading="lazy">`}<div class="work-title">${item.title}<small>${item.id}</small></div></div></td><td>${item.author}<small>${item.type === 'video' ? '视频' : '图文'}</small></td><td>${formatDate(item.download_time)}<small>发布于 ${formatDate(item.create_time)}</small></td><td><button data-path-id="${item.id}">位置 ↗</button></td></tr>`).join('')
  $('#history-empty').hidden = items.length > 0
  $('#history-empty').innerHTML = emptyState('没有找到作品', scenario === 'empty' ? '完成下载后，作品会出现在这里。' : '试试其他关键词，或重置筛选条件。')
  $('#page-summary').textContent = items.length ? `第 ${start + 1}–${Math.min(start + size, items.length)} 项，共 ${items.length} 项` : '共 0 项'
  $('#page-number').textContent = `${historyPage} / ${pages}`
  $('#previous-page').disabled = historyPage === 1
  $('#next-page').disabled = historyPage === pages
  // 接入点：GET /api/v1/downloads/authors?days=30&limit=20，独立于当前筛选。
  const counts = new Map()
  if (scenario !== 'empty') HISTORY.forEach(item => counts.set(item.author, (counts.get(item.author) || 0) + 1))
  $('#author-list').innerHTML = Array.from(counts).sort((a, b) => b[1] - a[1]).map(([author, count]) => `<button class="author-button" data-author="${author}"><span aria-hidden="true">${author[0]}</span>${author}<small>${count}</small></button>`).join('') || '<p>暂无下载记录</p>'
}
function renderPage() {
  Object.keys(PAGE_LABELS).forEach(name => { $(`#${name}`).hidden = name !== page })
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  $('#breadcrumb').textContent = `工作台 / ${PAGE_LABELS[page]}`
  $('#cookie-demo-label').hidden = page !== 'settings'
  const global = $('#global-state')
  global.hidden = !['loading', 'error', 'offline'].includes(scenario)
  if (!global.hidden) {
    $(`#${page}`).hidden = true
    const states = {
      loading: ['正在加载', '正在获取数据，请稍候。', '<div class="loader" aria-hidden="true"></div>'],
      error: ['暂时无法获取数据', '请求失败。请检查服务状态，然后重试。', '<button data-recover class="primary">重新加载</button>'],
      offline: ['连接不到下载服务', '请确认服务已启动，地址和端口正确，再尝试连接。', '<button data-recover class="primary">重新连接</button>']
    }
    global.innerHTML = emptyState(...states[scenario])
  }
  renderJobs()
  renderHistory()
}
function navigate() {
  page = location.hash.slice(1) in PAGE_LABELS ? location.hash.slice(1) : 'download'
  renderPage()
}
function parseInput() {
  const raw = $('#urls').value.trim()
  const matches = raw.match(/https?:\/\/[^\s<>"']+/g) || []
  parsedLinks = [...new Set(matches.map(url => url.replace(/[，。；！）)]+$/, '')))].map(url => {
    let parsed
    try { parsed = new URL(url) } catch { return { url, valid: false, name: '链接格式无效' } }
    const allowed = ['www.douyin.com', 'douyin.com', 'v.douyin.com', 'live.douyin.com'].includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port
    let name = '暂不支持的链接'
    if (allowed) {
      if (parsed.hostname === 'v.douyin.com') name = '短链接 · 提交后解析'
      else if (parsed.hostname === 'live.douyin.com') name = '直播'
      else if (/^\/user\//.test(parsed.pathname)) name = '用户主页'
      else if (/^\/(collection|mix)\//.test(parsed.pathname)) name = '合集'
      else if (/^\/music\//.test(parsed.pathname)) name = '音乐'
      else if (/^\/(note|gallery|slides)\//.test(parsed.pathname)) name = '图文链接'
      else if (/^\/video\//.test(parsed.pathname)) name = '单个作品'
    }
    return { url, name, valid: allowed && name !== '暂不支持的链接' }
  })
  $('#recognition').innerHTML = parsedLinks.length ? parsedLinks.map((link, index) => `<span class="badge ${link.valid ? 'running' : 'failed'}">${index + 1} · ${link.name}</span>`).join('') : raw ? '<span class="badge failed">未找到有效链接，请粘贴完整分享链接</span>' : '视频、图文、主页、合集、音乐、直播'
  $('#submit-download').disabled = !parsedLinks.length || parsedLinks.some(link => !link.valid)
  $('#submit-download').innerHTML = `加入队列${parsedLinks.length ? `（${parsedLinks.length}）` : ''} <span aria-hidden="true">↵</span>`
}
$('#urls').addEventListener('input', parseInput)
$('#urls').addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('#submit-download').disabled) $('#download-form').requestSubmit()
})
$('#fill-example').addEventListener('click', () => {
  $('#urls').value = 'https://www.douyin.com/video/7346000000000000002\nhttps://www.douyin.com/user/demo-shan'
  parseInput()
  $('#urls').focus()
})
$('#download-form').addEventListener('submit', event => {
  event.preventDefault()
  if (!parsedLinks.length || parsedLinks.some(link => !link.valid)) return
  // 接入点：每个 URL 单独 POST /api/v1/download；逐条提交，间隔至少 2 秒。
  // 真实提交时保留失败行；成功行记录 job_id，不要重提已成功的行。
  const count = parsedLinks.length
  parsedLinks.forEach((link, index) => jobs.unshift({ id: `demo-${Date.now()}-${index}`, name: link.name, url: link.url, status: 'pending', total: 0, success: 0, failed: 0, skipped: 0, time: '刚刚', error: null }))
  $('#urls').value = ''
  parseInput()
  scenario = 'normal'
  $('#scenario').value = scenario
  jobFilter = 'all'
  updateTabs()
  location.hash = 'jobs'
  renderPage()
  toast(`${count} 个演示任务已加入队列`)
})
function updateTabs() {
  document.querySelectorAll('[data-status]').forEach(button => {
    const selected = button.dataset.status === jobFilter
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-pressed', selected)
  })
}
$('#job-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-status]')
  if (!button) return
  jobFilter = button.dataset.status
  updateTabs()
  renderJobs()
})
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')
  if (action) {
    const job = jobs.find(item => item.id === action.closest('[data-job]').dataset.job)
    if (action.dataset.action === 'cancel') {
      // 接入点：POST /api/v1/jobs/{id}/cancel；等待服务返回终态后更新。
      job.status = 'cancelled'
      toast('演示任务已取消，已完成文件保留')
    } else if (action.dataset.action === 'retry') {
      // 接入点：POST /api/v1/jobs/{id}/retry；使用响应中的新 job_id。
      jobs.unshift({ ...job, id: `demo-${Date.now()}`, status: 'pending', success: 0, failed: 0, skipped: 0, total: 0, error: null, time: '刚刚' })
      jobFilter = 'all'
      updateTabs()
      toast('已创建新的演示任务，原任务保留')
    } else if (action.dataset.action === 'again') {
      $('#urls').value = job.url
      parseInput()
      location.hash = 'download'
    } else if (action.dataset.action === 'history') {
      $('#history-filters').reset()
      $('#job-filter').value = job.id
      $('#extra-filters').hidden = false
      $('#more-filters').setAttribute('aria-expanded', 'true')
      historyPage = 1
      location.hash = 'history'
    }
    renderJobs()
  }
  const pathButton = event.target.closest('[data-path-id]')
  if (pathButton) {
    const item = HISTORY.find(row => row.id === pathButton.dataset.pathId)
    $('#file-path').textContent = `Downloaded/${item.author}/post/${formatDate(item.create_time).replaceAll('/', '-')}_${item.title}_${item.id}/${item.type === 'video' ? 'video.mp4' : '01.jpg'}`
    $('#path-dialog').showModal()
  }
  const author = event.target.closest('[data-author]')
  if (author) {
    $('#search-field').value = 'author'
    $('#history-search').value = author.dataset.author
    $('#history-search').placeholder = '搜索作者…'
    historyPage = 1
    renderHistory()
  }
  if (event.target.closest('[data-recover]')) {
    scenario = 'normal'
    $('#scenario').value = scenario
    renderPage()
    toast('已恢复演示数据')
  }
})
$('#history-filters').addEventListener('submit', event => event.preventDefault())
$('#history-filters').addEventListener('input', () => {
  $('#history-search').placeholder = $('#search-field').value === 'author' ? '搜索作者…' : '搜索标题…'
  historyPage = 1
  renderHistory()
})
$('#history-filters').addEventListener('reset', () => setTimeout(() => {
  historyPage = 1
  $('#history-search').placeholder = '搜索作者…'
  renderHistory()
}, 0))
$('#more-filters').addEventListener('click', () => {
  $('#extra-filters').hidden = !$('#extra-filters').hidden
  $('#more-filters').setAttribute('aria-expanded', !$('#extra-filters').hidden)
})
$('#page-size').addEventListener('change', () => { historyPage = 1; renderHistory() })
$('#previous-page').addEventListener('click', () => { historyPage--; renderHistory() })
$('#next-page').addEventListener('click', () => { historyPage++; renderHistory() })
$('#close-dialog').addEventListener('click', () => $('#path-dialog').close())
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); toast('已复制') }
  catch { toast('浏览器不允许复制，请选中文本手动复制') }
}
$('#copy-path').addEventListener('click', () => copyText($('#file-path').textContent))
$('#copy-command').addEventListener('click', () => copyText('python -m tools.cookie_fetcher --config config.yml'))
$('#theme-toggle').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light'
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  $('#theme-toggle').textContent = light ? '深色外观' : '浅色外观'
})
$('#scenario').addEventListener('change', () => { scenario = $('#scenario').value; renderPage() })
$('#cookie-demo').addEventListener('change', () => {
  const states = { unknown: ['未检测', 'cancelled', '当前接口不返回 Cookie 有效性，不能据此判断是否可用。'], valid: ['有效 · 示例', 'success', '这是有效状态的文案样稿；并非实际检测结果。'], invalid: ['失效 · 示例', 'failed', 'Cookie 已失效，任务可能失败。请重新获取 Cookie 后重试。这是演示状态。'] }
  const [label, style, message] = states[$('#cookie-demo').value]
  $('#cookie-status').textContent = label
  $('#cookie-status').className = `badge ${style}`
  $('#cookie-message').textContent = message
})
$('#reset-demo').addEventListener('click', () => location.reload())
window.addEventListener('hashchange', () => {
  navigate()
  $('#main').focus({ preventScroll: true })
  window.scrollTo(0, 0)
})
// 接入点：GET /api/v1/jobs，单次响应合并更新；保留 DOM 和焦点。
// 只演示已有运行任务的计数变化。排队任务不伪造真实解析结果。
setInterval(() => {
  if (document.hidden || scenario !== 'normal' || !['download', 'jobs'].includes(page)) return
  const job = jobs.find(item => item.status === 'running')
  if (!job) return
  const processed = job.success + job.failed + job.skipped
  if (processed < job.total - 1) {
    job.success++
    document.querySelectorAll(`[data-job="${job.id}"]`).forEach(card => {
      card.querySelector('[data-count="success"]').textContent = job.success
      const progress = card.querySelector('.progress')
      progress.setAttribute('aria-valuenow', processed + 1)
      progress.firstElementChild.style.width = `${(processed + 1) / job.total * 100}%`
    })
  } else {
    job.success++
    job.status = 'success'
    renderJobs()
    toast('演示任务已完成')
  }
}, 2000)
updateTabs()
navigate()
