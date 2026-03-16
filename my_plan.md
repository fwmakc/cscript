Чтобы сохранялся синтаксис ts/js

Нужны стандартные простые функции

console.log
print
input

let всегда будут мутабельные
const всегда будут иммутабельные

простые типы - строки и числа - всегда будут передаваться по значению, для них будут создаваться копии
типы массив, объект, класс - всегда будут передаваться по ссылке

может быть, тогда mut и & можно исключить, как ты считаешь?

Следующие шаги (не в MVP):

- Closures (first-class functions)
- Pattern matching, enums
- Кроссплатформенная сборка (DOS, Web)

Вопрос 2: const для объектов
const player = new Player();
player.x = 10; // можно (поверхностный const)
player = new Player(); // нельзя (ссылка immutable)

глубокого immutable
Если const = глубокий immutable, то player.x = 10 тоже ошибка.

function take(p: Player): void
то это точно ownership (p перемещён)

если

function getName(p: &Player): string {
return p.name;
}
const player = new Player();
const pName = getName(&player);
player.move(10,20);

то это передача по ссылке, не владение

---

Мои предложения:

1. Парсер readonly → Декоратор @readonly
   // Borrow функция
   @readonly
   function getName(p: Player): string {
   return p.name;
   }
   // Borrow метод
   class Player {
   @readonly
   getX(): i32 {
   return this.x;
   }
   }
   Плюсы:

- Валидный TypeScript (с experimentalDecorators)
- Консистентно с существующим @native
- Легко парсить — уже есть код для декораторов

2. Методы без @readonly:

- Принимают ownership (ClassName\* self, не const)
- Если return type void → компилятор меняет на ClassName\* и добавляет неявный return self; в конце
- Если return type указан явно → используется как есть
  class Player {
  // Borrow → const Player\* self, return i32
  @readonly
  getX(): i32 { return this.x; }
      // Ownership → Player* self, void → Player*, неявный return self
      move(dx: i32): void {  // можно не писать void, но для ясности
          this.x += dx;
      }

      // Ownership → Player* self, return Player (явный)
      chain(dx: i32): Player {
          this.x += dx;
          return this;
      }
  }
  Звучит разумно?
