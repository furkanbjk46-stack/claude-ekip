import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren, ThemeKey } from 'claude-code'

import type { Task, View, Worker } from '../types'
import { KURALLAR } from './kurallar'

const PANE = 'ekip-paneli'
const TITLE = 'Ekip'
// Bir Worker'ın alanları değişirse etiketi değiştir: eski kayıt yeniden yüklemede okunmaz.
const workers = atom({ plugin: 'ekip-paneli', key: 'workers' } as const, [], {
  shape: 'workers-1',
})
const tasks = atom({ plugin: 'ekip-paneli', key: 'tasks' } as const, [], {
  shape: 'tasks-1',
})
const view = atom({ plugin: 'ekip-paneli', key: 'view' } as const, { tasksOpen: true, open: [] } as View, {
  shape: 'view-1',
})
// Oturumlar arası kayıt ($.store): dakikalık kova başına model ailesi ve token, 5 saatlik pencere için
const LOG_KEY = 'log5h'
type LogRow = { t: number; f: string; tok: number; out: number }
const HOUR = 3600e3

type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'diger'
// Renkler Claude'un kendi tema renkleri: açık ve koyu modda uygulamayla aynı tonlarda çizilir.
const FAMILY: Record<Family, { name: string; color: ThemeKey; inp: number; out: number; cr: number }> = {
  // Fiyatlar 1M token başına dolar (API liste fiyatı); abonelikte bilgi amaçlı
  fable: { name: 'Fable', color: 'claude', inp: 8, out: 40, cr: 0.2 },
  opus: { name: 'Opus', color: 'suggestion', inp: 4, out: 20, cr: 0.2 },
  sonnet: { name: 'Sonnet', color: 'success', inp: 2, out: 10, cr: 0.1 },
  haiku: { name: 'Haiku', color: 'warning', inp: 0.1, out: 0.5, cr: 0.01 },
  diger: { name: 'Diğer', color: 'inactive', inp: 0, out: 0, cr: 0 },
}
const ORDER: Family[] = ['fable', 'opus', 'sonnet', 'haiku', 'diger']
// Ekibin kadrosu: CLAUDE.md'deki işçiler. Henüz çalışmamış olanlar da panelde görünür.
const ROSTER: { fam: Family; role: string }[] = [
  { fam: 'haiku', role: 'Arama işçisi' },
  { fam: 'sonnet', role: 'Uygulayıcı' },
  { fam: 'opus', role: 'Kıdemli usta' },
  { fam: 'fable', role: 'Zor iş uzmanı' },
]

function familyOf(model: string): Family {
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'diger'
}
function shortModel(model: string): string {
  const m = model.toLowerCase().replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const parts = m.split('-')
  const fam = FAMILY[familyOf(model)].name
  const ver = parts.slice(1).filter(p => /^\d+$/.test(p)).slice(0, 2).join('.')
  return ver ? `${fam} ${ver}` : fam
}
function tokens(w: Worker): number {
  return w.inTok + w.outTok + w.cacheRead + w.cacheWrite
}
function cost(w: Worker): number {
  const f = FAMILY[familyOf(w.model)]
  return (w.inTok * f.inp + w.cacheWrite * f.inp * 1.25 + w.cacheRead * f.cr + w.outTok * f.out) / 1e6
}
function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}
function money(n: number): string {
  return '$' + (n < 0.01 ? n.toFixed(3) : n.toFixed(2)).replace('.', ',')
}

type Level = 'Kolay' | 'Orta' | 'Zor'
// Zorluk, işin gerçekte ne kadar emek istediğine göre: istek sayısı, işçi sayısı, üretilen token, Fable'a çıkıldı mı
function levelOf(t: Task): Level {
  if (t.models.some(m => familyOf(m) === 'fable') || t.steps > 25 || t.agents >= 3 || t.outTok > 40000) return 'Zor'
  if (t.steps > 6 || t.agents >= 1 || t.outTok > 8000) return 'Orta'
  return 'Kolay'
}
function clock(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function asLog(v: unknown): LogRow[] {
  return Array.isArray(v) ? (v.filter(r => r && typeof r === 'object' && typeof (r as LogRow).t === 'number') as LogRow[]) : []
}

function blank(id: string, label: string, kind: string, model: string, now: number): Worker {
  return { id, label, kind, model, status: 'calisiyor', inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, steps: 0, startedAt: now }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ekip', description: 'Model ve token panelini aç' })
    await $.command.register({ name: 'ekip-sifirla', description: 'Ekip panelindeki sayaçları sıfırla' })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  // Usta–işçi kuralları: işçi çağırabilen (Agent aracı olan) her oturumun sistem istemine eklenir.
  // Alt ajanların isteminde Agent aracı olmadığı için onlara eklenmez.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes('Agent')) return r
    return { sections: [...r.sections, { id: 'ekip-paneli:kurallar', text: KURALLAR, scope: 'session' as const }] }
  })

  on('command.run', { command: 'ekip' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Ekip paneli açıldı.' }
  })

  on('command.run', { command: 'ekip-sifirla' }, async $ => {
    await update($, workers, () => [])
    await update($, tasks, () => [])
    return { text: 'Ekip panelinin sayaçları sıfırlandı.' }
  })

  // Usta (ana oturum) yeni bir tur başlatınca
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      const text = e.text.replace(/\s+/g, ' ').trim()
      await update($, tasks, list => {
        if (!text && list.length) return list.map((t, i) => (i === list.length - 1 ? { ...t, active: true } : t))
        const task: Task = { id: e.turnId, text: text.slice(0, 90) || 'Devam', startedAt: now, steps: 0, tok: 0, outTok: 0, agents: 0, models: [], active: true }
        return [...list.map(t => ({ ...t, active: false })), task].slice(-30)
      })
      const model = await $.session.model()
      await update($, workers, list =>
        list.some(w => w.id === 'main')
          ? list.map(w => (w.id === 'main' ? { ...w, status: 'calisiyor' as const } : w))
          : [blank('main', 'Ana oturum', 'usta', model, now), ...list],
      )
    }
    return next(e)
  })

  // Usta bir işçi (alt ajan) çağırınca
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const now = await $.clock.now()
      const row = blank(r.agentId, e.description || e.subagentType, e.subagentType, r.model || e.model || e.parentModel, now)
      await update($, workers, list => [...list.filter(w => w.id !== row.id), row].slice(-60))
      await update($, tasks, list => list.map(t => (t.active ? { ...t, agents: t.agents + 1 } : t)))
    }
    return r
  })

  // Her model isteği: hangi model yanıtladı, kaç token harcandı
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      const id = e.agentId ?? 'main'
      const now = await $.clock.now()
      await update($, workers, list => {
        const has = list.some(w => w.id === id)
        const base = has ? list : [...list, blank(id, id === 'main' ? 'Ana oturum' : 'Alt ajan', id === 'main' ? 'usta' : 'işçi', u.model, now)]
        return base.map(w =>
          w.id === id
            ? {
                ...w,
                model: u.model || w.model,
                status: 'calisiyor' as const,
                inTok: w.inTok + (u.input_tokens || 0),
                outTok: w.outTok + (u.output_tokens || 0),
                cacheRead: w.cacheRead + (u.cache_read_input_tokens || 0),
                cacheWrite: w.cacheWrite + (u.cache_creation_input_tokens || 0),
                steps: w.steps + 1,
              }
            : w,
        )
      })
      const tok = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      await update($, tasks, list =>
        list.map(t =>
          t.active
            ? { ...t, steps: t.steps + 1, tok: t.tok + tok, outTok: t.outTok + (u.output_tokens || 0), models: t.models.includes(u.model) ? t.models : [...t.models, u.model] }
            : t,
        ),
      )
      const bucket = Math.floor(now / 60000) * 60000
      const fam = familyOf(u.model)
      const log = asLog(await $.store.get(LOG_KEY)).filter(r => r.t >= now - 6 * HOUR)
      const hit = log.find(r => r.t === bucket && r.f === fam)
      if (hit) {
        hit.tok += tok
        hit.out += u.output_tokens || 0
      } else log.push({ t: bucket, f: fam, tok, out: u.output_tokens || 0 })
      await $.store.set(LOG_KEY, log)
    }
    return result
  })

  // Tur bitince: işçi "bitti", usta "bekliyor"
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId ?? 'main'
    const now = await $.clock.now()
    await update($, workers, list =>
      list.map(w =>
        w.id === id ? { ...w, status: id === 'main' ? ('bekliyor' as const) : ('bitti' as const), endedAt: now } : w,
      ),
    )
    if (id === 'main') await update($, tasks, list => list.map(t => (t.active ? { ...t, active: false, endedAt: now } : t)))
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Progress } = ui
    // İnce çubuk masaüstünde SVG ile çizilir; SVG'si olmayan yüzeylerde yerleşik ilerleme çubuğu kullanılır
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const list = await read($, workers)

    const total = list.reduce((s, w) => s + tokens(w), 0)
    const totalCost = list.reduce((s, w) => s + cost(w), 0)
    const byFam = new Map<Family, { tok: number; model: string; steps: number }>()
    for (const w of list) {
      const f = familyOf(w.model)
      const cur = byFam.get(f) ?? { tok: 0, model: w.model, steps: 0 }
      byFam.set(f, { tok: cur.tok + tokens(w), model: w.model, steps: cur.steps + w.steps })
    }
    const fams = ORDER.filter(f => (byFam.get(f)?.tok ?? 0) > 0).sort((a, b) => (byFam.get(b)?.tok ?? 0) - (byFam.get(a)?.tok ?? 0))
    const running = list.filter(w => w.status === 'calisiyor').length
    const pct = (n: number) => Math.round((n / Math.max(1, total)) * 100)

    // Plan kullanım sınırları kartındaki ince, yuvarlak uçlu çubuk: gri iz, mavi dolgu
    const bar = (k: string, frac: number) => {
      // Oranı sabit (440×6) bir çizim: yüzey onu genişliğe göre eşit ölçekler, yuvarlak uçlar ezilmez
      const W = 440
      const w = Math.max(0, Math.min(1, frac)) * W
      const src = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${((2000 * 6) / W).toFixed(1)}" viewBox="0 0 ${W} 6"><rect x="0" y="0" width="${W}" height="6" rx="3" ry="3" fill="#8a8a8a" fill-opacity="0.28"/>${w > 0 ? `<rect x="0" y="0" width="${Math.max(6, w).toFixed(1)}" height="6" rx="3" ry="3" fill="#3B82F6"/>` : ''}</svg>`
      return Svg ? (
        <Svg key={k} source={src} alt={`%${Math.round(frac * 100)}`} />
      ) : (
        <Progress key={k} label="Pay" value={Math.round(frac * 100)} max={100} valueText={`%${Math.round(frac * 100)}`} />
      )
    }
    // Bir satır: solda etiket, sağda soluk ayrıntı ve yüzde; altında çubuk
    const row = (k: string, label: string, detail: string, right: string, frac: number) => (
      <Box key={k} flexDirection="column" gap="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{label}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text>{right}</Text>
          </Box>
        </Box>
        {bar(k + '-bar', frac)}
        <Text color="subtle" wrap="truncate-end">{detail}</Text>
      </Box>
    )
    // Kart: soluk başlık solda, kalın özet sağda
    const card = (k: string, title: string, right: string, rows: RenderChildren) => (
      <Box key={k} flexDirection="column" gap="md" padding="md" borderStyle="round" borderDimColor>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color="subtle" wrap="truncate-end">{title}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text bold>{right}</Text>
          </Box>
        </Box>
        {rows}
      </Box>
    )

    // 5 saatlik pencere: planın kendi sıfırlanma saatinden geriye 5 saat (yoksa son 5 saat)
    const now = await $.clock.now()
    const usage = await $.session.usage().catch(() => null)
    const five = usage?.rateLimits.find(r => r.kind === 'five_hour')
    const resetAt = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
    const winStart = Number.isFinite(resetAt) ? resetAt - 5 * HOUR : now - 5 * HOUR
    const winLog = asLog(await $.store.get(LOG_KEY)).filter(r => r.t >= winStart)
    const winBy = new Map<Family, { tok: number; out: number }>()
    for (const r of winLog) {
      const f = (ORDER as string[]).includes(r.f) ? (r.f as Family) : 'diger'
      const cur = winBy.get(f) ?? { tok: 0, out: 0 }
      winBy.set(f, { tok: cur.tok + r.tok, out: cur.out + r.out })
    }
    const winTotal = [...winBy.values()].reduce((s, v) => s + v.tok, 0)
    const winFams = ORDER.filter(f => (winBy.get(f)?.tok ?? 0) > 0).sort((a, b) => (winBy.get(b)?.tok ?? 0) - (winBy.get(a)?.tok ?? 0))
    const winRight = five ? `%${five.percentUsed}${Number.isFinite(resetAt) ? ' · ' + clock(resetAt) : ''}` : 'son 5 saat'
    const windowCard = card(
      'pencere',
      '5 saatlik pencere',
      winRight,
      <Box flexDirection="column" gap="md">
        {winFams.length === 0 && <Text color="subtle">Bu pencerede henüz kayıt yok.</Text>}
        {winFams.map((f, i) => {
          const v = winBy.get(f)!
          return row('p-' + f, FAMILY[f].name + (i === 0 ? ' · en çok' : ''), `${fmt(v.tok)} token · ${fmt(v.out)} üretilen`, `%${Math.round((v.tok / Math.max(1, winTotal)) * 100)}`, v.tok / Math.max(1, winTotal))
        })}
        <Text color="subtle">{five ? `Plan kullanımı %${five.percentUsed}, sıfırlanma ${Number.isFinite(resetAt) ? clock(resetAt) : '-'}. ` : ''}Model dağılımı bu bilgisayardaki Claude Code oturumlarından.</Text>
      </Box>,
    )

    // Görevler: açılır/kapanır liste. Başlığa basınca liste açılır ya da kapanır;
    // açık/kapalı durumu panel yenilense de korunur.
    const { Button } = ui
    const allTasks = await read($, tasks)
    const v = await read($, view)
    const taskList = allTasks.slice(-8).reverse()
    const lvlFrac: Record<Level, number> = { Kolay: 1 / 3, Orta: 2 / 3, Zor: 1 }
    const toggleCard = () => void update($, view, x => ({ ...x, tasksOpen: !x.tasksOpen }))
    const tasksCard = (
      <Box key="gorevler" flexDirection="column" gap="md" padding="md" borderStyle="round" borderDimColor>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Button key="gorevler-baslik" plain dimColor onPress={toggleCard}>
              {(v.tasksOpen ? '▾ ' : '▸ ') + 'Görevler'}
            </Button>
          </Box>
          <Box flexShrink={0}>
            <Text bold>{String(allTasks.length)}</Text>
          </Box>
        </Box>
        {v.tasksOpen && (
          <Box flexDirection="column" gap="md">
            {taskList.length === 0 && <Text color="subtle">Henüz bir iş verilmedi.</Text>}
            {taskList.map(t => {
              const lvl = levelOf(t)
              const fams = [...new Set(t.models.map(m => FAMILY[familyOf(m)].name))].join(' + ') || '-'
              return row('t-' + t.id, t.text, `${fams} · ${t.steps} istek · ${t.agents} işçi · ${fmt(t.tok)}${t.active ? ' · sürüyor' : ''}`, lvl, lvlFrac[lvl])
            })}
          </Box>
        )}
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap="md" padding="sm">
          {windowCard}
          {tasksCard}
          {card('bos', 'Ekip', '0 token', <Text color="subtle">Bir iş verdiğinizde usta ve işçiler burada görünecek.</Text>)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="md" padding="sm">
        {windowCard}
        {tasksCard}
        {card(
          'modeller',
          'Modeller · bu oturum',
          `${fmt(total)} token`,
          <Box flexDirection="column" gap="md">
            {fams.map(f => {
              const v = byFam.get(f)!
              return row('m-' + f, shortModel(v.model), `${v.steps} istek · ${fmt(v.tok)}`, `%${pct(v.tok)}`, v.tok / Math.max(1, total))
            })}
          </Box>,
        )}
        {card(
          'ekip',
          running > 0 ? `Ekip · ${running} çalışıyor` : 'Ekip · boşta',
          `~${money(totalCost)}`,
          <Box flexDirection="column" gap="md">
            {list.map(w => {
              const st = w.status === 'calisiyor' ? 'çalışıyor' : w.status === 'bitti' ? 'bitti' : 'bekliyor'
              return row(
                'w-' + w.id,
                `${w.id === 'main' ? 'Usta' : 'İşçi'} · ${w.label}`,
                `${shortModel(w.model)} · ${st}`,
                `%${pct(tokens(w))}`,
                tokens(w) / Math.max(1, total),
              )
            })}
            {ROSTER.filter(r => !list.some(w => w.id !== 'main' && familyOf(w.model) === r.fam)).map(r =>
              row('k-' + r.fam, `İşçi · ${r.role}`, `${FAMILY[r.fam].name} · henüz iş verilmedi`, '—', 0),
            )}
          </Box>,
        )}
      </Box>
    )
  })
}
