import { describe, it, expect } from "vitest";
import { CScriptCompiler } from "../src/compiler/index.js";

describe("CScriptCompiler", () => {
  const compiler = new CScriptCompiler();

  describe("type mapping", () => {
    it("maps number to int32_t", () => {
      const code = `
        function main(): number {
          return 0;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("int32_t main");
    });

    it("maps i32 to int32_t", () => {
      const code = `
        function test(x: i32): i32 {
          return x;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("int32_t test(int32_t x)");
    });

    it("maps f64 to double", () => {
      const code = `
        function pi(): f64 {
          return 3.14;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("double pi");
    });

    it("maps bool to bool", () => {
      const code = `
        function flag(): bool {
          return true;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("bool flag");
    });

    it("maps string to char*", () => {
      const code = `
        function name(): string {
          return "test";
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("char* name");
    });
  });

  describe("function generation", () => {
    it("generates empty main", () => {
      const code = `
        function main(): void {
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("void main(void)");
    });

    it("generates function with parameters", () => {
      const code = `
        function add(a: i32, b: i32): i32 {
          return a + b;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("int32_t add(int32_t a, int32_t b)");
    });

    it("generates variable declaration", () => {
      const code = `
        function main(): void {
          let x: i32 = 10;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("int32_t x = 10");
    });
  });

  describe("native functions", () => {
    it("generates extern declaration", () => {
      const code = `
        @native("printf")
        declare function print(format: string, ...args: any): void;
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain('extern void printf(char*, ...)');
    });

    it("maps native function calls", () => {
      const code = `
        @native("printf")
        declare function print(format: string, ...args: any): void;
        
        function main(): void {
          print("hello");
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain('printf("hello")');
    });
  });

  describe("includes", () => {
    it("includes standard headers", () => {
      const code = `function main(): void {}`;
      const result = compiler.compile(code);
      expect(result.code).toContain("#include <stdio.h>");
      expect(result.code).toContain("#include <stdint.h>");
      expect(result.code).toContain("#include <stdbool.h>");
    });
  });

  describe("expressions", () => {
    it("handles arithmetic", () => {
      const code = `
        function calc(): i32 {
          return 1 + 2 * 3;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("return 1 + 2 * 3");
    });

    it("maps null to NULL", () => {
      const code = `
        function getNull(): string {
          return null;
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("return NULL");
    });
  });

  describe("structs", () => {
    it("generates struct from interface", () => {
      const code = `
        interface Point {
          x: f64,
          y: f64,
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("typedef struct {");
      expect(result.code).toContain("double x;");
      expect(result.code).toContain("double y;");
      expect(result.code).toContain("} Point;");
    });
  });

  describe("classes", () => {
    it("generates struct from class", () => {
      const code = `
        class Player {
          x: i32 = 0,
          y: i32 = 0,
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("typedef struct {");
      expect(result.code).toContain("int32_t x;");
      expect(result.code).toContain("} Player;");
    });

    it("generates constructor", () => {
      const code = `
        class Player {
          x: i32 = 10,
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("Player* Player_new()");
      expect(result.code).toContain("malloc(sizeof(Player))");
      expect(result.code).toContain("self->x = 10");
    });

    it("generates methods", () => {
      const code = `
        class Player {
          x: i32 = 0,
          move(dx: i32): void {
            this.x += dx;
          }
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("void Player_move(Player* self, int32_t dx)");
    });

    it("generates new expression", () => {
      const code = `
        class Player {}
        function main(): void {
          let p = new Player();
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("Player* p = Player_new()");
    });

    it("generates method calls", () => {
      const code = `
        class Player {
          move(): void {}
        }
        function main(): void {
          let p = new Player();
          p.move();
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("Player_move(p)");
    });

    it("generates property access with arrow", () => {
      const code = `
        class Player {
          x: i32 = 0,
        }
        function main(): void {
          let p = new Player();
          print("%d", p.x);
        }
      `;
      const result = compiler.compile(code);
      expect(result.code).toContain("p->x");
    });
  });
});
