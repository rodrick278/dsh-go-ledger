// 记账：dsh-go 手机 App 的原生面板 + 截图提醒。
// 数据在 $DSH_HOME/dsh-go/ledger/records.json，和 bin/ledger.mjs 共用。
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATA_DIR, HOME, addRecord, clockOf, dayKey, dayLabel, loadRecords, money,
  monthStats, recentRecords, removeRecord, todayStats, updateRecord,
} from './store.js'

export const name = 'local-ledger'

const CATS = {
  expense: [
    ['餐饮', '🍜'], ['交通', '🚌'], ['购物', '🛍'], ['日用', '🧴'],
    ['娱乐', '🎮'], ['医疗', '💊'], ['房租', '🏠'], ['水电', '💡'], ['其他', '✨'],
  ],
  income: [['工资', '💼'], ['红包', '🧧'], ['退款', '↩'], ['兼职', '💪'], ['其他', '✨']],
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const drafts = new Map()
function draftFor(scope) {
  const key = scope && scope.sessionId ? scope.sessionId : 'default'
  let d = drafts.get(key)
  if (!d) {
    d = { mode: 'home', type: 'expense', amount: '', category: '', note: '', date: ymd(), editingId: '', editingTime: '', pendingDelete: false, picked: null }
    drafts.set(key, d)
  }
  return d
}

function shortName(name, max = 26) {
  const s = String(name || '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function extFor(file) {
  const name = String(file?.name || '')
  const m = /\.(jpe?g|png|webp)$/i.exec(name)
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  const type = String(file?.mediaType || '')
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  return 'jpg'
}

function hashOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const SHOT_DIRS = ['/sdcard/DCIM/Screenshots', '/sdcard/Pictures/Screenshots']

function scanShotDir(dir, size, sha) {
  let names
  try { names = readdirSync(dir) } catch { return '' }
  for (const name of names) {
    const path = join(dir, name)
    let st
    try { st = statSync(path) } catch { continue }
    if (!st.isFile() || st.size !== size) continue
    try {
      if (hashOf(readFileSync(path)) === sha) return path
    } catch {}
  }
  return ''
}

function findOriginal(name, size, sha) {
  const safe = String(name || '').split(/[\\/]/).pop()
  if (safe) {
    for (const dir of SHOT_DIRS) {
      try {
        const path = join(dir, safe)
        const st = statSync(path)
        if (st.isFile() && st.size === size) return path
      } catch {}
    }
  }
  for (const dir of SHOT_DIRS) {
    const hit = scanShotDir(dir, size, sha)
    if (hit) return hit
  }
  return ''
}

function shortMoney(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function groupByDay(records) {
  const groups = []
  let current = null
  for (const r of records) {
    const key = dayKey(new Date(r.time))
    if (!current || current.key !== key) {
      current = { key, items: [], expense: 0, income: 0 }
      groups.push(current)
    }
    current.items.push(r)
    if (r.type === 'income') current.income += Number(r.amount)
    else current.expense += Number(r.amount)
  }
  return groups
}

function formData(d) {
  return {
    form: {
      amount: d.amount === '' ? null : Number(d.amount),
      category: d.category || null,
      note: d.note || '',
      date: d.date || ymd(),
    },
  }
}

function root(kids) {
  return { v: 2, type: 'stack', children: kids, style: { gap: 'M', padding: 'M' } }
}

function homeView(d, caps) {
  const t = todayStats()
  const m = monthStats()
  const recs = recentRecords(30)
  const kids = []

  kids.push({
    type: 'actions',
    items: [
      { label: '记支出', action: 'newExpense', style: 'primary' },
      { label: '记收入', action: 'newIncome' },
    ],
  })

  const canPick = !Array.isArray(caps?.features) || caps.features.includes('files')
  if (!canPick) {
    kids.push({ type: 'callout', text: '当前版本不支持选图，可直接在对话里附上截图', tone: 'info' })
  } else if (d.picked) {
    kids.push({ type: 'callout', text: `已选：${shortName(d.picked.name)}`, tone: 'info' })
    kids.push({
      type: 'actions',
      items: [
        { label: '识别这张图记账', icon: 'camera', action: 'recognize', style: 'primary' },
        { label: '重新选', icon: 'refresh', action: 'pick' },
      ],
    })
  } else {
    kids.push({ type: 'actions', items: [{ label: '上传截图记账', icon: 'camera', action: 'pick' }] })
  }

  kids.push({
    type: 'row', style: { gap: 'S' }, children: [
      { type: 'metric', label: '今日支出', value: `¥${money(t.expense)}`, tone: 'bad', caption: `${t.expenseCount} 笔` },
      { type: 'metric', label: '今日收入', value: `¥${money(t.income)}`, tone: 'good', caption: `${t.incomeCount} 笔` },
    ],
  })
  kids.push({ type: 'text', text: `本月支出 ¥${money(m.expense)} · ${m.expenseCount} 笔`, tone: 'muted' })

  kids.push({ type: 'text', text: '流水', tone: 'muted' })
  if (recs.length === 0) {
    kids.push({ type: 'emptyState', title: '还没有记账', message: '点上面的「记支出」记第一笔', icon: 'money' })
  } else {
    const groups = groupByDay(recs).slice(0, 7)
    for (const g of groups) {
      const d = new Date(g.items[0].time)
      const parts = [`支出 ¥${shortMoney(g.expense)}`]
      if (g.income > 0) parts.push(`收入 ¥${shortMoney(g.income)}`)
      kids.push({ type: 'text', text: `${d.getMonth() + 1}月${d.getDate()}日 · ${parts.join(' · ')}`, style: { weight: 'medium' } })
      kids.push({ type: 'divider' })
      kids.push({
        type: 'list',
        items: g.items.map((r) => ({
          title: r.note ? `${r.category} · ${r.note}` : r.merchant ? `${r.category} · ${r.merchant}` : r.category,
          subtitle: clockOf(new Date(r.time).getTime()),
          trailing: `${r.type === 'income' ? '+' : '-'}¥${money(r.amount)}`,
          tone: r.type === 'income' ? 'good' : 'bad',
          action: { id: 'edit', args: { id: r.id } },
        })),
      })
    }
    kids.push({ type: 'text', text: '点一条可以改', tone: 'muted' })
  }


  return root(kids)
}

function entryView(d) {
  const isIncome = d.type === 'income'
  const cats = CATS[d.type]
  const kids = []

  kids.push({
    type: 'text',
    text: `${d.editingId ? '改一笔' : '记一笔'}${isIncome ? '收入' : '支出'}`,
    style: { size: 'title', weight: 'bold' },
  })
  if (d.editingId) {
    kids.push({ type: 'text', text: `原来是 ${dayLabel(d.editingTime)} ${clockOf(new Date(d.editingTime).getTime())}`, tone: 'muted' })
  }

  kids.push({
    type: 'form',
    submit: 'save',
    submitLabel: d.editingId ? '保存修改' : '保存',
    children: [
      { type: 'number', label: '金额（元）', bind: 'data.form.amount', placeholder: '0.00', required: true, min: 0.01, max: 10000000, step: 0.01 },
      {
        type: 'chips',
        label: '分类',
        bind: 'data.form.category',
        options: cats.map(([name, emoji]) => ({ label: `${emoji} ${name}`, value: name })),
      },
      { type: 'textField', label: '备注', bind: 'data.form.note', placeholder: '选填，如：午饭、电费', maxLength: 60 },
      { type: 'date', label: '日期', bind: 'data.form.date' },
    ],
  })

  kids.push({ type: 'actions', items: [{ label: '← 返回', action: 'back' }] })
  if (d.editingId) kids.push({ type: 'actions', items: [{ label: '删除这笔', action: 'askdel' }] })

  if (d.pendingDelete) {
    kids.push({ type: 'callout', text: '删除这笔记录？', tone: 'bad' })
    kids.push({ type: 'actions', items: [{ label: '删除', action: 'del', style: 'primary' }, { label: '取消', action: 'cancelDel' }] })
  }

  return root(kids)
}

function buildView(scope, caps) {
  const d = draftFor(scope)
  return d.mode === 'entry' ? entryView(d) : homeView(d, caps)
}

function startEntry(scope, type) {
  const d = draftFor(scope)
  d.mode = 'entry'
  d.type = type
  d.amount = ''
  d.category = ''
  d.note = ''
  d.date = ymd()
  d.editingId = ''
  d.editingTime = ''
  d.pendingDelete = false
  return { patch: formData(d), refresh: true }
}

function goHome(d) {
  d.mode = 'home'
  d.amount = ''
  d.category = ''
  d.note = ''
  d.date = ymd()
  d.editingId = ''
  d.editingTime = ''
  d.pendingDelete = false
}

function timeFor(dateStr, originalIso) {
  const now = new Date()
  const [y, m, d] = String(dateStr || ymd()).split('-').map(Number)
  if (originalIso) {
    const old = new Date(originalIso)
    if (!Number.isNaN(old.getTime()) && ymd(old) === `${y}-${pad(m)}-${pad(d)}`) return old.toISOString()
  }
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}

const handlers = {
  newExpense: (scope) => startEntry(scope, 'expense'),
  newIncome: (scope) => startEntry(scope, 'income'),
  back: (scope) => { goHome(draftFor(scope)); return { refresh: true } },
  edit: (scope, event) => {
    const id = String(event?.value?.id ?? '')
    const rec = loadRecords().find((r) => r.id === id)
    if (!rec) return { toast: '没找到这条' }
    const d = draftFor(scope)
    d.mode = 'entry'
    d.type = rec.type === 'income' ? 'income' : 'expense'
    d.amount = money(rec.amount)
    d.category = rec.category || '其他'
    d.note = rec.note || ''
    d.date = ymd(new Date(rec.time))
    d.editingId = rec.id
    d.editingTime = rec.time
    d.pendingDelete = false
    return { patch: formData(d), refresh: true }
  },
  save: (scope, event) => {
    const d = draftFor(scope)
    const values = event?.value?.values ?? {}
    const amount = Number(values['data.form.amount'])
    const category = String(values['data.form.category'] || '其他')
    const note = String(values['data.form.note'] || '').slice(0, 60)
    const date = String(values['data.form.date'] || d.date || ymd())
    if (!Number.isFinite(amount) || amount <= 0) return { toast: '先输入金额' }
    try {
      if (d.editingId) {
        updateRecord(d.editingId, { amount, type: d.type, category, note, time: timeFor(date, d.editingTime) })
        const msg = `已改好 ${d.type === 'income' ? '+' : '-'}¥${money(amount)}`
        goHome(d)
        return { toast: msg, refresh: true }
      }
      const rec = addRecord({ amount, type: d.type, category, note, time: timeFor(date, null), source: 'manual' })
      const msg = `已记 ${rec.type === 'income' ? '+' : '-'}¥${money(rec.amount)}`
      goHome(d)
      return { toast: msg, refresh: true }
    } catch {
      return { toast: '没记上，再试一次' }
    }
  },
  askdel: (scope) => { draftFor(scope).pendingDelete = true; return { refresh: true } },
  cancelDel: (scope) => { draftFor(scope).pendingDelete = false; return { refresh: true } },
  del: (scope) => {
    const d = draftFor(scope)
    if (!d.editingId) { goHome(d); return { refresh: true } }
    const ok = removeRecord(d.editingId)
    goHome(d)
    return { toast: ok ? '已删除' : '没找到这条', refresh: true }
  },
  pick: () => ({ type: 'pickImage', action: 'picked', maxFiles: 1 }),
  recognize: (scope) => {
    const d = draftFor(scope)
    if (!d.picked || !d.picked.path) return { toast: '先选一张截图' }
    const path = d.picked.path
    d.picked = null
    return {
      insert: `记账：识别这张截图并按 ledger 技能记一笔 → ${path}`,
      toast: '已放进输入框，点发送记账',
      refresh: true,
    }
  },
}

function installSupport() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const cli = fileURLToPath(new URL('../bin/ledger.mjs', import.meta.url))
    const wrapper = join(DATA_DIR, 'ledger')
    writeFileSync(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(cli)} "$@"\n`)
    chmodSync(wrapper, 0o755)
    const skillDir = join(HOME, 'skills', 'ledger')
    const skillFile = join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) {
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(skillFile, readFileSync(fileURLToPath(new URL('../skill/SKILL.md', import.meta.url))))
    }
  } catch {}
}

export function apply(ctx) {
  installSupport()
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.on('add', (scope) => { goHome(draftFor(scope)); return { open: 'panel:ledger' } })
    ctx.dshGo.on('today', (scope) => { goHome(draftFor(scope)); return { open: 'panel:ledger' } })

    const picked = (scope, event) => {
      const v = event?.value
      if (!v || v.status !== 'selected' || !Array.isArray(v.files) || v.files.length === 0) {
        return { toast: '已取消' }
      }
      const file = v.files[0]
      let bytes
      try { bytes = ctx.dshGo.readPickedFile(file.handle) } catch { return { toast: '读取图片失败' } }
      try {
        const inbox = join(DATA_DIR, 'inbox')
        mkdirSync(inbox, { recursive: true })
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const path = join(inbox, `${id}.${extFor(file)}`)
        writeFileSync(path, bytes)
        const sha = hashOf(bytes)
        const original = findOriginal(file.name, bytes.length, sha)
        writeFileSync(`${path}.json`, JSON.stringify({ name: file.name, bytes: bytes.length, sha256: sha, original }))
        const d = draftFor(scope)
        d.picked = { path, name: file.name || `${id}.jpg`, original }
        return { refresh: true, toast: '已选好，点「识别这张图记账」' }
      } catch {
        return { toast: '保存图片失败' }
      }
    }

    ctx.dshGo.panel('ledger', {
      view: (scope, caps) => buildView(scope, caps),
      data: (scope, emit) => {
        emit(formData(draftFor(scope)))
        return () => {}
      },
      actions: { ...handlers, picked },
    })

    ctx.dshGo.strip('today', (scope, emit) => {
      let alive = true
      const tick = () => {
        if (!alive) return
        try {
          const t = todayStats()
          const text = `今日 -¥${money(t.expense)} +¥${money(t.income)}`
          emit({ text: text.length > 24 ? `今日 -¥${Math.round(t.expense)}` : text, icon: 'money' })
        } catch {
          emit({ text: '记账', icon: 'money' })
        }
      }
      tick()
      const timer = setInterval(tick, 30000)
      timer.unref?.()
      return () => { alive = false; clearInterval(timer) }
    })

  })
}
