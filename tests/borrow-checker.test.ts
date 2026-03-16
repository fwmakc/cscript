import { describe, it, expect } from "vitest";
import { BorrowChecker } from "../src/semantic/borrow-checker.js";
import * as ts from "typescript";

describe("BorrowChecker", () => {
  function check(code: string) {
    const sourceFile = ts.createSourceFile(
      "test.cs",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const checker = new BorrowChecker();
    return checker.check(sourceFile);
  }

  describe("move semantics", () => {
    it("allows using copy types multiple times", () => {
      const code = `
        function take(n: i32): void {}
        function main(): void {
          let x: i32 = 10;
          take(x);
          take(x);
        }
      `;
      const errors = check(code);
      expect(errors).toHaveLength(0);
    });

    it("errors on moved reference type", () => {
      const code = `
        function take(s: string): void {}
        function main(): void {
          let s: string = "hello";
          take(s);
          take(s);
        }
      `;
      const errors = check(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].code).toBe("E0382");
      expect(errors[0].message).toContain("moved value");
    });

    it("allows borrowing with &", () => {
      const code = `
        function borrow(s: string): void {}
        function main(): void {
          let s: string = "hello";
          borrow(&s);
          borrow(&s);
        }
      `;
      const errors = check(code);
      expect(errors).toHaveLength(0);
    });
  });

  describe("number type", () => {
    it("treats number as copy type", () => {
      const code = `
        function take(n: number): void {}
        function main(): void {
          let x: number = 10;
          take(x);
          take(x);
        }
      `;
      const errors = check(code);
      expect(errors).toHaveLength(0);
    });
  });
});
