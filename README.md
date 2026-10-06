# signaloits

Tiny fine-grained reactive signals for TypeScript.

## Install

```bash
npm i signaloits
```

## Usage

```ts
import { signal, effect } from "signaloits";

const [count, setCount] = signal(0);
effect(() => console.log(count()));
setCount(1);
```

## API

- `signal(value)` creates a getter and setter.
- `derived(fn)` or `$(fn)` creates a computed signal.
- `effect(fn)` reruns when its dependencies change.
- `batch(fn)` applies multiple updates atomically.
- `defer(fn)` registers cleanup with the current effect or root.
- `root(fn)` creates an ownership scope; `untrack(fn)` reads without tracking.
- `resolve(value)` reads a signal or returns a plain value.
- `properties(object)` turns each property into a signal.
- `map(list, mapper, identity?)` preserves one owned result per identity.
- `when(value, predicate, mapper)` preserves an owned result while it matches.
