# TypeScriptC — Концепция языка

## Обзор

TypeScriptC — TypeScript-подобный язык, компилируемый в C с системой управления памятью вдохновлённой Rust.

---

## Модель памяти

### Типы данных

| Категория | Типы | Передача |
|-----------|------|----------|
| Примитивы | `i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`, `f64`, `bool`, `string` | По значению (copy) |
| Ссылочные | `Array`, `Object`, `Class` | По ссылке |

### Переменные

| Ключевое слово | Мутабельность |
|----------------|---------------|
| `let` | Мутабельная (можно переназначить) |
| `const` | Иммутабельная (нельзя переназначить) |

```typescript
let x: i32 = 10;
x = 20;  // OK

const y: i32 = 10;
y = 20;  // ERROR
```

---

## Ownership и Borrowing

### Правила

1. **Передача в функцию/метод** — по умолчанию **move** (передача владения)
2. **`readonly`** — ключевое слово для **borrow** (заимствование без владения)
3. **Borrow checker** — правила как в Rust

### Функции

```typescript
// Ownership — забирает владение, должен вернуть если нужно
function take(p: Player): Player {
    return p;
}

// Borrow — только читает, возвращает что-то другое
readonly function getName(p: Player): string {  // неявно &Player
    return p.name;
}
```

### Вызов функций

```typescript
let player = new Player();

// Move — владение передано
player = take(player);

// Borrow — явно с &
let name = getName(&player);
// player всё ещё наш, можно использовать
```

### Методы

```typescript
class Player {
    x: i32 = 0;
    
    // Borrow — только чтение
    readonly getX(): i32 {
        return this.x;
    }
    
    // Ownership — может мутировать, возвращает this
    move(dx: i32): Player {
        this.x += dx;
        return this;
    }
}
```

### Вызов методов

```typescript
let player = new Player();

// Borrow — неявно, можно много раз
let x = player.getX();
let y = player.getX();

// Move — явно, нужен возврат
player = player.move(10);
player = player.move(20);  // chaining OK
```

---

## Borrow Checker Rules

Как в Rust:

1. **Один владельец** — у каждого значения ровно один владелец
2. **Move** — после передачи владения использовать нельзя
3. **Множественные `&`** — можно иметь много immutable borrows одновременно
4. **После move** — переменная недействительна

```typescript
let player = new Player();

let x = player.getX();      // OK - borrow
let y = player.getX();      // OK - ещё borrow

let name = getName(&player); // OK - borrow
player = take(player);       // OK - но после этого player недействителен

let z = player.getX();       // ERROR - player moved
```

---

## Синтаксис

### Функции

```typescript
// Ownership функция
function name(params): ReturnType {
    // ...
}

// Borrow функция (readonly)
readonly function name(params): ReturnType {
    // ...
}
```

### Методы

```typescript
class ClassName {
    // Borrow метод (readonly)
    readonly methodName(): ReturnType {
        // ...
    }
    
    // Ownership метод
    methodName(params): ReturnType {
        // ...
    }
}
```

### Вызовы

```typescript
// Функция — borrow с явным &
functionCall(&variable);

// Метод — borrow неявный
object.readonlyMethod();

// Move — переменная переносится
variable = functionCall(variable);
variable = object.ownershipMethod();
```

---

## Примеры

### Полный пример

```typescript
@native("printf")
declare function print(format: string, ...args: any): void;

class Point {
    x: f64 = 0;
    y: f64 = 0;
    
    readonly getX(): f64 {
        return this.x;
    }
    
    readonly getY(): f64 {
        return this.y;
    }
    
    translate(dx: f64, dy: f64): Point {
        this.x += dx;
        this.y += dy;
        return this;
    }
}

readonly function distance(p: Point): f64 {
    // sqrt(p.x * p.x + p.y * p.y) - упрощённо
    return p.x + p.y;
}

function main(): i32 {
    let point = new Point();
    
    // Borrow методы — можно много раз
    print("x: %f\n", point.getX());
    print("y: %f\n", point.getY());
    
    // Borrow функция — явно &
    let d = distance(&point);
    print("distance: %f\n", d);
    
    // Move методы — chaining
    point = point.translate(10, 20);
    point = point.translate(5, 5);
    
    print("final x: %f\n", point.getX());
    
    return 0;
}
```

---

## Отличия от предыдущей версии

| Было | Стало |
|------|-------|
| `mut` для mutable переменных | `let` всегда mutable |
| `&T` и `&mut T` в параметрах | `readonly` + неявный `&` |
| `&mut` для mutable borrow | Нет, только `readonly` |
| Неявные borrows | Явные `&` в вызовах функций, неявные в методах |

---

## Roadmap изменений

- [ ] Добавить `readonly` в парсер (функции и методы)
- [ ] Убрать `mut` из синтаксиса
- [ ] Адаптировать borrow checker под новые правила
- [ ] Неявный `&` для параметров в `readonly` функциях
- [ ] Обновить code generator (методы возвращают `this`)
- [ ] Обновить тесты
- [ ] Обновить примеры
