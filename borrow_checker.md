# Borrow Checker (бч)

> Пользователь называет его **бч**.

---

## Базовые правила передачи значений

- **Примитивы** (`i8`..`i64`, `u8`..`u64`, `f32`, `f64`, `bool`, `char`) — всегда **копируются**, бч не применяется
- **Сложные типы** (массивы, объекты, строки, классы) — управляются бч

---

## Семантика параметров функции

Тип параметра определяет что происходит с владением:

| Сигнатура         | Семантика                               |
| ----------------- | --------------------------------------- |
| `arr: i32[]`      | **move** — владение переходит в функцию |
| `arr: &i32[]`     | **immutable borrow** — только чтение    |
| `arr: &mut i32[]` | **mutable borrow** — чтение и запись    |

`&` указывается только в сигнатуре. При вызове всегда чистый синтаксис:

```typescript
addToCache(myCache, myData); // компилятор сам знает из сигнатуры
sum(myData);
push(myData, 4);
```

---

## Move — передача владения

### При присвоении

```typescript
const a = [1, 2, 3];
const b = a; // владение переходит к b
console.log(a); // ошибка: a перемещена
```

### При передаче в функцию

```typescript
function addToCache(cache: &mut Cache, data: i32[]) {
    cache.items.push(data)   // ok — data принадлежит функции
}

addToCache(myCache, myData)
console.log(myData)   // ошибка: myData перемещена
```

---

## Immutable borrow `&` — читаем без передачи владения

```typescript
function sum(arr: &i32[]): i32 { ... }

const data = [1, 2, 3]
sum(data)
console.log(data)   // ok — data не перемещена
```

---

## Mutable borrow `&mut` — изменяем без передачи владения

```typescript
function push(arr: &mut i32[], val: i32) { arr.push(val) }

let data = [1, 2, 3]
push(data, 4)
console.log(data)   // [1, 2, 3, 4] — data жива и изменена
```

---

## Правила бч

### Нельзя два mutable borrow одновременно

```typescript
let a = [1, 2, 3]
const r1: &mut i32[] = a
const r2: &mut i32[] = a   // ошибка: уже есть активный &mut borrow
```

### Нельзя mutable + immutable одновременно

```typescript
let a = [1, 2, 3]
const r1: &i32[] = a
const r2: &mut i32[] = a   // ошибка: a уже заимствована как immutable
```

### Можно несколько immutable borrow одновременно

```typescript
let a = [1, 2, 3];
const r1: i32[] = a;
const r2: i32[] = a; // ok
```

---

## Классы

### Методы — `mut` определяет семантику `this`

- Метод без `mut` — `this` immutable borrow, нельзя изменять поля
- Метод с `mut` — `this` mutable borrow, можно изменять поля

```typescript
class Counter {
    value: i32 = 0

    get(): i32 {        // this — immutable borrow
        return this.value
    }

    mut increment() {   // this — mutable borrow
        this.value++
    }
}

const c = new Counter()
c.get()        // ok
c.increment()  // ошибка: нельзя вызвать mut метод на const

let c2 = new Counter()
c2.get()       // ok
c2.increment() // ok
```

### Конструктор — поля забирают владение

```typescript
class Line {
  start: Point;
  end: Point;

  constructor(start: Point, end: Point) {
    this.start = start; // move — Line забирает владение
    this.end = end; // move
  }
}

const p1 = new Point(0, 0);
const p2 = new Point(1, 1);
const line = new Line(p1, p2);
console.log(p1); // ошибка: p1 перемещён в line
```

### Композиция — mutable `this` даёт mutable доступ к полям

```typescript
class Car {
    engine: Engine

    mut start() {
        this.engine.start()   // ok — this мутабельный, значит engine тоже
    }

    getHp(): i32 {
        return this.engine.horsepower   // ok — чтение без mut
    }

    mut swapEngine(newEngine: Engine) {
        this.engine = newEngine   // move — старый engine освобождается, новый занимает место
    }
}
```

---

## `const` vs `let` и мутабельность

- `const obj` — immutable: нельзя вызывать `mut` методы, нельзя передать как `&mut`
- `let obj` — mutable: можно всё

```typescript
function foo(c: &mut Counter) { c.increment() }

const c = new Counter()
foo(c)   // ошибка: c — const, нельзя передать как &mut

let c2 = new Counter()
foo(c2)  // ok
```

`const` = "этот объект не меняется". Компилятор держит его как immutable borrow.

---

## For-of цикл

`const`/`let` перед `item` определяет семантику borrow — те же правила что и везде:

```typescript
const arr = [obj1, obj2, obj3]
for const item of arr {
    item.doSomething()   // ok — immutable метод
    item.mutMethod()     // ошибка — item это const (immutable borrow)
    arr.push(obj4)       // ошибка — arr заимствован на время цикла
}
```

```typescript
let arr = [obj1, obj2, obj3]
for let item of arr {
    item.mutMethod()     // ok — mutable borrow, изменения попадают в arr
    arr.push(obj4)       // ошибка — arr заимствован на время цикла
}
```

- `for const item` — immutable borrow на элемент, `arr` может быть `const` или `let`
- `for let item` — mutable borrow на элемент, `arr` должен быть `let`
- Добавлять/удалять элементы из массива внутри цикла нельзя — массив заимствован

---

## Move из массива по индексу и dangling reference

Два разных случая — два разных типа ошибки.

### Случай 1: `ref` — owned (`User`)

```typescript
let ref: User;
(() => {
  const users = [user1, user2, user3];
  ref = users[0]; // попытка move из массива по индексу
  // массив остаётся с дыркой на [0] — невалидное состояние
  // когда scope кончится, users попытается освободить [0] → двойное освобождение
})();
```

```
error: cannot move out of array by index
  --> main.tsc:4
hint: use users.remove(0) to take ownership of an element
```

Исправление — `remove()` корректно изымает элемент:

```typescript
let ref: User;
(() => {
  let users = [user1, user2, user3];
  ref = users.remove(0); // move с удалением из массива — массив валиден
})();
console.log(ref); // ok — ref владеет объектом
```

### Случай 2: `ref` — borrow (`&User`)

```typescript
let ref: User;
(() => {
  const users = [user1, user2, user3];
  ref = users[0]; // borrow на элемент users[0]
  // scope кончается, users умирает
  // ref теперь указывает на освобождённую память
})();
console.log(ref); // ошибка: ref пережил владельца
```

```
error: `ref` does not live long enough — borrowed value `users` is dropped here
  --> main.tsc:5
```

Исправление A — использовать borrow внутри скопа владельца:

```typescript
(() => {
  const users = [user1, user2, user3];
  const ref: User = users[0];
  console.log(ref); // ok — ref и users в одном скопе
})();
```

Исправление B — поднять владельца на уровень выше:

```typescript
const users = [user1, user2, user3];
const ref: User = users[0];
console.log(ref); // ok — users живёт не меньше чем ref
```

---

## Мутация коллекции при активном borrow на элемент

Borrow элемента = borrow самой коллекции. Пока borrow активен — коллекцию нельзя мутировать.

```typescript
let users = [user1, user2, user3]
const u: &User = users[0]   // borrow элемента = borrow массива
users.push(user4)            // ошибка: mut метод на заимствованном массиве
console.log(u.name)          // 💥 u dangling если бы push прошёл
```

```
error: cannot call mut method on `users` while it is borrowed
  --> main.tsc:3
   |
 2 | const u: &User = users[0]   ← borrow starts here
 3 | users.push(user4)            ← mut access here
hint: drop `u` before modifying `users`
```

Исправление — не держать borrow когда нужно мутировать:
```typescript
let users = [user1, user2, user3]
users.push(user4)            // ok — нет активных borrows
const u: &User = users[0]   // borrow после мутации
console.log(u.name)          // ok
```

Любой `mut` метод на коллекции при активном borrow — ошибка. `remove()` — то же самое:

```typescript
let users = [user1, user2, user3]
const u: &User = users[0]
users.remove(0)      // ошибка: тот же конфликт
console.log(u.name)  // 💥
```

Это частный случай правила: **нельзя mutable + immutable borrow одновременно**.

---

## Возврат ссылки из метода

Метод может возвращать `&T` — компилятор автоматически привязывает возвращаемый borrow к времени жизни `this`. Явных lifetime аннотаций не нужно.

```typescript
class Config {
    data: string[]

    getFirst(): &string {
        return this.data[0]   // borrow живёт столько же сколько this
    }
}

const config = new Config()
const s = config.getFirst()   // ok — s привязан к config
console.log(s)                // ok
```

Компилятор ловит использование после смерти владельца:

```typescript
let s: &string
{
    const config = new Config()
    s = config.getFirst()   // borrow привязан к config
}
console.log(s)   // ошибка: config умер, s dangling
```

```
error: `s` does not live long enough — borrowed value `config` is dropped here
  --> main.tsc:5
```

**Правило:** возвращаемый `&T` из метода неявно привязан к `this` — без аннотаций, компилятор выводит сам.

---

## Borrows в полях класса — запрещено

Хранить `&T` в поле класса нельзя — это требовало бы lifetime аннотаций на самом классе.

```typescript
class View {
    data: &User[]   // ошибка: нельзя хранить borrow в поле класса
}
```

```
error: borrow types are not allowed in class fields
  --> main.tsc:2
hint: store an owned value instead, or accept &T as a method parameter
```

Альтернативы:

```typescript
// владеем данными
class View {
    data: User[]   // owned — View владеет массивом
}

// временный доступ — через параметр метода, не поле
function renderView(data: &User[]) { ... }
```

**Правило:** `&T` разрешён только как тип параметра функции/метода и как тип локальной переменной. В полях класса — запрещён.

---

## Borrow из разных владельцев через условие

`ref` должен не пережить **ни одного** из возможных источников. Компилятор строит граф возможных источников и проверяет что все они живут не меньше чем `ref`.

Оба владельца в одном скопе — ok:

```typescript
const admins = [admin1, admin2]
const guests = [guest1, guest2]

let ref: &User
if condition {
    ref = admins[0]
} else {
    ref = guests[0]
}
console.log(ref.name)   // ok — и admins и guests живы
```

Один из владельцев умирает раньше — ошибка:

```typescript
let ref: &User
{
    const admins = [admin1, admin2]
    if condition {
        ref = admins[0]   // admins умрёт в конце блока
    }
}
console.log(ref.name)   // ошибка: ref может указывать на мёртвый admins
```

```
error: `ref` does not live long enough — `admins` may be dropped while `ref` is still in use
  --> main.tsc:8
```

---

## Мутабельность через цепочку `const`/`let`

Чтобы мутировать элемент через borrow — оба (`владелец` и `borrow`) должны быть `let`.

**Ошибка 1:** `const u` — immutable borrow, мутировать нельзя:

```typescript
const users = [user1, user2, user3]
const u = users[0]
u.name = "test"   // ошибка: u — const
```

```
error: cannot assign to `u.name` — `u` is immutable
  --> main.tsc:3
hint: use `let u` for a mutable borrow
```

**Ошибка 2:** `let u` из `const` массива — нельзя получить mutable borrow из immutable владельца:

```typescript
const users = [user1, user2, user3]
let u = users[0]    // ошибка: users — const
u.name = "test"
```

```
error: cannot borrow `users[0]` as mutable — `users` is declared as immutable
  --> main.tsc:2
hint: change `const users` to `let users`
```

**Правильно** — оба `let`:

```typescript
let users = [user1, user2, user3]
let u = users[0]
u.name = "test"   // ok — изменения попадают в users[0]
```

---

## Замыкания и захват переменных

Замыкания захватывают сложные типы по ссылке. Тип захвата компилятор выводит автоматически по использованию внутри closure:
- только чтение → `&` (immutable borrow)
- есть мутация → `&mut` (mutable borrow)

Базовый случай — ok:
```typescript
const items = [1, 2, 3]
const fn = () => items.length   // fn держит &items
fn()   // ok — items жив
```

Closure не может пережить захваченный владелец:
```typescript
let fn: () => i32
{
    const items = [1, 2, 3]
    fn = () => items.length   // fn захватывает &items
}
fn()   // ошибка: items мёртв, fn держит dangling borrow
```

```
error: `fn` does not live long enough — captured `items` is dropped here
  --> main.tsc:5
```

Конфликт borrows через closure — те же правила:
```typescript
let items = [1, 2, 3]
const fn = () => items.length   // fn держит &items (immutable)
items.push(4)                   // ошибка: нельзя вызвать mut метод пока fn держит borrow
```

Мутирующее замыкание захватывает `&mut` — нельзя иметь другие borrows одновременно:
```typescript
let items = [1, 2, 3]
let fn = () => { items.push(4) }    // fn держит &mut items
const fn2 = () => items.length      // ошибка: уже есть активный &mut borrow через fn
```

---

## Spread оператор

Spread **потребляет** источник — move всех элементов. Нет скрытых копий.

### Массивы

```typescript
const admins = [admin1, admin2]
const users = [...admins, ...guests]   // admins и guests перемещены
sendEmail(admins)                      // ошибка: admins перемещён
```

Решение — использовать оригинал до spread:
```typescript
sendEmail(admins)
logStats(admins)
const users = [...admins, ...guests]   // move в конце — ok
```

### Объекты

```typescript
const obj1 = { name: "Alice", address: addr }
const obj2 = { ...obj1, age: 30 }   // obj1 потреблён
console.log(obj1)                    // ошибка: obj1 перемещён
```

### Несколько spread из одного источника — нужен явный clone

```typescript
const base = [item1, item2]
const listA = [...base.clone(), itemA]   // явная копия
const listB = [...base, itemB]           // move — base перемещён
```

Примитивы в spread всегда копируются — move применяется только к сложным типам.

---

## Lifetimes

Явных lifetime аннотаций нет. Компилятор выводит всё сам через scope-анализ:

- Borrow не может пережить владельца — проверяется по скопам
- Возвращаемый `&T` из метода неявно привязан к `this`
- Borrows в полях класса — запрещены (исключают необходимость lifetime аннотаций на классах)
- Компилятор строит граф возможных источников borrow и проверяет все пути

Если компилятор не может вывести — ошибка с человеческим сообщением и подсказкой.

---

## Нерешённые вопросы

- **Деструктуризация** — частичная деструктуризация с partial move: разрешить (усложняет компилятор) или запретить (требовать деструктурировать всё)? Синтаксис borrow-деструктуризации через `&`.
- **Срезы** — семантика `arr[1..3]`: borrow части массива (`&T[]`) или новый owned массив?
