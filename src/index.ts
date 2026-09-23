export const SIGNAL = Symbol.for("signlets/signal");

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

export const signal = <T>(value: T): [Signal<T>, (v: T) => void] => {
  const subscribers = new Set<Effect>();

  const getter = (() => {
    const listener = currentListener;
    if (listener && !subscribers.has(listener)) {
      subscribers.add(listener);
      onCleanup(() => subscribers.delete(listener));
    }
    return value;
  }) as Signal<T>;

  getter[SIGNAL] = true;

  const setter = (newValue: T) => {
    if (value === newValue) return;
    value = newValue;
    [...subscribers].forEach(_ => _.run());
  };

  return [getter, setter];
};

const cleanup = ({ cleanups }: Effect) => {
  cleanups.forEach(_ => _());
  cleanups.length = 0;
};

export const effect = (f: () => void | (() => void)) => {
  const run = async () => {
    cleanup(effect);

    const previousOwner = currentOwner;
    const previousListener = currentListener;
    currentOwner = effect;
    currentListener = effect;

    try {
      const cleanup = await f();
      if (cleanup) onCleanup(cleanup);
    } finally {
      currentOwner = previousOwner;
      currentListener = previousListener;
    }
  };

  const effect = {
    run,
    cleanups: [],
  } satisfies Effect;

  onCleanup(() => cleanup(effect));

  run();
};

export const onCleanup = (f: () => void) => currentOwner?.cleanups.push(f);

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
  mapper: (item: Signal<T>, i: Signal<number>) => U,
  options?: {
    key: (item: T, i: number) => unknown;
  },
): Signal<U[]> => {
  type Entry = {
    value: U;
    setItem: (item: T) => void;
    setIndex: (i: number) => void;
    dispose: () => void;
  };

  const createEntry = (item: T, i: number): Entry => {
    const [itemValue, setItem] = signal(item);
    const [index, setIndex] = signal(i);
    return root(dispose => {
      const value = mapper(itemValue, index);
      return {
        value,
        setItem,
        setIndex,
        dispose,
      };
    });
  };

  const updateEntry = (entry: Entry, item: T, i: number) => {
    entry.setItem(item);
    entry.setIndex(i);
  };

  const key: (item: T, i: number) => unknown = options?.key ?? (item => item);
  let cache = new Map<unknown, Entry>();

  onCleanup(() => cache.forEach(_ => _.dispose()));

  return derived(() => {
    const nextList = resolve(list);
    const next: [unknown, Entry][] = [];
    const seen = new Set<unknown>();

    nextList.forEach((item, i) => {
      const itemKey = key(item, i);
      if (seen.has(itemKey))
        throw new Error(`Duplicate key in map: ${String(itemKey)}`);
      seen.add(itemKey);

      let entry = cache.get(itemKey);
      if (entry) {
        updateEntry(entry, item, i);
        cache.delete(itemKey);
      } else {
        entry = createEntry(item, i);
      }

      next.push([itemKey, entry]);
    });

    cache.forEach(_ => _.dispose());
    cache = new Map(next);
    return next.map(([, entry]) => entry.value);
  });
};
