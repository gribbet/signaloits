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
  const run = () => {
    cleanup(effect);

    const previousOwner = currentOwner;
    const previousListener = currentListener;
    currentOwner = effect;
    currentListener = effect;

    try {
      const cleanup = f();
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

export type MapOptions<T, K> = {
  key: (item: T, i: number) => K;
};

type MapFn = {
  <T, U>(
    list: T[] | Signal<T[]>,
    mapper: (item: T, i: Signal<number>) => U,
  ): Signal<U[]>;
  <T, K, U>(
    list: T[] | Signal<T[]>,
    mapper: (item: Signal<T>, i: Signal<number>) => U,
    options: MapOptions<T, K>,
  ): Signal<U[]>;
};

export const map: MapFn = <T, K, U>(
  list: T[] | Signal<T[]>,
  mapper:
    | ((item: T, i: Signal<number>) => U)
    | ((item: Signal<T>, i: Signal<number>) => U),
  options?: MapOptions<T, K>,
): Signal<U[]> => {
  if (options) {
    type Entry = {
      value: U;
      setItem: (item: T) => void;
      setIndex: (i: number) => void;
      dispose: () => void;
    };

    let cache = new Map<K, Entry>();

    onCleanup(() => cache.forEach(_ => _.dispose()));

    return derived(() => {
      const nextList = resolve(list);
      const next: [K, Entry][] = [];
      const seen = new Set<K>();

      nextList.forEach((item, i) => {
        const key = options.key(item, i);
        if (seen.has(key))
          throw new Error(`Duplicate key in map: ${String(key)}`);
        seen.add(key);

        let entry = cache.get(key);
        if (entry) {
          entry.setItem(item);
          entry.setIndex(i);
          cache.delete(key);
        } else {
          const [itemValue, setItem] = signal(item);
          const [index, setIndex] = signal(i);
          entry = root(dispose => {
            const value = (mapper as (item: Signal<T>, i: Signal<number>) => U)(
              itemValue,
              index,
            );
            return {
              value,
              setItem,
              setIndex,
              dispose,
            };
          });
        }

        next.push([key, entry]);
      });

      cache.forEach(_ => _.dispose());
      cache = new Map(next);

      return next.map(([, entry]) => entry.value);
    });
  }

  type Entry = { value: U; setIndex: (i: number) => void; dispose: () => void };
  let cache = new Map<T, Entry>();

  onCleanup(() => cache.forEach(_ => _.dispose()));

  return derived(() => {
    const nextList = resolve(list);
    const next: [T, Entry][] = nextList.map((item, i) => {
      let entry = cache.get(item);
      if (entry) {
        entry.setIndex(i);
        cache.delete(item);
      } else {
        const [index, setIndex] = signal(i);
        entry = root(dispose => {
          const value = (mapper as (item: T, i: Signal<number>) => U)(
            item,
            index,
          );
          return {
            value,
            setIndex,
            dispose,
          };
        });
      }
      return [item, entry] as const;
    });
    cache.forEach(_ => _.dispose());
    cache = new Map(next);
    return next.map(([, entry]) => entry.value);
  });
};
