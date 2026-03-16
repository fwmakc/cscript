# CScript — TypeScript to C Compiler

Транспайлер из TypeScript-подобного синтаксиса в чистый C с системой управления памятью как в Rust (ownership, borrow checker, arena allocator).

---

## Архитектура компилятора

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COMPILER PIPELINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Source Code (.cs / .tsc)                                           │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────────────────────────────────────┐                        │
│   │  TypeScript Compiler API (ts.createSourceFile)                   │
│   │  - Парсинг TS-синтаксиса                                          │
│   │  - Готовый AST                                                    │
│   └─────────────────────────────────────────┘                        │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────────────────────────────────────────┐                    │
│   │              Semantic Analysis               │                    │
│   │  ┌──────────────┐  ┌──────────────────────┐ │                    │
│   │  │ Type Checker │──▶│   Borrow Checker     │ │                    │
│   │  └──────────────┘  │  - Ownership         │ │                    │
│   │                    │  - Lifetimes         │ │                    │
│   │                    │  - Borrowing rules   │ │                    │
│   │                    └──────────────────────┘ │                    │
│   └─────────────────────────────────────────────┘                    │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────────────────────────────────────────┐                    │
│   │           C Code Generator                   │                    │
│   │  - Monomorphization (generics)              │                    │
│   │  - Closure conversion                       │                    │
│   │  - Arena allocation insertion               │                    │
│   │  - Auto free() в конце scope                │                    │
│   └─────────────────────────────────────────────┘                    │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────────────────────────────────────────┐                    │
│   │           Build System (Builder)             │                    │
│   │  - Генерация CMakeLists.txt                 │                    │
│   │  - FetchContent для зависимостей            │                    │
│   │  - Копирование assets                       │                    │
│   │  - Кроссплатформенные toolchains            │                    │
│   └─────────────────────────────────────────────┘                    │
│        │                                                             │
│        ▼                                                             │
│   C Source (.h/.c) + CMakeLists.txt                                  │
│        │                                                             │
│        ▼                                                             │
│   gcc/clang → binary                                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Структура проекта

```
cscript/
├── src/
│   ├── index.ts                 # Точка входа CLI
│   │
│   ├── compiler/
│   │   ├── index.ts             # Главный класс компилятора
│   │   ├── type-mapper.ts       # Маппинг типов TS → C
│   │   └── codegen.ts           # Генерация C кода
│   │
│   ├── semantic/
│   │   ├── index.ts             # Главный экспорт
│   │   ├── symbol-table.ts      # Таблица символов
│   │   ├── type-checker.ts      # Проверка типов
│   │   ├── borrow-checker.ts    # Ownership & borrowing
│   │   ├── scope-tracker.ts     # Отслеживание scope для auto-free
│   │   └── lifetime-analyzer.ts # Анализ времени жизни
│   │
│   ├── builder/
│   │   ├── index.ts             # Главный экспорт
│   │   ├── cmake.ts             # Генерация CMakeLists.txt
│   │   ├── dependencies.ts      # Управление зависимостями
│   │   └── assets.ts            # Копирование ресурсов
│   │
│   └── utils/
│       ├── error.ts             # Обработка ошибок
│       └── logger.ts            # Логирование
│
├── runtime/
│   ├── cscript.h                # Runtime заголовок
│   ├── arena.c                  # Arena allocator
│   └── string.c                 # String implementation
│
├── std/                         # Standard library bindings
│   ├── io.ts                    # printf, scanf wrappers
│   ├── mem.ts                   # malloc, free wrappers
│   └── ui/
│       └── raylib.ts            # Raylib bindings
│
├── tests/
│   ├── compiler/
│   ├── semantic/
│   └── integration/
│
├── examples/
│   ├── hello.cs
│   ├── generics.cs
│   └── game/
│       ├── main.cs
│       └── cscript.json
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Модель памяти (Rust-style)

### Состояния переменных

Компилятор отслеживает статус каждой переменной в `VariableTable`:

| Status | Описание |
|--------|----------|
| **Alive** | Переменная владеет данными, может использоваться |
| **Borrowed** | На переменную создана ссылка (&) |
| **Moved** | Владение передано, использование запрещено |

### Правила трансформации

| CScript | C Code | Статус переменной |
|---------|--------|-------------------|
| `let x = new T()` | `T* x = T_new();` | Alive |
| `func(x)` | `func(x);` | x → Moved |
| `func(&x)` | `func(x);` (pointer) | x → Alive |
| `}` (конец scope) | `free(x);` | Только для Alive |

### Ownership Rules

1. **Каждое значение имеет ровно одного владельца**
   ```typescript
   let s1 = String::from("hello");
   let s2 = s1;  // s1 moved to s2, s1 больше не valid
   ```

2. **Владелец освобождает память при выходе из scope**
   ```typescript
   {
       let s = String::from("hello");
   }  // s freed here автоматически
   ```

3. **Copy types копируются, не перемещаются**
   ```typescript
   let x: i32 = 5;
   let y = x;  // i32 is Copy, x все еще valid
   ```

### Borrowing Rules

1. **Много immutable references ИЛИ один mutable reference**
   ```typescript
   let mut s = String::from("hello");
   let r1 = &s;     // OK
   let r2 = &s;     // OK
   // let r3 = &mut s; // ERROR
   ```

2. **Reference не может пережить владельца**
   ```typescript
   let r: &String;
   {
       let s = String::from("hello");
       r = &s;  // ERROR: s doesn't live long enough
   }
   ```

---

## Система типов

### Примитивные типы

| CScript | C Type | Size |
|---------|--------|------|
| i8 | int8_t | 1 |
| i16 | int16_t | 2 |
| i32 | int32_t | 4 |
| i64 | int64_t | 8 |
| u8 | uint8_t | 1 |
| u16 | uint16_t | 2 |
| u32 | uint32_t | 4 |
| u64 | uint64_t | 8 |
| f32 | float | 4 |
| f64 | double | 8 |
| bool | bool | 1 |
| void | void | - |
| string | struct String | - |

### Составные типы

```typescript
// Struct
struct Point {
    x: f64,
    y: f64,
}

// Class (превращается в struct + функции)
class Player {
    x: i32 = 0,
    y: i32 = 0,
    
    move(dx: i32, dy: i32) {
        this.x += dx;
        this.y += dy;
    }
}

// Array (fixed size)
let arr: [i32; 10];

// References
let ref: &i32;         // immutable borrow
let mut_ref: &mut i32; // mutable borrow

// Nullable
let maybe: i32 | null;

// Generics
struct Vec<T> {
    data: *T,
    len: usize,
    cap: usize,
}
```

---

## Примеры трансформации

### Пример 1: Hello World

**Input (CScript):**
```typescript
@native("printf")
declare function print(format: string, ...args: any): void;

function main(): i32 {
    print("Hello, CScript!\n");
    return 0;
}
```

**Output (C):**
```c
#include <stdio.h>
#include <stdint.h>

int32_t main() {
    printf("Hello, CScript!\n");
    return 0;
}
```

### Пример 2: Ownership

**Input (CScript):**
```typescript
function createPlayer(): Player {
    let p = new Player();  // p owns
    return p;              // ownership передан caller
}

function main(): i32 {
    let player = createPlayer();
    player.move(10, 20);
    // auto free(player) в конце scope
    return 0;
}
```

**Output (C):**
```c
Player* createPlayer() {
    Player* p = (Player*)malloc(sizeof(Player));
    return p;
}

int32_t main() {
    Player* player = createPlayer();
    Player_move(player, 10, 20);
    free(player);  // Авто-деструктор
    return 0;
}
```

### Пример 3: Borrowing

**Input (CScript):**
```typescript
function calculateLength(s: &String): i32 {
    return s.length;
}

function main(): i32 {
    let s = String::from("hello");
    let len = calculateLength(&s);  // borrow
    // s все еще valid
    print("Length: %d\n", len);
    return 0;
}
```

**Output (C):**
```c
int32_t calculateLength(const String* s) {
    return s->length;
}

int32_t main() {
    String* s = String_from("hello");
    int32_t len = calculateLength(s);  // pointer, не ownership
    printf("Length: %d\n", len);
    free(s);  // Авто-деструктор
    return 0;
}
```

### Пример 4: Generics (мономорфизация)

**Input (CScript):**
```typescript
struct Pair<T, U> {
    first: T,
    second: U,
}

function swap<T, U>(pair: Pair<T, U>): Pair<U, T> {
    return { first: pair.second, second: pair.first };
}

function main(): i32 {
    let p: Pair<i32, f64> = { first: 10, second: 3.14 };
    let swapped = swap(p);
    return 0;
}
```

**Output (C):**
```c
// Мономорфизация для Pair<i32, f64>
typedef struct {
    int32_t first;
    double second;
} Pair_i32_f64;

typedef struct {
    double first;
    int32_t second;
} Pair_f64_i32;

Pair_f64_i32 swap_i32_f64(Pair_i32_f64 pair) {
    return (Pair_f64_i32){ .first = pair.second, .second = pair.first };
}

int32_t main() {
    Pair_i32_f64 p = { .first = 10, .second = 3.14 };
    Pair_f64_i32 swapped = swap_i32_f64(p);
    return 0;
}
```

---

## Конфигурация проекта (cscript.json)

```json
{
  "name": "my_game",
  "version": "1.0.0",
  "entry": "src/main.cs",
  "target": "bin",
  "outDir": "dist",
  
  "dependencies": {
    "raylib": {
      "git": "https://github.com/raysan5/raylib",
      "tag": "5.0"
    }
  },
  
  "assets": ["assets", "config.ini"],
  
  "platforms": {
    "native": {},
    "dos": {
      "toolchain": "dos-toolchain.cmake",
      "flags": ["-march=i386"]
    },
    "web": {
      "toolchain": "emscripten.cmake"
    }
  }
}
```

---

## CLI Interface

```bash
# Компиляция в C
cscript compile src/main.cs -o dist/main.c

# Полная сборка с CMake
cscript build

# Сборка под конкретную платформу
cscript build --platform dos

# Только проверка типов и borrow checker
cscript check src/main.cs

# Инициализация нового проекта
cscript init my-project

# Watch mode
cscript watch
```

---

## Кроссплатформенная сборка

Компилятор автоматически генерирует CMakeLists.txt:

```cmake
cmake_minimum_required(VERSION 3.14)
project(my_game C)

include(FetchContent)

# Автоматическое подключение зависимостей
FetchContent_Declare(
  raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib
  GIT_TAG 5.0
)
FetchContent_MakeAvailable(raylib)

# Копирование assets в папку сборки
file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/assets 
     DESTINATION ${CMAKE_BINARY_DIR})

add_executable(my_game dist/main.c)
target_link_libraries(my_game PRIVATE raylib)

# Платформо-специфичные библиотеки
if(WIN32)
  target_link_libraries(my_game PRIVATE winmm gdi32)
endif()
```

---

## Error Messages

### Borrow Checker Error

```
error[E0382]: use of moved value: `s`
  --> src/main.cs:5:12
   |
3  |     let s = String::from("hello");
   |         - move occurs because `s` has type `String`
4  |     take_ownership(s);
   |                    - value moved here
5  |     print(s);
   |           ^ value used here after move
   |
   = help: consider borrowing with `&s` instead of moving
```

### Type Error

```
error[E0308]: mismatched types
  --> src/main.cs:7:12
   |
7  |     return "hello";
   |            ^^^^^^^ expected `i32`, found `String`
```

---

## Фазы разработки

### Фаза 1: MVP (2-3 недели)

- [ ] Базовый парсинг через TypeScript Compiler API
- [ ] Маппинг примитивных типов TS → C
- [ ] Генерация простых функций
- [ ] Базовый borrow checker (move semantics)
- [ ] Scope tracker для auto-free
- [ ] CLI: compile, check команды

**Milestone:**
```typescript
function main(): i32 {
    let x: i32 = 10;
    print("%d\n", x);
    return 0;
}
```

### Фаза 2: Типы и Structs (2 недели)

- [ ] Struct declarations
- [ ] Class declarations (struct + methods)
- [ ] Array types (fixed size)
- [ ] Pointer и reference типы
- [ ] Nullable types (T | null)

### Фаза 3: Memory Management (2-3 недели)

- [ ] Полный borrow checker
- [ ] Lifetime analysis
- [ ] Arena allocator в runtime
- [ ] Copy trait для примитивов
- [ ] Drop trait

### Фаза 4: Generics (2 недели)

- [ ] Generic functions
- [ ] Generic structs
- [ ] Мономорфизация
- [ ] Type constraints

### Фаза 5: Build System (1-2 недели)

- [ ] Генерация CMakeLists.txt
- [ ] FetchContent для зависимостей
- [ ] Asset management
- [ ] Кроссплатформенные toolchains

### Фаза 6: Closures (2 недели)

- [ ] Closure syntax
- [ ] Closure conversion
- [ ] Captured variables

### Фаза 7: Advanced Features (2 недели)

- [ ] Pattern matching
- [ ] Enums / Sum types
- [ ] Decorators / Attributes
- [ ] Async/await (optional)

---

## Roadmap Summary

| Фаза | Срок | Результат |
|------|------|-----------|
| 1. MVP | 2-3 недели | Базовый компилятор |
| 2. Типы & Structs | 2 недели | Полные типы |
| 3. Memory Management | 2-3 недели | Ownership, borrow checker |
| 4. Generics | 2 недели | Шаблоны |
| 5. Build System | 1-2 недели | CMake, зависимости |
| 6. Closures | 2 недели | First-class functions |
| 7. Advanced | 2 недели | Pattern matching, enums |
| **Total** | **13-16 недель** | Полноценный язык |

---

## Технологии

### Runtime
- Чистый C11 (без зависимостей)
- stdint.h, stdbool.h, stdlib.h

### Компилятор
- Node.js >= 18 / Bun
- TypeScript >= 5.0
- TypeScript Compiler API

### Build
- CMake >= 3.14
- GCC / Clang

### Development
- Vitest (testing)
- ESLint + Prettier

---

## Next Steps

1. [ ] Инициализировать npm проект
2. [ ] Настроить TypeScript
3. [ ] Реализовать базовый TS_C_Compiler класс
4. [ ] Добавить borrow checker логику
5. [ ] Создать примеры
6. [ ] Написать тесты
