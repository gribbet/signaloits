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

`signal`, `effect`, `defer`, `untrack`, `derived`, `$`, `root`, `resolve`, `properties`, `map`, `when`
