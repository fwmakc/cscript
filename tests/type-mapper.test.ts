import { describe, it, expect } from "vitest";
import { mapType, isCopyType, TYPE_MAP, COPY_TYPES } from "../src/compiler/type-mapper.js";

describe("type-mapper", () => {
  describe("TYPE_MAP", () => {
    it("maps number to int32_t", () => {
      expect(TYPE_MAP["number"]).toBe("int32_t");
    });

    it("maps i32 to int32_t", () => {
      expect(TYPE_MAP["i32"]).toBe("int32_t");
    });

    it("maps f64 to double", () => {
      expect(TYPE_MAP["f64"]).toBe("double");
    });

    it("maps string to char*", () => {
      expect(TYPE_MAP["string"]).toBe("char*");
    });
  });

  describe("mapType", () => {
    it("maps primitive types", () => {
      expect(mapType("i32")).toBe("int32_t");
      expect(mapType("f64")).toBe("double");
      expect(mapType("bool")).toBe("bool");
    });

    it("maps reference types", () => {
      expect(mapType("&i32")).toBe("int32_t*");
      expect(mapType("&string")).toBe("char**");
    });

    it("maps mutable reference types", () => {
      expect(mapType("&mut i32")).toBe("int32_t*");
    });

    it("maps nullable types", () => {
      expect(mapType("i32 | null")).toBe("int32_t*");
    });

    it("maps fixed arrays", () => {
      expect(mapType("[i32; 10]")).toBe("int32_t[10]");
    });
  });

  describe("isCopyType", () => {
    it("returns true for number", () => {
      expect(isCopyType("number")).toBe(true);
    });

    it("returns true for integer types", () => {
      expect(isCopyType("i32")).toBe(true);
      expect(isCopyType("u64")).toBe(true);
    });

    it("returns true for float types", () => {
      expect(isCopyType("f32")).toBe(true);
      expect(isCopyType("f64")).toBe(true);
    });

    it("returns true for bool", () => {
      expect(isCopyType("bool")).toBe(true);
    });

    it("returns false for string", () => {
      expect(isCopyType("string")).toBe(false);
    });

    it("returns false for custom types", () => {
      expect(isCopyType("MyStruct")).toBe(false);
    });
  });

  describe("COPY_TYPES", () => {
    it("contains number", () => {
      expect(COPY_TYPES.has("number")).toBe(true);
    });
  });
});
