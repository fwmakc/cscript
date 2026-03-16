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
  typeParams?: string[];
}

export interface MethodInfo {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
  body?: ts.Block;
}

export interface GenericFunctionInfo {
  name: string;
  typeParams: string[];
  params: { name: string; type: string }[];
  returnType: string;
  body?: ts.Block;
}

export interface Monomorphization {
  originalName: string;
  typeArgs: string[];
  specialized: string;
}

export interface StructMonomorphization {
  originalName: string;
  typeArgs: string[];
  specialized: string;
}

export class CScriptCompiler {
  private nativeFunctionMap: Map<string, string> = new Map();
  private structTypes: Map<string, StructInfo> = new Map();
  private classMethods: Map<string, MethodInfo[]> = new Map();
  private genericFunctions: Map<string, GenericFunctionInfo> = new Map();
  private monomorphizations: Map<string, Monomorphization> = new Map();
  private structMonomorphizations: Map<string, StructMonomorphization> = new Map();
  private variableTypes: Map<string, string> = new Map();

  compile(sourceCode: string, options?: CompileOptions): CompileResult {
    const errors: CompileError[] = [];
    this.nativeFunctionMap.clear();
    this.structTypes.clear();
    this.classMethods.clear();
    this.genericFunctions.clear();
    this.monomorphizations.clear();
    this.structMonomorphizations.clear();
    this.variableTypes.clear();
    
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
    this.collectGenericFunctions(sourceFile);
    this.collectMonomorphizations(sourceFile);

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
        const typeParams = node.typeParameters?.map(tp => tp.name.getText(sourceFile)) ?? [];
        
        ts.forEachChild(node, (member) => {
          if (ts.isPropertySignature(member) && member.name && member.type) {
            fields.push({
              name: member.name.getText(sourceFile),
              type: member.type.getText(sourceFile),
            });
          }
        });
        
        this.structTypes.set(name, { name, fields, isClass: false, typeParams });
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

  private collectGenericFunctions(sourceFile: ts.SourceFile): void {
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.typeParameters) {
        const name = node.name.getText(sourceFile);
        const typeParams = node.typeParameters.map(tp => tp.name.getText(sourceFile));
        const params = node.parameters.map(p => ({
          name: p.name.getText(sourceFile),
          type: p.type?.getText(sourceFile) ?? "void",
        }));
        const returnType = node.type?.getText(sourceFile) ?? "void";
        
        this.genericFunctions.set(name, {
          name,
          typeParams,
          params,
          returnType,
          body: node.body,
        });
      }
    });
  }

  private collectMonomorphizations(sourceFile: ts.SourceFile): void {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.typeArguments && ts.isIdentifier(node.expression)) {
        const funcName = node.expression.getText(sourceFile);
        const genericFunc = this.genericFunctions.get(funcName);
        
        if (genericFunc) {
          const typeArgs = node.typeArguments.map(ta => ta.getText(sourceFile));
          this.monomorphizeFunction(genericFunc, typeArgs, sourceFile);
        }
      }

      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeArguments) {
        const structName = node.typeName.getText(sourceFile);
        const structInfo = this.structTypes.get(structName);
        
        if (structInfo && structInfo.typeParams && structInfo.typeParams.length > 0) {
          const typeArgs = node.typeArguments.map(ta => ta.getText(sourceFile));
          this.monomorphizeStruct(structInfo, typeArgs);
        }
      }
      
      ts.forEachChild(node, visit);
    };
    
    ts.forEachChild(sourceFile, visit);
  }

  private monomorphizeStruct(
    structInfo: StructInfo,
    typeArgs: string[]
  ): StructMonomorphization {
    const key = this.getMonomorphizationKey(structInfo.name, typeArgs);
    const existing = this.structMonomorphizations.get(key);
    if (existing) return existing;

    const specialized = this.mangleName(structInfo.name, typeArgs);
    const mono: StructMonomorphization = {
      originalName: structInfo.name,
      typeArgs,
      specialized,
    };
    this.structMonomorphizations.set(key, mono);
    return mono;
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
      if (!structInfo.typeParams || structInfo.typeParams.length === 0) {
        lines.push(this.generateStruct(structInfo));
        lines.push("");
      }
    }

    for (const [key, mono] of this.structMonomorphizations) {
      const structInfo = this.structTypes.get(mono.originalName);
      if (structInfo) {
        lines.push(this.generateMonomorphizedStruct(structInfo, mono.typeArgs));
        lines.push("");
      }
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

    for (const [key, mono] of this.monomorphizations) {
      const funcInfo = this.genericFunctions.get(mono.originalName);
      if (funcInfo) {
        lines.push(this.generateMonomorphizedFunction(funcInfo, mono.typeArgs, sourceFile));
        lines.push("");
      }
    }

    const nativeDecls: string[] = [];
    
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isFunctionDeclaration(node)) {
        if (this.isDeclareFunction(node)) {
          nativeDecls.push(this.generateNativeDeclaration(node, sourceFile));
        } else if (node.typeParameters) {
          // Generic functions are handled via monomorphization
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

  private generateMonomorphizedStruct(structInfo: StructInfo, typeArgs: string[]): string {
    const typeArgMap = new Map<string, string>();
    structInfo.typeParams?.forEach((param, i) => {
      typeArgMap.set(param, typeArgs[i]);
    });

    const lines: string[] = [];
    const name = this.mangleName(structInfo.name, typeArgs);
    lines.push(`typedef struct {`);
    
    for (const field of structInfo.fields) {
      const substitutedType = this.substituteType(field.type, typeArgMap);
      const cType = this.mapType(substitutedType);
      lines.push(`    ${cType} ${field.name};`);
    }
    
    lines.push(`} ${name};`);
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
    const genericMatch = tsType.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const baseName = genericMatch[1];
      const typeArgs = genericMatch[2].split(",").map(t => t.trim());
      return this.mangleName(baseName, typeArgs);
    }

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
    let originalType = "i32";
    if (decl.type) {
      originalType = decl.type.getText(sourceFile);
      type = this.mapType(originalType);
    }

    if (decl.initializer) {
      if (ts.isNewExpression(decl.initializer)) {
        const className = decl.initializer.expression.getText(sourceFile);
        type = `${className}*`;
        originalType = `${className}*`;
        this.variableTypes.set(name, originalType);
        return `${type} ${name} = ${className}_new();`;
      }
      
      this.variableTypes.set(name, originalType);
      const init = this.generateExpression(decl.initializer, sourceFile);
      return `${type} ${name} = ${init};`;
    }

    this.variableTypes.set(name, originalType);
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
    
    const varType = this.variableTypes.get(obj);
    if (varType && varType.endsWith("*")) {
      return `${obj}->${prop}`;
    }
    return `${obj}.${prop}`;
  }

  private isPointerVariable(varName: string, sourceFile: ts.SourceFile): boolean {
    const varType = this.variableTypes.get(varName);
    return varType !== undefined && varType.endsWith("*");
  }

  private generateCallExpression(
    expr: ts.CallExpression,
    sourceFile: ts.SourceFile
  ): string {
    const callee = expr.expression;
    
    if (ts.isPropertyAccessExpression(callee)) {
      return this.generateMethodCall(expr, callee, sourceFile);
    }

    if (ts.isCallExpression(expr) && expr.typeArguments) {
      if (ts.isIdentifier(expr.expression)) {
        const funcName = expr.expression.getText(sourceFile);
        const genericFunc = this.genericFunctions.get(funcName);
        
        if (genericFunc) {
          const typeArgs = expr.typeArguments.map(ta => ta.getText(sourceFile));
          const mono = this.monomorphizeFunction(genericFunc, typeArgs, sourceFile);
          
          const args = expr.arguments
            .map(arg => this.generateExpression(arg, sourceFile))
            .join(", ");
          
          return `${mono.specialized}(${args})`;
        }
      }
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

  private substituteType(type: string, typeArgs: Map<string, string>): string {
    let result = type;
    for (const [param, arg] of typeArgs) {
      result = result.replace(new RegExp(`\\b${param}\\b`, "g"), arg);
    }
    return result;
  }

  private mangleName(baseName: string, typeArgs: string[]): string {
    if (typeArgs.length === 0) return baseName;
    const suffix = typeArgs.map(t => t.replace(/[^a-zA-Z0-9]/g, "_")).join("_");
    return `${baseName}_${suffix}`;
  }

  private getMonomorphizationKey(name: string, typeArgs: string[]): string {
    return `${name}<${typeArgs.join(", ")}>`;
  }

  private monomorphizeFunction(
    funcInfo: GenericFunctionInfo,
    typeArgs: string[],
    sourceFile: ts.SourceFile
  ): Monomorphization {
    const key = this.getMonomorphizationKey(funcInfo.name, typeArgs);
    const existing = this.monomorphizations.get(key);
    if (existing) return existing;

    const specialized = this.mangleName(funcInfo.name, typeArgs);
    const mono: Monomorphization = {
      originalName: funcInfo.name,
      typeArgs,
      specialized,
    };
    this.monomorphizations.set(key, mono);
    return mono;
  }

  private generateMonomorphizedFunction(
    funcInfo: GenericFunctionInfo,
    typeArgs: string[],
    sourceFile: ts.SourceFile
  ): string {
    const typeArgMap = new Map<string, string>();
    funcInfo.typeParams.forEach((param, i) => {
      typeArgMap.set(param, typeArgs[i]);
    });

    const name = this.mangleName(funcInfo.name, typeArgs);
    const returnType = this.mapType(this.substituteType(funcInfo.returnType, typeArgMap));
    const params = funcInfo.params.map(p => 
      `${this.mapType(this.substituteType(p.type, typeArgMap))} ${p.name}`
    ).join(", ");

    let body = "  // no body";
    if (funcInfo.body) {
      body = this.generateMonomorphizedBody(funcInfo.body, typeArgMap, sourceFile);
    }

    return `${returnType} ${name}(${params}) {\n${body}\n}`;
  }

  private generateMonomorphizedBody(
    body: ts.Block,
    typeArgMap: Map<string, string>,
    sourceFile: ts.SourceFile
  ): string {
    const statements: string[] = [];
    
    ts.forEachChild(body, (node) => {
      if (ts.isStatement(node)) {
        const generated = this.generateStatementWithTypeSubstitution(node, typeArgMap, sourceFile);
        if (generated) statements.push("  " + generated);
      }
    });

    return statements.join("\n");
  }

  private generateStatementWithTypeSubstitution(
    stmt: ts.Statement,
    typeArgMap: Map<string, string>,
    sourceFile: ts.SourceFile
  ): string {
    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      const name = decl.name.getText(sourceFile);
      
      let type = "int32_t";
      if (decl.type) {
        const originalType = decl.type.getText(sourceFile);
        type = this.mapType(this.substituteType(originalType, typeArgMap));
      }

      if (decl.initializer) {
        const init = this.generateExpression(decl.initializer, sourceFile);
        return `${type} ${name} = ${init};`;
      }

      return `${type} ${name};`;
    }
    
    return this.generateStatement(stmt, sourceFile);
  }
}
