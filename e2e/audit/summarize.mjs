import fs from 'node:fs'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'e2e', 'audit', 'out')
const roles = ['admin', 'desk', 'engineer', 'warehouse', 'sales'].filter((r) => fs.existsSync(path.join(OUT, `${r}.json`)))
const data = Object.fromEntries(roles.map((r) => [r, JSON.parse(fs.readFileSync(path.join(OUT, `${r}.json`), 'utf8'))]))
const mode = process.argv[2] ?? 'matrix'

if (mode === 'matrix') {
  const paths = Array.from(new Set(roles.flatMap((r) => data[r].map((p) => p.path))))
  const cell = (p) => {
    if (!p) return '-'
    const s = { ok: 'OK', denied: 'DENY', notfound: '404', crash: 'CRASH', redirect: '->' + p.finalPath, blank: 'BLANK' }[p.state]
    return `${p.inNav ? '*' : ' '}${s}${p.api403 ? ` 403x${p.api403}` : ''}`
  }
  console.log(['route'.padEnd(26), ...roles.map((r) => r.padEnd(22))].join(''))
  for (const route of paths) {
    console.log([route.padEnd(26), ...roles.map((r) => cell(data[r].find((p) => p.path === route)).padEnd(22))].join(''))
  }
  console.log('\n* = in sidebar nav')
}

if (mode === 'errors' || mode === 'buttons') {
  for (const r of roles) {
    console.log(`\n===== ${r} =====`)
    for (const p of data[r]) {
      const parts = []
      if (mode === 'errors') {
        const api = [...new Set(p.apiErrors)]
        if (api.length) parts.push(`api: ${api.join(' | ')}`)
        const ce = [...new Set(p.consoleErrors)].filter((m) => !/Failed to load resource/.test(m))
        if (ce.length) parts.push(`console: ${ce.slice(0, 4).join(' | ')}`)
        if (p.pageErrors.length) parts.push(`pageerror: ${[...new Set(p.pageErrors)].join(' | ')}`)
        if (p.toasts?.length) parts.push(`toasts: ${p.toasts.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`)
        if (p.leavePrompts?.length) parts.push(`leave-prompt on: ${[...new Set(p.leavePrompts)].join(' | ')}`)
      } else {
        if (p.dead.length) parts.push(`DEAD: ${p.dead.join(' | ')}`)
        if (p.nonClickable.length) parts.push(`NONCLICK: ${p.nonClickable.join(' | ')}`)
        if (p.stuckDialogs.length) parts.push(`STUCK: ${p.stuckDialogs.join(' | ')}`)
        if (p.blockedWrites.length) parts.push(`writes: ${[...new Set(p.blockedWrites)].join(' | ')}`)
        if (p.disabled.length) parts.push(`disabled: ${p.disabled.join(' | ')}`)
        if (p.buttonsTested) parts.push(`(tested ${p.buttonsTested})`)
      }
      if (parts.length) console.log(`${p.path}\n   ${parts.join('\n   ')}`)
    }
  }
}
