# signlets

Tiny fine-grained reactive signals for TypeScript.

## Install

```bash
npm i signlets
```

## Usage

```ts
import { signal, effect } from "signlets";

const [count, setCount] = signal(0);
effect(() => console.log(count()));
setCount(1);
```

## API

`signal`, `effect`, `onCleanup`, `untrack`, `derived`, `$`, `root`, `resolve`, `map`
