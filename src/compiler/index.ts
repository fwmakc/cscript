import * as ts from "typescript";

export interface CompileResult {
  code: string;
  errors: CompileError[];
}

export interface CompileError {
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface CompileOptions {
  inputFile: string;
  outputFile?: string;
  checkOnly?: boolean;
}

export class CScriptCompiler {
  private nativeFunctionMap: Map<string, string> = new Map();

  compile(sourceCode: string, options?: CompileOptions): CompileResult {
    const errors: CompileError[] = [];
    this.nativeFunctionMap.clear();
    
    const sourceFile = ts.createSourceFile(
      options?.inputFile || "input.cs",
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    this.collectNativeFunctions(sourceFile);

    const diagnostics: CompileError[] = [];
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isFunctionDeclaration(node)) {
        diagnostics.push(...this.validateFunction(node, sourceFile));
      }
    });

    for (const diag of diagnostics) {
      errors.push({
        message: diag.message,
        line: diag.line,
        column: diag.column,
        code: diag.code,
      });
    }

    if (options?.checkOnly) {
      return { code: "", errors };
    }

    const code = this.generateCode(sourceFile);
    
    return { code, errors };
  }

  private collectNativeFunctions(sourceFile: ts.SourceFile): void {
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isFunctionDeclaration(node) && this.isDeclareFunction(node)) {
        const name = node.name?.getText(sourceFile);
        const nativeName = this.getNativeName(node) ?? name;
        if (name && nativeName) {
          this.nativeFunctionMap.set(name, nativeName);
        }
      }
    });
  }

  private validateFunction(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): CompileError[] {
    const errors: CompileError[] = [];
    return errors;
  }

  private generateCode(sourceFile: ts.SourceFile): string {
    const lines: string[] = [];
    
    lines.push("#include <stdio.h>");
    lines.push("#include <stdint.h>");
    lines.push("#include <stdlib.h>");
    lines.push("#include <stdbool.h>");
    lines.push("");

    const nativeDecls: string[] = [];
    
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isFunctionDeclaration(node)) {
        if (this.isDeclareFunction(node)) {
          nativeDecls.push(this.generateNativeDeclaration(node, sourceFile));
        } else {
          lines.push(this.generateFunction(node, sourceFile));
          lines.push("");
        }
      }
    });

    if (nativeDecls.length > 0) {
      const nativeSection = nativeDecls.join("\n");
      lines.unshift(nativeSection + "\n");
    }

    return lines.join("\n");
  }

  private isDeclareFunction(node: ts.FunctionDeclaration): boolean {
    return node.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  }

  private getNativeName(node: ts.FunctionDeclaration): string | null {
    for (const modifier of node.modifiers ?? []) {
      if (ts.isDecorator(modifier)) {
        const expr = modifier.expression;
        if (ts.isCallExpression(expr) && 
            ts.isIdentifier(expr.expression) && 
            expr.expression.getText() === "native") {
          const arg = expr.arguments[0];
          if (ts.isStringLiteral(arg)) {
            return arg.text;
          }
        }
      }
    }
    return null;
  }

  private generateNativeDeclaration(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const nativeName = this.getNativeName(node) ?? node.name?.getText(sourceFile) ?? "unknown";
    const returnType = this.mapReturnType(node.type);
    const params = this.generateNativeParams(node.parameters, sourceFile);
    return `extern ${returnType} ${nativeName}(${params});`;
  }

  private generateNativeParams(
    params: ts.NodeArray<ts.ParameterDeclaration>,
    sourceFile: ts.SourceFile
  ): string {
    if (params.length === 0) return "void";
    
    const hasRest = params.some(p => !!p.dotDotDotToken);
    
    return params
      .filter(p => !p.dotDotDotToken)
      .map((p) => {
        const type = p.type ? this.mapType(p.type.getText(sourceFile)) : "void";
        return type;
      })
      .join(", ") + (hasRest ? ", ..." : "");
  }

  private generateFunction(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const name = node.name?.getText(sourceFile) || "anonymous";
    const returnType = this.mapReturnType(node.type);
    const params = this.generateParams(node.parameters, sourceFile);
    const body = this.generateBody(node.body, sourceFile);

    return `${returnType} ${name}(${params}) {\n${body}\n}`;
  }

  private mapReturnType(typeNode: ts.TypeNode | undefined): string {
    if (!typeNode) return "void";
    return this.mapType(typeNode.getText());
  }

  private mapType(tsType: string): string {
    const typeMap: Record<string, string> = {
      number: "int32_t",
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
    };

    return typeMap[tsType] || tsType;
  }

  private generateParams(
    params: ts.NodeArray<ts.ParameterDeclaration>,
    sourceFile: ts.SourceFile
  ): string {
    if (params.length === 0) return "void";
    
    return params
      .map((p) => {
        const name = p.name.getText(sourceFile);
        const type = p.type ? this.mapType(p.type.getText(sourceFile)) : "void";
        return `${type} ${name}`;
      })
      .join(", ");
  }

  private generateBody(
    body: ts.Block | undefined,
    sourceFile: ts.SourceFile
  ): string {
    if (!body) return "  // no body";

    const statements: string[] = [];
    
    ts.forEachChild(body, (node) => {
      if (ts.isStatement(node)) {
        const generated = this.generateStatement(node, sourceFile);
        if (generated) statements.push("  " + generated);
      }
    });

    return statements.join("\n");
  }

  private generateStatement(
    stmt: ts.Statement,
    sourceFile: ts.SourceFile
  ): string {
    if (ts.isVariableStatement(stmt)) {
      return this.generateVariableDeclaration(stmt, sourceFile);
    }
    
    if (ts.isReturnStatement(stmt)) {
      if (stmt.expression) {
        return `return ${this.generateExpression(stmt.expression, sourceFile)};`;
      }
      return "return;";
    }

    if (ts.isExpressionStatement(stmt)) {
      return `${this.generateExpression(stmt.expression, sourceFile)};`;
    }

    return `// unsupported statement: ${ts.SyntaxKind[stmt.kind]}`;
  }

  private generateVariableDeclaration(
    stmt: ts.VariableStatement,
    sourceFile: ts.SourceFile
  ): string {
    const decl = stmt.declarationList.declarations[0];
    const name = decl.name.getText(sourceFile);
    
    let type = "int32_t";
    if (decl.type) {
      type = this.mapType(decl.type.getText(sourceFile));
    }

    if (decl.initializer) {
      const init = this.generateExpression(decl.initializer, sourceFile);
      return `${type} ${name} = ${init};`;
    }

    return `${type} ${name};`;
  }

  private generateExpression(
    expr: ts.Expression,
    sourceFile: ts.SourceFile
  ): string {
    if (expr.kind === ts.SyntaxKind.NullKeyword) {
      return "NULL";
    }
    
    if (ts.isCallExpression(expr)) {
      return this.generateCallExpression(expr, sourceFile);
    }
    
    if (ts.isIdentifier(expr)) {
      const name = expr.getText(sourceFile);
      return this.nativeFunctionMap.get(name) ?? name;
    }
    
    return expr.getText(sourceFile);
  }

  private generateCallExpression(
    expr: ts.CallExpression,
    sourceFile: ts.SourceFile
  ): string {
    const callee = expr.expression;
    let funcName: string;
    
    if (ts.isIdentifier(callee)) {
      const name = callee.getText(sourceFile);
      funcName = this.nativeFunctionMap.get(name) ?? name;
    } else {
      funcName = callee.getText(sourceFile);
    }
    
    const args = expr.arguments
      .map(arg => this.generateExpression(arg, sourceFile))
      .join(", ");
    
    return `${funcName}(${args})`;
  }
}
