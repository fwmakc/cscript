export const TYPE_MAP: Record<string, string> = {
  i8: "int8_t",
  i16: "int16_t",
  i32: "int32_t",
  i64: "int64_t",
  u8: "uint8_t",
  u16: "uint16_t",
  u32: "uint32_t",
  u64: "uint64_t",
  f32: "float",
  f64: "double",
  bool: "bool",
  void: "void",
  string: "char*",
  any: "void*",
  null: "void*",
};

export const COPY_TYPES = new Set([
  "i8", "i16", "i32", "i64",
  "u8", "u16", "u32", "u64",
  "f32", "f64", "bool",
]);

export function mapType(tsType: string): string {
  if (tsType.startsWith("&")) {
    const innerType = tsType.slice(1).trim();
    return `${mapType(innerType)}*`;
  }
  
  if (tsType.startsWith("&mut ")) {
    const innerType = tsType.slice(5).trim();
    return `${mapType(innerType)}*`;
  }

  if (tsType.includes("| null")) {
    const baseType = tsType.replace("| null", "").trim();
    return `${mapType(baseType)}*`;
  }

  if (tsType.startsWith("[") && tsType.includes(";")) {
    const match = tsType.match(/\[(.+);\s*(\d+)\]/);
    if (match) {
      const elementType = mapType(match[1]);
      return `${elementType}[${match[2]}]`;
    }
  }

  return TYPE_MAP[tsType] || tsType;
}

export function isCopyType(tsType: string): boolean {
  return COPY_TYPES.has(tsType);
}

export function isReferenceType(tsType: string): boolean {
  return !isCopyType(tsType) && tsType !== "void";
}

export function getCIncludes(): string[] {
  return [
    "#include <stdio.h>",
    "#include <stdint.h>",
    "#include <stdlib.h>",
    "#include <stdbool.h>",
    "#include <string.h>",
  ];
}
