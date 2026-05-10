/**
 * Typed domain events bus.
 * Lightweight alternative to mitt using EventTarget (no dependency required).
 * Usage:
 *   domainEvents.on('departure:changed', () => refetch())
 *   domainEvents.emit('departure:changed')
 */

type DomainEventMap = {
  'departure:changed': void         // Any INSERT/UPDATE/DELETE on departures table
  'departure:approved': string      // departure id
  'departure:cancelled': string     // departure id
  'departure:returned': string      // departure id
  'student:status-changed': string  // student id
}

type Handler<T> = T extends void ? () => void : (data: T) => void

class DomainEventBus {
  private target = new EventTarget()

  on<K extends keyof DomainEventMap>(event: K, handler: Handler<DomainEventMap[K]>): () => void {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail
      ;(handler as (data: unknown) => void)(detail)
    }
    this.target.addEventListener(event, listener)
    return () => this.target.removeEventListener(event, listener)
  }

  emit<K extends keyof DomainEventMap>(
    event: K,
    ...args: DomainEventMap[K] extends void ? [] : [DomainEventMap[K]]
  ): void {
    this.target.dispatchEvent(new CustomEvent(event, { detail: args[0] }))
  }
}

export const domainEvents = new DomainEventBus()
