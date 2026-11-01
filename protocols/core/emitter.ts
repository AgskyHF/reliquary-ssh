/**
 * Tiny event emitter used by protocol adapters.
 * Kept dependency-free so adapters stay portable across main and worker contexts.
 */
export type Listener<T> = (payload: T) => void

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (payload: never) => void)
    return () => {
      set?.delete(listener as (payload: never) => void)
    }
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off()
      listener(payload)
    })
    return off
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as (payload: never) => void)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      ;(listener as Listener<Events[K]>)(payload)
    }
  }

  removeAll(): void {
    this.listeners.clear()
  }
}
