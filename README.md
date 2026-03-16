# CScript

TypeScript to C Compiler с системой управления памятью как в Rust (ownership, borrow checker).

## Установка

```bash
npm install
npm run build
```

## Использование

```bash
# Компиляция в C
node dist/index.js compile examples/hello.cs -o dist/hello.c

# Проверка типов и borrow checker
node dist/index.js check examples/hello.cs

# Вывод в stdout
node dist/index.js compile examples/hello.cs
```

## Пример

**Input (hello.cs):**
```typescript
@native("printf")
declare function print(format: string, ...args: any): void;

function main(): i32 {
    let x: i32 = 10;
    print("%d\n", x);
    return 0;
}
```

**Output:**
```c
extern void printf(char*, ...);

#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdbool.h>

int32_t main(void) {
  int32_t x = 10;
  printf("%d\n", x);
  return 0;
}
```

## Типы

| CScript | C Type |
|---------|--------|
| i8 | int8_t |
| i16 | int16_t |
| i32 | int32_t |
| i64 | int64_t |
| u8 | uint8_t |
| u16 | uint16_t |
| u32 | uint32_t |
| u64 | uint64_t |
| f32 | float |
| f64 | double |
| bool | bool |
| string | char* |

## Ownership & Borrowing

Переменные некопируемых типов (string, structs) перемещаются при передаче в функцию:

```typescript
function takeOwnership(s: string): void { }

function main(): i32 {
    let s: string = "hello";
    takeOwnership(s);
    print("%s\n", s);  // ERROR: use of moved value
    return 0;
}
```

Используйте `&` для заимствования:

```typescript
function borrowString(s: string): void { }

function main(): i32 {
    let s: string = "hello";
    borrowString(&s);  // borrow
    print("%s\n", &s); // OK
    return 0;
}
```

## Native функции

```typescript
@native("printf")
declare function print(format: string, ...args: any): void;

@native("malloc")
declare function alloc(size: usize): void*;
```

## Roadmap

- [x] Базовый парсинг (TS Compiler API)
- [x] Маппинг типов
- [x] Генерация функций
- [x] Borrow checker (move semantics)
- [x] CLI: compile, check
- [ ] Struct declarations
- [ ] Полный borrow checker (lifetimes)
- [ ] Generics (мономорфизация)
- [ ] CMake генерация

## License

MIT
