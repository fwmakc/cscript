# TypeScript C (tsc) — Language Design Plan

## Overview

A TypeScript-inspired language that compiles to C and auto-generates build files (CMakeLists.txt).

- File extension: `.tsc`
- Output: `.c` / `.h` files + `CMakeLists.txt`

---

## Core Goals

- [ ] TypeScript-like syntax and type system
- [ ] Compiles to readable, idiomatic C
- [ ] Auto-generates CMakeLists.txt
- [ ] Dependency/library management

---

## Design Decisions

### Syntax

#### Переменные

- `let` — мутабельная переменная: можно переприсвоить, можно вызывать `mut` методы, можно передавать как `&mut`
- `const` — иммутабельная: нельзя переприсвоить, нельзя вызывать `mut` методы, нельзя передавать как `&mut`

#### Функции

- Ключевое слово: `function`
  ```typescript
  function add(a: i32, b: i32): i32 {
    return a + b;
  }
  ```
- **Стрелочные функции** — сокращённый синтаксис, тип выводится:
  ```typescript
  const add = (a: i32, b: i32): i32 => a + b; // expression body
  const add = (a: i32, b: i32): i32 => {
    return a + b;
  }; // block body
  ```
- **Анонимные функции** — `function` без имени, присваивается переменной или передаётся аргументом:

  ```typescript
  const add = function (a: i32, b: i32): i32 {
    return a + b;
  };

  array.sort(function (a: i32, b: i32): i32 {
    return a - b;
  });
  ```

- **IIFE** — немедленный вызов функции:
  ```typescript
  ((a: i32, b: i32) => a + b)(
    1,
    2
  )(
    // => 3
    (a: i32, b: i32) => {
      return a + b;
    }
  )(
    1,
    2
  )(function (a: i32, b: i32): i32 {
    return a + b;
  })(1, 2);
  ```
- **Замыкания** — стрелочные функции захватывают переменные из внешнего скопа:
  ```typescript
  let multiplier = 3;
  const triple = (x: i32) => x * multiplier; // захватывает multiplier
  ```
  - Захват **по значению** для примитивов (копируется в момент создания замыкания)
  - Захват **по ссылке** для сложных типов (следует правилам borrow checker)
  - В C компилируется в struct с захваченными переменными + функцию принимающую этот struct

#### Семантика передачи значений

- **Примитивы** (`int`, `float`, `bool`, `char`, строки) — всегда **по значению** (copy)
- **Сложные типы** (объекты, массивы, коллекции, структуры, классы) — всегда **по ссылке** (автоматически)
- Явные `&` аннотации не нужны для базовых случаев — компилятор решает сам

### Type System

#### Типизация

- **Номинальная** — тип определяется именем, не формой
  - `type Point = { x: f64, y: f64 }` и `type Vector = { x: f64, y: f64 }` — разные типы
- **Type inference** — тип выводится если не указан явно
  - `const p = { x: 1, y: 0 }` → `{ x: number, y: number }` → анонимная struct в C
- **Автокаст числовых типов:**
  - Widening (i32→i64, i32→f64) — неявно, молча
  - Narrowing (f64→i32) — ошибка компилятора, нужен явный `as`: `3.14 as i32`
- **Объектные литералы** без типа → анонимная struct, генерируется компилятором

#### Числовые типы

- Полный набор: `i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`, `f64`
- Синоним: `number` = `f64` (совместимость с TypeScript-стилем)
- Все числа — примитивы, передаются по значению

#### Строки

- Один тип `string` — heap, всегда передаётся по ссылке (сложный тип)
- Мутабельность через `let`/`const`
- Кодировка: **UTF-8** внутри
- Индексация: **по графемным кластерам** (user-perceived characters)
  - `"0❤️abcАБВ"[1]` → `❤️` (два codepoint-а, один кластер)
  - `s[i]` — O(n), строится обход графем
- Для сегментации графем используем библиотеку (ICU или utf8proc)
- Срезы: `s[1..3]` → подстрока по графемным индексам

### Memory Model

- **Ownership + Borrow Checker** (Rust-inspired), подробнее в `borrow_checker.md`
- Примитивы всегда копируются, бч не применяется
- Сложные типы управляются бч
- Владение передаётся при присвоении и при передаче в функцию (`arr: i32[]`)
- Заимствование через тип параметра: `&T` (immutable), `&mut T` (mutable)
- `&` только в сигнатуре — при вызове синтаксис чистый
- Компилятор автоматически вставляет `free()` в сгенерированный C-код
- Нет GC, нет ручного `free`

### Module System

- Синтаксис как в TypeScript: именованные `export` / `import { } from ""`
- Один файл = один модуль
- **Циклические импорты разрешены** — компилятор автоматически генерирует forward declarations в C

#### Порядок инициализации модулей

Каждый модуль с module-level переменными получает `_init()` функцию в C. Порядок вызовов определяется **топологической сортировкой** графа импортов — зависимости инициализируются раньше.

Для правильного порядка компилятор строит граф зависимостей и делает топологическую сортировку. Результат — одна функция `tsc_init_all()` с правильным порядком:

```c
// сгенерировано компилятором
static void tsc_init_all() {
    a_type_init();  // нет зависимостей — первый
    bar_init();     // зависит от a_type
    foo_init();     // зависит от a_type и bar
}

int main() {
    tsc_init_all();
    // ... код пользователя
}
```

Два случая циклических зависимостей:

- **Цикл через типы и функции** — разрешён, компилятор генерирует forward declarations в .h файлах
- **Цикл через module-level переменные** — физически неразрешимо, ошибка компилятора:
  ```
  error: circular initialization dependency detected
    src/a.tsc:2  aValue depends on bValue
    src/b.tsc:2  bValue depends on aValue
  hint: move one of these values into a function
  ```
  Пример в коде:
  ```typescript
  a.tsc: const aVal = bFunc()   // нужен b
  b.tsc: const bVal = aFunc()   // нужен a
  // кто инициализируется первым?
  ```

#### Точка входа

Файл с top-level statements (исполняемый код вне функций) — и есть entry point. Top-level statements синтаксически разрешены в любом файле.

Entry point определяется в порядке приоритета:

1. **Конфиг** — поле `"entry"` в `tsc.packages.json`:
   ```json
   { "entry": "src/foo.tsc" }
   ```
2. **Конвенция** — файл `main.tsc` в корне проекта (там же где `tsc.packages.json`)

Если ни конфиг ни конвенция не указывают entry point — проект считается библиотекой, `main()` не генерируется.

Ошибки:

- `"entry"` указан, но в файле нет top-level statements:
  ```
  error: entry file has no top-level statements
    --> src/foo.tsc
  hint: add executable code or remove "entry" from tsc.packages.json
  ```

- Типы импортов по источнику:
  - `"./path"` — локальный файл
  - `"libc"`, `"libm"` и др. — встроенные декларации + генерирует `#include <...>` в C
    ```typescript
    import { printf } from "libc";
    // компилятор знает сигнатуру printf — есть встроенный libc.d.tsc
    // генерирует в C: #include <stdio.h>
    ```
  - остальное — внешние пакеты из реестра
- **Файлы деклараций `.d.tsc`** — типизация внешнего кода:
  - Для C-библиотек без встроенных деклараций
  - Для `.tsc` модулей без исходников (бинарные пакеты)
  - Сообщество публикует `.d.tsc` для популярных C-либ в реестре
- **Если деклараций нет** — тип `any`, компилятор не ругается

### Build System & Package Manager

#### Источники зависимостей (все варианты вместе)

```json
{
  "dependencies": {
    "mylib": "^1.0.0",
    "sdl2": ">=2.28.0",
    "json": {
      "git": "github.com/nlohmann/json@3.11.0"
    },
    "libfoo": {
      "git": "github.com/someuser/libfoo@1.0.0",
      "build": "make PREFIX={install_dir}",
      "headers": "include/",
      "lib": "libfoo.a"
    },
    "libbaz": {
      "url": "https://some.site.com/download/lib_1.0.0.zip",
      "version": "1.0.0",
      "build": "make PREFIX={install_dir}",
      "headers": "include/",
      "lib": "libbaz.a"
    }
  }
}
```

#### Версионирование

- **Semver строка** — полный semver: `^1.0.0`, `~1.2.0`, `>=1.0.0`, `1.0.0`
- **Git** — только точный тег (`@2.28.0`), коммит (`@a1b2c3d`), или ветка (`@main`); semver операторы не поддерживаются
- **URL** — версия задаётся обязательным полем `version:` (используется для кэша и lock-файла)

#### Резолюция semver-зависимостей

Для зависимостей заданных строкой компилятор ищет в следующем порядке:

1. **Система** — `pkg-config` проверяет наличие и версию
   - Найдена и версия удовлетворяет constraint → используем, ничего не скачиваем
   - Не найдена или версия не подходит → переходим к шагу 2
2. **Реестр** (`tsc-lang.org`) — скачивает и собирает нужную версию
   - _(реестр не реализован)_ → ошибка компилятора с подсказкой:
     ```
     error: sdl2 >=2.28.0 not found
     hint: install it manually, e.g.:
       apt install libsdl2-dev
       brew install sdl2
     ```

#### URL-зависимости (zip-архив)

- Поле `url:` — прямая ссылка на `.zip` архив
- Поле `version:` — **обязательно**, используется для именования кэша и lock-файла
- Поддерживаемые форматы архивов: `.zip`, `.tar.gz`, `.tar.bz2`, `.tar.xz`
- Flow:

  ```bash
  # 1. Скачивает архив
  curl -L https://some.site.com/download/lib_1.0.0.zip \
       -o ~/.tsc/cache/libbaz@1.0.0.zip

  # 2. Распаковывает
  unzip ~/.tsc/cache/libbaz@1.0.0.zip -d ~/.tsc/cache/libbaz@1.0.0/
  ```

- Дальше — тот же порядок инструкций что и для git:
  1. **CMake** — есть `CMakeLists.txt` → auto-flow
  2. **`tsc.build.json`** — есть в архиве → используем
  3. **inline в `tsc.packages.json`** — описываем сами
  4. Ничего → ошибка компилятора
- В lock-файле фиксируется URL + `sha256` архива для воспроизводимости

#### Git-зависимости

- Версия по тегу (`@2.28.0`), ветке (`@main`) или коммиту (`@a1b2c3d4`)
- Lock-файл `tsc.packages.lock` — фиксирует точные коммиты для воспроизводимости
- Сборка скачанной либы — приоритет поиска инструкций:
  1. **CMake** — есть `CMakeLists.txt` в репо → поддерживается автоматически
  2. **`tsc.build.json`** — есть в репо библиотеки → используем его
  3. **inline в `tsc.packages.json`** — описываем сборку прямо в своём проекте
  4. Ничего из вышеперечисленного → ошибка компилятора
- `tsc.build.json` в корне репо библиотеки (удобство для авторов либ, чтобы пользователи не описывали сборку вручную):
  ```json
  {
    "build": "make PREFIX={install_dir}",
    "headers": "include/",
    "lib": "libfoo.a"
  }
  ```

##### CMake auto-flow

Когда в репо есть `CMakeLists.txt`, компилятор запускает стандартный cmake pipeline:

```bash
# 1. Клонирует репо в кэш
git clone github.com/someuser/libfoo@1.0.0 ~/.tsc/cache/libfoo@1.0.0

# 2. Конфигурирует — cmake_options из tsc.packages.json пробрасываются как -D флаги
cmake -S ~/.tsc/cache/libfoo@1.0.0 \
      -B ~/.tsc/cache/libfoo@1.0.0/_build \
      -DCMAKE_INSTALL_PREFIX=~/.tsc/cache/libfoo@1.0.0/_install \
      -DBUILD_SHARED_LIBS=OFF \
      -DCMAKE_BUILD_TYPE=Release \
      -DFOO_BUILD_TESTS=OFF \      # ← из cmake_options
      -DFOO_USE_SSL=ON             # ← из cmake_options

# 3. Собирает
cmake --build ~/.tsc/cache/libfoo@1.0.0/_build --parallel

# 4. Устанавливает в _install/
cmake --install ~/.tsc/cache/libfoo@1.0.0/_build
```

После install — стандартная структура:

```
_install/
  include/        ← headers
  lib/            ← libfoo.a
  lib/cmake/      ← FooConfig.cmake (если есть)
```

Линковка в генерируемый `CMakeLists.txt` проекта — два варианта:

```cmake
# Вариант A: есть FooConfig.cmake / foo-config.cmake → используем find_package
find_package(Foo REQUIRED
    PATHS ~/.tsc/cache/libfoo@1.0.0/_install
    NO_DEFAULT_PATH)
target_link_libraries(myapp PRIVATE Foo::Foo)

# Вариант B: config-файла нет → прописываем пути напрямую
target_include_directories(myapp PRIVATE ~/.tsc/cache/libfoo@1.0.0/_install/include)
target_link_libraries(myapp PRIVATE ~/.tsc/cache/libfoo@1.0.0/_install/lib/libfoo.a)
```

##### cmake_options в tsc.packages.json

Опциональное поле для передачи `-D` флагов при конфигурации:

```json
{
  "dependencies": {
    "libfoo": {
      "git": "github.com/someuser/libfoo@1.0.0",
      "cmake_options": {
        "FOO_BUILD_TESTS": false,
        "FOO_USE_SSL": true,
        "FOO_MAX_CONNECTIONS": 128
      }
    }
  }
}
```

- `bool` → `ON` / `OFF`
- `number` / `string` → передаётся как есть
- Компилятор всегда добавляет `BUILD_SHARED_LIBS=OFF`, `CMAKE_BUILD_TYPE=Release`, `CMAKE_INSTALL_PREFIX` — пользователь не переопределяет эти три

##### Flow сборки для tsc.build.json / inline

```bash
# Запускает сборку, подставляет {install_dir}
make PREFIX=~/.tsc/cache/libfoo@1.0.0/out
# Забирает результат по путям из инструкций
#    headers: include/  →  ~/.tsc/cache/libfoo@1.0.0/include/
#    lib:     libfoo.a  →  ~/.tsc/cache/libfoo@1.0.0/libfoo.a
# Прописывает пути в генерируемый CMakeLists.txt проекта
target_include_directories(myapp PRIVATE ~/.tsc/cache/libfoo@1.0.0/include)
target_link_libraries(myapp ~/.tsc/cache/libfoo@1.0.0/libfoo.a)
```

#### Реестр

- Централизованный реестр `tsc-lang.org`
- Публикация `.tsc` пакетов и `.d.tsc` деклараций для C-либ

### Error Handling

- Синтаксис как в TypeScript: `throw`, `try`/`catch`
- Под капотом компилируется в `Result` тип в C (не `setjmp`/`longjmp`)
- Оператор `?` — пробрасывает ошибку наверх без boilerplate
  ```
  function readConfig(path: string): Config {
      let file = openFile(path)?
      let text = file.readAll()?
      return parseConfig(text)?
  }
  ```
- `try`/`catch` разворачивается в if/else по Result в генерируемом C

### Standard Library

> TBD

---

## Open Questions

- Generics support?
- Массивы и коллекции — синтаксис и семантика?
- `const` для классов — как работает мутабельность?
- Стандартная библиотека — что входит?
- Async/await — нужен?
