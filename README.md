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

### Примитивные

| CScript | C Type |
|---------|--------|
| number | int32_t |
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
| void | void |
| string | char* |
| any | void* |

### Ссылки

| CScript | C Type |
|---------|--------|
| &T | T* |
| &mut T | T* |
| T \| null | T* |

### Значения

| CScript | C |
|---------|---|
| null | NULL |

## Ownership & Borrowing

### Move Semantics

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

### Borrowing Rules

1. **Много immutable ИЛИ один mutable borrow:**
```typescript
let mut s: string = "hello";
let r1 = &s;     // OK
let r2 = &s;     // OK - много immutable
// let r3 = &mut s; // ERROR - нельзя mutable при immutable
```

2. **Mutable borrow требует mutable переменную:**
```typescript
const s: string = "hello";
// &mut s  // ERROR: cannot borrow as mutable
```

3. **Borrows заканчиваются при выходе из scope:**
```typescript
let mut s: string = "hello";
{
    read(&s);  // borrow начинается
}              // borrow заканчивается
write(&mut s); // OK - предыдущий borrow завершён
```

### Copy Types

Примитивные типы (`i32`, `f64`, `bool`, `number`) копируются, не перемещаются:

```typescript
let x: i32 = 10;
take(x);
take(x);  // OK - i32 is Copy
```

## Native функции

```typescript
@native("printf")
declare function print(format: string, ...args: any): void;

@native("malloc")
declare function alloc(size: usize): void*;
```

## Structs

```typescript
interface Point {
    x: f64,
    y: f64,
}

function main(): i32 {
    let p: Point = { x: 10.5, y: 20.3 };
    print("Point: %f, %f\n", p.x, p.y);
    return 0;
}
```

Генерирует:

```c
typedef struct {
    double x;
    double y;
} Point;
```

## Classes

```typescript
class Player {
    x: i32 = 0,
    y: i32 = 0,
    
    move(dx: i32, dy: i32): void {
        this.x += dx;
        this.y += dy;
    }
}

function main(): i32 {
    let player = new Player();
    player.move(10, 20);
    print("Player: %d, %d\n", player.x, player.y);
    return 0;
}
```

Генерирует:

```c
typedef struct {
    int32_t x;
    int32_t y;
} Player;

Player* Player_new() {
    Player* self = (Player*)malloc(sizeof(Player));
    self->x = 0;
    self->y = 0;
    return self;
}

void Player_move(Player* self, int32_t dx, int32_t dy) {
    self->x += dx;
    self->y += dy;
}
```

## Roadmap

- [x] Базовый парсинг (TS Compiler API)
- [x] Маппинг типов
- [x] Генерация функций
- [x] Borrow checker (move semantics)
- [x] CLI: compile, check
- [x] Тесты (vitest)
- [x] Struct declarations
- [x] Class declarations (struct + methods)
- [x] Generics (мономорфизация)
- [x] Полный borrow checker (lifetimes, mutable/immutable borrows)
- [x] CMake генерация

## License

MIT
