#!/usr/bin/env node
// 账本命令行：给 DSH 助手读写同一份 records.json。
import {
  addRecord, dayKey, loadRecords, money, monthKey, monthStats, removeRecord,
  latestShot, todayStats, recentRecords,
} from '../lib/store.js'

const argv = process.argv.slice(2)
const cmd = argv.shift() || 'help'

function take(name, short) {
  const i = argv.findIndex((a) => a === `--${name}` || (short && a === `-${short}`))
  if (i < 0) return undefined
  const v = argv[i + 1]
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1)
  return v && !v.startsWith('--') ? v : true
}
const has = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0) { argv.splice(i, 1); return true }
  return false
}

const json = has('json')
const pad = (n) => String(n).padStart(2, '0')
const stamp = (r) => {
  const d = new Date(r.time)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const line = (r) => `${stamp(r)}  ${r.type === 'income' ? '+' : '-'}¥${money(r.amount)}  ${r.category}${r.note ? ` · ${r.note}` : ''}${r.merchant ? ` · ${r.merchant}` : ''}  [${r.id}]`

if (cmd === 'add') {
  const amount = take('amount', 'a')
  const type = take('type', 't') || 'expense'
  const category = take('category', 'c') || '其他'
  const note = take('note', 'n') || ''
  const merchant = take('merchant', 'm') || ''
  const time = take('time') || new Date().toISOString()
  const source = take('source') || 'chat'
  if (!amount) { console.error('缺少 --amount'); process.exit(2) }
  if (!['expense', 'income'].includes(type)) { console.error('--type 只能是 expense 或 income'); process.exit(2) }
  try {
    const rec = addRecord({ amount, type, category, note, merchant, time, source })
    console.log(json ? JSON.stringify(rec) : `已记账：${line(rec)}`)
  } catch (e) {
    console.error(String(e.message || e)); process.exit(1)
  }
} else if (cmd === 'list') {
  const today = has('today')
  const month = has('month')
  const limit = Number(take('limit', 'l')) || 30
  let list = loadRecords()
  if (today) list = list.filter((r) => dayKey(new Date(r.time)) === dayKey())
  if (month) list = list.filter((r) => monthKey(new Date(r.time)) === monthKey())
  list = [...list].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, limit)
  if (json) console.log(JSON.stringify(list, null, 1))
  else if (list.length === 0) console.log('没有记录')
  else console.log(list.map(line).join('\n'))
} else if (cmd === 'delete') {
  const id = take('id')
  if (!id) { console.error('缺少 --id'); process.exit(2) }
  console.log(removeRecord(id) ? '已删除' : '没找到这条记录')
} else if (cmd === 'latest-shot') {
  const shot = latestShot()
  if (!shot) { console.log(json ? 'null' : '相册里没有截图'); process.exit(0) }
  if (json) console.log(JSON.stringify(shot))
  else console.log(`${shot.path}\n${stamp({ time: new Date(shot.mtime).toISOString() })}`)
} else if (cmd === 'stats') {
  const t = todayStats()
  const m = monthStats()
  if (json) console.log(JSON.stringify({ today: t, month: m }, null, 1))
  else {
    console.log(`今日支出 ¥${money(t.expense)}（${t.expenseCount} 笔） · 收入 ¥${money(t.income)}（${t.incomeCount} 笔）`)
    console.log(`本月支出 ¥${money(m.expense)}（${m.expenseCount} 笔） · 收入 ¥${money(m.income)}（${m.incomeCount} 笔）`)
    const recs = recentRecords(5)
    if (recs.length) console.log('\n最近：\n' + recs.map(line).join('\n'))
  }
} else {
  console.log(`用法：
  ledger.mjs add --amount 25.5 [--type expense|income] [--category 餐饮] [--note 午饭] [--merchant 美团] [--time 2026-11-04T12:30] [--json]
  ledger.mjs list [--today|--month] [--limit 30] [--json]
  ledger.mjs delete --id rxxx
  ledger.mjs latest-shot [--json]
  ledger.mjs stats [--json]
账本：$DSH_HOME/dsh-go/ledger/records.json`)
}
