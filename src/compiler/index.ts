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

export interface FieldInfo {
  name: string;
  type: string;
}

export interface StructInfo {
  name: string;
  fields: FieldInfo[];
  isClass: boolean;
  defaults?: Map<string, string>;
}

export interface MethodInfo {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
  body?: ts.Block;
}

export class CScriptCompiler {
  private nativeFunctionMap: Map<string, string> = new Map();
  private structTypes: Map<string, StructInfo> = new Map();
  private classMethods: Map<string, MethodInfo[]> = new Map();

  compile(sourceCode: string, options?: CompileOptions): CompileResult {
    const errors: CompileError[] = [];
    this.nativeFunctionMap.clear();
    this.structTypes.clear();
    this.classMethods.clear();
    
    const sourceFile = ts.createSourceFile(
      options?.inputFile || "input.cs",
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    this.collectNativeFunctions(sourceFile);
    this.collectStructs(sourceFile);
    this.collectClasses(sourceFile);

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

  private collectStructs(sourceFile: ts.SourceFile): void {
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.getText(sourceFile);
        const fields: FieldInfo[] = [];
        
        ts.forEachChild(node, (member) => {
          if (ts.isPropertySignature(member) && member.name && member.type) {
            fields.push({
              name: member.name.getText(sourceFile),
              type: member.type.getText(sourceFile),
            });
          }
        });
        
        this.structTypes.set(name, { name, fields, isClass: false });
      }
    });
  }

  private collectClasses(sourceFile: ts.SourceFile): void {
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.getText(sourceFile);
        const fields: FieldInfo[] = [];
        const methods: MethodInfo[] = [];
        const defaults: Map<string, string> = new Map();
        
        ts.forEachChild(node, (member) => {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const fieldName = member.name.getText(sourceFile);
            const fieldType = member.type?.getText(sourceFile) ?? "i32";
            fields.push({ name: fieldName, type: fieldType });
            
            if (member.initializer) {
              defaults.set(fieldName, member.initializer.getText(sourceFile));
            }
          }
          
          if (ts.isMethodDeclaration(member) && member.name) {
            methods.push({
              name: member.name.getText(sourceFile),
              params: member.parameters.map(p => ({
                name: p.name.getText(sourceFile),
                type: p.type?.getText(sourceFile) ?? "void",
              })),
              returnType: member.type?.getText(sourceFile) ?? "void",
              body: member.body,
            });
          }
        });
        
        this.structTypes.set(name, { name, fields, isClass: true, defaults });
        this.classMethods.set(name, methods);
      }
    });
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

    for (const [name, structInfo] of this.structTypes) {
      lines.push(this.generateStruct(structInfo));
      lines.push("");
    }

    for (const [className, methods] of this.classMethods) {
      const structInfo = this.structTypes.get(className);
      if (structInfo) {
        lines.push(this.generateClassConstructor(structInfo, sourceFile));
        lines.push("");
        
        for (const method of methods) {
          lines.push(this.generateClassMethod(className, method, sourceFile));
          lines.push("");
        }
      }
    }

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

  private generateStruct(structInfo: StructInfo): string {
    const lines: string[] = [];
    lines.push(`typedef struct {`);
    
    for (const field of structInfo.fields) {
      const cType = this.mapType(field.type);
      lines.push(`    ${cType} ${field.name};`);
    }
    
    lines.push(`} ${structInfo.name};`);
    return lines.join("\n");
  }

  private generateClassConstructor(structInfo: StructInfo, sourceFile: ts.SourceFile): string {
    const lines: string[] = [];
    const name = structInfo.name;
    
    lines.push(`${name}* ${name}_new() {`);
    lines.push(`    ${name}* self = (${name}*)malloc(sizeof(${name}));`);
    
    for (const field of structInfo.fields) {
      const defaultVal = structInfo.defaults?.get(field.name) ?? "0";
      const expr = this.mapType(field.type) === "char*" ? `"${defaultVal}"` : defaultVal;
      lines.push(`    self->${field.name} = ${expr};`);
    }
    
    lines.push(`    return self;`);
    lines.push(`}`);
    
    return lines.join("\n");
  }

  private generateClassMethod(
    className: string,
    method: MethodInfo,
    sourceFile: ts.SourceFile
  ): string {
    const params = [`${className}* self`, ...method.params.map(p => `${this.mapType(p.type)} ${p.name}`)];
    const returnType = this.mapType(method.returnType);
    
    let body = "    // no body";
    if (method.body) {
      body = this.generateClassMethodBody(method.body, sourceFile);
    }
    
    return `${returnType} ${className}_${method.name}(${params.join(", ")}) {\n${body}\n}`;
  }

  private generateClassMethodBody(body: ts.Block, sourceFile: ts.SourceFile): string {
    const statements: string[] = [];
    
    ts.forEachChild(body, (node) => {
      if (ts.isStatement(node)) {
        const generated = this.generateClassMethodStatement(node, sourceFile);
        if (generated) statements.push("    " + generated);
      }
    });

    return statements.join("\n");
  }

  private generateClassMethodStatement(stmt: ts.Statement, sourceFile: ts.SourceFile): string {
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      
      if (ts.isBinaryExpression(expr)) {
        const left = expr.left.getText(sourceFile);
        const right = this.generateExpression(expr.right, sourceFile);
        
        if (left.startsWith("this.")) {
          const field = left.slice(5);
          return `self->${field} ${expr.operatorToken.getText(sourceFile)} ${right};`;
        }
      }
      
      return `${this.generateExpression(expr, sourceFile)};`;
    }
    
    if (ts.isReturnStatement(stmt)) {
      if (stmt.expression) {
        return `return ${this.generateExpression(stmt.expression, sourceFile)};`;
      }
      return "return;";
    }
    
    return this.generateStatement(stmt, sourceFile);
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
      if (ts.isNewExpression(decl.initializer)) {
        const className = decl.initializer.expression.getText(sourceFile);
        type = `${className}*`;
        return `${type} ${name} = ${className}_new();`;
      }
      
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
    
    if (ts.isNewExpression(expr)) {
      const className = expr.expression.getText(sourceFile);
      return `${className}_new()`;
    }
    
    if (ts.isCallExpression(expr)) {
      return this.generateCallExpression(expr, sourceFile);
    }
    
    if (ts.isPropertyAccessExpression(expr)) {
      return this.generatePropertyAccess(expr, sourceFile);
    }
    
    if (ts.isIdentifier(expr)) {
      const name = expr.getText(sourceFile);
      return this.nativeFunctionMap.get(name) ?? name;
    }
    
    return expr.getText(sourceFile);
  }

  private generatePropertyAccess(
    expr: ts.PropertyAccessExpression,
    sourceFile: ts.SourceFile
  ): string {
    const obj = expr.expression.getText(sourceFile);
    const prop = expr.name.getText(sourceFile);
    
    return `${obj}->${prop}`;
  }

  private generateCallExpression(
    expr: ts.CallExpression,
    sourceFile: ts.SourceFile
  ): string {
    const callee = expr.expression;
    
    if (ts.isPropertyAccessExpression(callee)) {
      return this.generateMethodCall(expr, callee, sourceFile);
    }
    
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

  private generateMethodCall(
    callExpr: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    sourceFile: ts.SourceFile
  ): string {
    const obj = callee.expression.getText(sourceFile);
    const methodName = callee.name.getText(sourceFile);
    
    for (const [className, methods] of this.classMethods) {
      if (methods.some(m => m.name === methodName)) {
        const args = [obj, ...callExpr.arguments.map(arg => this.generateExpression(arg, sourceFile))];
        return `${className}_${methodName}(${args.join(", ")})`;
      }
    }
    
    const args = callExpr.arguments
      .map(arg => this.generateExpression(arg, sourceFile))
      .join(", ");
    return `${obj}.${methodName}(${args})`;
  }
}
