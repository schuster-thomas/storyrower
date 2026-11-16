/** Minimaler typisierter Event-Emitter. */
export class Emitter<E extends { [K in keyof E]: (...args: never[]) => void }> {
  private handlers = new Map<keyof E, Set<E[keyof E]>>();

  on<K extends keyof E>(event: K, fn: E[K]): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    for (const fn of this.handlers.get(event) ?? []) (fn as (...a: Parameters<E[K]>) => void)(...args);
  }
}
