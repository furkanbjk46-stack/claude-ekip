/** Bir çalışan: ana oturum (usta) ya da bir alt ajan (işçi). */
export type Worker = {
  /** 'main' ya da alt ajanın id'si */
  id: string
  /** Ekranda görünen ad: "Ana oturum" ya da alt ajanın görev açıklaması */
  label: string
  /** Ajan türü (general-purpose, Explore, ...); ana oturum için 'usta' */
  kind: string
  /** Son isteği yanıtlayan model id'si */
  model: string
  status: 'calisiyor' | 'bitti' | 'bekliyor'
  inTok: number
  outTok: number
  cacheRead: number
  cacheWrite: number
  steps: number
  startedAt: number
  endedAt?: number
}

/** Kullanıcının verdiği bir iş: bir ana oturum turu ve içinde çağrılan işçiler. */
export type Task = {
  id: string
  /** Kullanıcının mesajının başı */
  text: string
  startedAt: number
  endedAt?: number
  steps: number
  tok: number
  outTok: number
  /** Bu iş için çağrılan alt ajan sayısı */
  agents: number
  /** İşte yanıt veren modellerin id'leri, tekrarsız */
  models: string[]
  active: boolean
}

/** Panelin açık/kapalı durumu: Görevler kartı ve açılan görevler. */
export type View = {
  tasksOpen: boolean
  /** Ayrıntısı açılmış görevlerin id'leri */
  open: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'ekip-paneli': { workers: Shaped<Worker[]>; tasks: Shaped<Task[]>; view: Shaped<View> }
  }
}
