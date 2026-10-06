export const SIGNAL = Symbol.for("signaloits/signal");

export type Signal<T> = (() => T) & { [SIGNAL]: true };

export type MaybeSignal<T> = T | Signal<T>;

export type Properties<T> = {
  [K in keyof T]: MaybeSignal<T[K]>;
};

export type Effect = {
  run: () => void;
  cleanups: (() => void)[];
};

let currentOwner: Effect | undefined = undefined;
let currentListener: Effect | undefined = undefined;
let queue: Set<Effect> | undefined = undefined;

const enqueue = (effects: Set<Effect>) => {
  if (queue) {
    const pending = queue;
    effects.forEach(_ => pending.add(_));
    return;
  }

  const pending = new Set(effects);
  queue = pending;
  try {
    pending.forEach(effect => {
      pending.delete(effect);
      effect.run();
    });
  } finally {
    queue = undefined;
  }
};

export const signal = <T>(value: T): [Signal<T>, (v: T) => void] => {
  const subscribers = new Set<Effect>();

  const getter = (() => {
    const listener = currentListener;
    if (listener && !subscribers.has(listener)) {
      subscribers.add(listener);
      defer(() => subscribers.delete(listener));
    }
    return value;
  }) as Signal<T>;

  getter[SIGNAL] = true;

  const setter = (newValue: T) => {
    if (value === newValue) return;
    value = newValue;
    enqueue(subscribers);
  };

  return [getter, setter];
};

const cleanup = ({ cleanups }: Effect) => {
  cleanups.forEach(_ => _());
  cleanups.length = 0;
};

export const effect = (f: () => void | (() => void)) => {
  const run = () => {
    cleanup(effect);

    const previousOwner = currentOwner;
    const previousListener = currentListener;
    currentOwner = effect;
    currentListener = effect;

    try {
      const cleanup = f();
      if (cleanup) defer(cleanup);
    } finally {
      currentOwner = previousOwner;
      currentListener = previousListener;
    }
  };

  const effect = {
    run,
    cleanups: [],
  } satisfies Effect;

  defer(() => cleanup(effect));

  run();
};

export const defer = (f: () => void): void => {
  currentOwner?.cleanups.push(f);
};

export const untrack = <T>(f: () => T): T => {
  const previousListener = currentListener;
  currentListener = undefined;
  try {
    return f();
  } finally {
    currentListener = previousListener;
  }
};

export const derived = <T>(f: () => T): Signal<T> => {
  const [value, setValue] = signal<T>(undefined as T);
  effect(() => setValue(f()));
  return value;
};

export const $ = derived;

export const root = <T>(f: (dispose: () => void) => T): T => {
  const root = {
    run: () => {},
    cleanups: [],
  } satisfies Effect;

  const previousOwner = currentOwner;
  const previousListener = currentListener;
  currentOwner = root;
  currentListener = undefined;

  try {
    return f(() => cleanup(root));
  } finally {
    currentOwner = previousOwner;
    currentListener = previousListener;
  }
};

export const resolve = <T>(value: MaybeSignal<T>): T =>
  typeof value === "function" && SIGNAL in value ? value() : value;

export const properties = <T extends object>(
  item: MaybeSignal<Properties<T>>,
): Properties<T> => {
  const property = <K extends keyof T>(key: K): Signal<T[K]> =>
    $(() => resolve(resolve(item)[key] as MaybeSignal<T[K]>));

  const result = {} as Properties<T>;
  for (const key in resolve(item))
    Object.defineProperty(result, key, {
      value: property(key),
      enumerable: true,
    });

  return new Proxy(result, {
    get: (target, key) => {
      if (key in target) return target[key as keyof T];
      return property(key as keyof T);
    },
  });
};

export const map = <T, U>(
  list: MaybeSignal<T[]>,
  mapper: (item: Signal<T>) => U,
  identity: (item: T, i: number) => unknown = _ => _,
): Signal<U[]> => {
  type Entry = {
    value: U;
    setValue: (value: T) => void;
    dispose: () => void;
  };

  const createEntry = (item: T): Entry => {
    const [value, setValue] = signal(item);
    return root(dispose => ({
      value: mapper(value),
      setValue,
      dispose,
    }));
  };

  let cache = new Map<unknown, Entry>();

  defer(() => cache.forEach(_ => _.dispose()));

  return derived(() => {
    const next = new Map<unknown, Entry>();
    const values = resolve(list).map((item, i) => {
      const key = identity(item, i);
      const entry = next.get(key) ?? cache.get(key) ?? createEntry(item);
      entry.setValue(item);
      next.set(key, entry);
      return entry.value;
    });

    cache.forEach((entry, key) => {
      if (!next.has(key)) entry.dispose();
    });

    cache = next;
    return values;
  });
};

export const when = <T, U extends T, V>(
  value: MaybeSignal<T>,
  predicate: (value: T) => value is U,
  mapper: (value: Signal<U>) => V,
): Signal<V | undefined> => {
  const result = map(
    derived(() => {
      const current = resolve(value);
      return predicate(current) ? [current] : [];
    }),
    mapper,
    () => true,
  );

  return derived(() => {
    const [value] = result();
    return value;
  });
};
