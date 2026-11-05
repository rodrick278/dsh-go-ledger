// 账本存储：一个 JSON 文件，插件面板和命令行工具共用。
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const DATA_DIR = join(HOME, 'dsh-go', 'ledger')
export const RECORDS_FILE = join(DATA_DIR, 'records.json')
export const CONFIG_FILE = join(DATA_DIR, 'config.json')

const SHOT_DIRS = ['/sdcard/DCIM/Screenshots', '/sdcard/Pictures/Screenshots']
const SHOT_RE = /^Screenshot_.*\.(jpe?g|png|webp)$/i

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 1))
  renameSync(tmp, file)
}

export function loadRecords() {
  const raw = readJson(RECORDS_FILE, null)
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.records) ? raw.records : []
  return list.filter((r) => r && typeof r.time === 'string' && Number.isFinite(Number(r.amount)))
}

export function saveRecords(records) {
  writeJson(RECORDS_FILE, { v: 1, records })
}

export function loadConfig() {
  const raw = readJson(CONFIG_FILE, {}) || {}
  return {
    shotNotify: raw.shotNotify !== false,
    lastNotified: typeof raw.lastNotified === 'string' ? raw.lastNotified : '',
    lastNotifyAt: Number(raw.lastNotifyAt) || 0,
    handledKey: typeof raw.handledKey === 'string' ? raw.handledKey : '',
  }
}

export function saveConfig(cfg) {
  writeJson(CONFIG_FILE, cfg)
}

const pad = (n) => String(n).padStart(2, '0')
export function dayKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export function monthKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }

export function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v.toFixed(2)
}

export function clockOf(ms) {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dayLabel(time) {
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (dayKey(d) === dayKey(now)) return '今天'
  const y = new Date(now.getTime() - 86400000)
  if (dayKey(d) === dayKey(y)) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function statsOf(records, keep) {
  const out = { expense: 0, income: 0, expenseCount: 0, incomeCount: 0 }
  for (const r of records) {
    if (keep && !keep(r)) continue
    if (r.type === 'income') { out.income += Number(r.amount); out.incomeCount++ }
    else { out.expense += Number(r.amount); out.expenseCount++ }
  }
  return out
}

export function todayStats(records = loadRecords()) {
  const k = dayKey()
  return statsOf(records, (r) => dayKey(new Date(r.time)) === k)
}

export function monthStats(records = loadRecords()) {
  const k = monthKey()
  return statsOf(records, (r) => monthKey(new Date(r.time)) === k)
}

export function recentRecords(limit = 8, records = loadRecords()) {
  return [...records]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limit)
}

export function addRecord(input) {
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额不对')
  const records = loadRecords()
  const rec = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: input.type === 'income' ? 'income' : 'expense',
    amount,
    category: String(input.category || '其他').slice(0, 12),
    note: String(input.note || '').slice(0, 60),
    merchant: String(input.merchant || '').slice(0, 40),
    time: input.time || new Date().toISOString(),
    source: input.source || 'manual',
    createdAt: new Date().toISOString(),
  }
  records.push(rec)
  saveRecords(records)
  return rec
}

export function updateRecord(id, patch) {
  const records = loadRecords()
  const index = records.findIndex((r) => r.id === id)
  if (index < 0) return null
  const rec = { ...records[index] }
  if (patch.amount !== undefined) {
    const amount = Math.round(Number(patch.amount) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额不对')
    rec.amount = amount
  }
  if (patch.type !== undefined) rec.type = patch.type === 'income' ? 'income' : 'expense'
  if (patch.category !== undefined) rec.category = String(patch.category || '其他').slice(0, 12)
  if (patch.note !== undefined) rec.note = String(patch.note || '').slice(0, 60)
  if (patch.merchant !== undefined) rec.merchant = String(patch.merchant || '').slice(0, 40)
  if (patch.time !== undefined) rec.time = patch.time
  rec.editedAt = new Date().toISOString()
  records[index] = rec
  saveRecords(records)
  return rec
}

export function removeRecord(id) {
  const records = loadRecords()
  const next = records.filter((r) => r.id !== id)
  if (next.length === records.length) return false
  saveRecords(next)
  return true
}

export function latestShot() {
  let best = null
  for (const dir of SHOT_DIRS) {
    let names
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!SHOT_RE.test(name)) continue
      let st
      try { st = statSync(join(dir, name)) } catch { continue }
      if (!st.isFile() || st.size < 1024) continue
      if (!best || st.mtimeMs > best.mtime) {
        best = { path: join(dir, name), name, mtime: st.mtimeMs, key: `${name}@${Math.round(st.mtimeMs)}` }
      }
    }
  }
  return best
}

/** 最近一张还没被处理过的截图（12 小时内）。 */
export function pendingShot(now = Date.now()) {
  const shot = latestShot()
  if (!shot) return null
  const cfg = loadConfig()
  if (cfg.handledKey === shot.key) return null
  if (now - shot.mtime > 12 * 3600 * 1000) return null
  return shot
}

export function markHandled(key) {
  const cfg = loadConfig()
  if (cfg.handledKey === key) return
  cfg.handledKey = key
  saveConfig(cfg)
}
