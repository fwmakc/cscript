export function formatError(
  message: string,
  line?: number,
  column?: number,
  code?: string
): string {
  const parts: string[] = [];
  
  if (code) {
    parts.push(`error[${code}]`);
  } else {
    parts.push("error");
  }
  
  parts.push(`: ${message}`);
  
  if (line !== undefined) {
    parts.push(` (line ${line}`);
    if (column !== undefined) {
      parts.push(`:${column}`);
    }
    parts.push(")");
  }
  
  return parts.join("");
}

export function throwError(
  message: string,
  line?: number,
  column?: number,
  code?: string
): never {
  throw new Error(formatError(message, line, column, code));
}
