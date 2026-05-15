type Listener<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<Listener<unknown>>>();

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => {
      set!.delete(fn as Listener<unknown>);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<E[K]>)(payload);
  }

  clear() {
    this.listeners.clear();
  }
}
