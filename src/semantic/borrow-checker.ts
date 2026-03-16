import * as ts from "typescript";
import { isCopyType } from "../compiler/type-mapper.js";

export interface BorrowCheckError {
  message: string;
  line: number;
  column: number;
  code: string;
}

interface VariableInfo {
  name: string;
  type: string;
  scopeLevel: number;
  isMutable: boolean;
  line: number;
  status: "alive" | "moved" | "frozen";
}

interface BorrowInfo {
  owner: string;
  isMutable: boolean;
  scopeLevel: number;
  line: number;
}

export class BorrowChecker {
  private errors: BorrowCheckError[] = [];
  private currentScope = 0;
  private variables: Map<string, VariableInfo> = new Map();
  private activeBorrows: BorrowInfo[] = [];

  check(sourceFile: ts.SourceFile): BorrowCheckError[] {
    this.errors = [];
    this.currentScope = 0;
    this.variables.clear();
    this.activeBorrows = [];
    
    this.visitNode(sourceFile, sourceFile);
    return this.errors;
  }

  private visitNode(node: ts.Node, sourceFile: ts.SourceFile): void {
    if (ts.isBlock(node)) {
      this.enterScope();
      ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
      this.exitScope();
      return;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      this.declareVariable(node, sourceFile);
    }

    if (ts.isPrefixUnaryExpression(node) && node.getText().startsWith("&")) {
      this.checkBorrowCreation(node, sourceFile);
    }

    if (ts.isIdentifier(node)) {
      this.checkVariableUse(node, sourceFile);
    }

    if (ts.isCallExpression(node)) {
      this.checkCallExpression(node, sourceFile);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
  }

  private enterScope(): void {
    this.currentScope++;
  }

  private exitScope(): void {
    this.activeBorrows = this.activeBorrows.filter(b => b.scopeLevel < this.currentScope);
    
    for (const [name, info] of this.variables) {
      if (info.scopeLevel === this.currentScope) {
        this.variables.delete(name);
      }
    }
    
    this.currentScope--;
  }

  private declareVariable(node: ts.VariableDeclaration, sourceFile: ts.SourceFile): void {
    const name = node.name.getText(sourceFile);
    const type = node.type?.getText(sourceFile) || "unknown";
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const isMutable = this.isMutableDeclaration(node);

    this.variables.set(name, {
      name,
      type,
      scopeLevel: this.currentScope,
      isMutable,
      line,
      status: "alive",
    });
  }

  private isMutableDeclaration(node: ts.VariableDeclaration): boolean {
    let parent = node.parent;
    while (parent) {
      if (ts.isVariableDeclarationList(parent)) {
        return (parent.flags & ts.NodeFlags.Const) === 0;
      }
      parent = (parent as any).parent;
    }
    return true;
  }

  private checkBorrowCreation(node: ts.PrefixUnaryExpression, sourceFile: ts.SourceFile): void {
    const operand = node.operand;
    
    if (!ts.isIdentifier(operand)) return;

    const ownerName = operand.getText(sourceFile);
    const ownerInfo = this.variables.get(ownerName);
    
    if (!ownerInfo) return;

    const isMutableBorrow = node.getText().startsWith("&mut ");
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    if (ownerInfo.status === "moved") {
      this.errors.push({
        message: `cannot borrow '${ownerName}' because it was moved`,
        line: line + 1,
        column: character + 1,
        code: "E0383",
      });
      return;
    }

    if (isMutableBorrow && !ownerInfo.isMutable) {
      this.errors.push({
        message: `cannot borrow '${ownerName}' as mutable, as it is not declared as mutable`,
        line: line + 1,
        column: character + 1,
        code: "E0596",
      });
      return;
    }

    const existingImmutable = this.activeBorrows.filter(b => b.owner === ownerName && !b.isMutable);
    const existingMutable = this.activeBorrows.filter(b => b.owner === ownerName && b.isMutable);

    if (isMutableBorrow) {
      if (existingImmutable.length > 0) {
        this.errors.push({
          message: `cannot borrow '${ownerName}' as mutable because it is also borrowed as immutable`,
          line: line + 1,
          column: character + 1,
          code: "E0502",
        });
        return;
      }
      if (existingMutable.length > 0) {
        this.errors.push({
          message: `cannot borrow '${ownerName}' as mutable more than once at a time`,
          line: line + 1,
          column: character + 1,
          code: "E0499",
        });
        return;
      }
    } else {
      if (existingMutable.length > 0) {
        this.errors.push({
          message: `cannot borrow '${ownerName}' as immutable because it is also borrowed as mutable`,
          line: line + 1,
          column: character + 1,
          code: "E0502",
        });
        return;
      }
    }

    this.activeBorrows.push({
      owner: ownerName,
      isMutable: isMutableBorrow,
      scopeLevel: this.currentScope,
      line: line + 1,
    });

    if (isMutableBorrow) {
      ownerInfo.status = "frozen";
    }
  }

  private checkVariableUse(node: ts.Identifier, sourceFile: ts.SourceFile): void {
    const name = node.getText(sourceFile);
    const info = this.variables.get(name);
    
    if (!info) return;

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    if (info.status === "moved") {
      this.errors.push({
        message: `use of moved value: '${name}'`,
        line: line + 1,
        column: character + 1,
        code: "E0382",
      });
      return;
    }

    const activeMutableBorrow = this.activeBorrows.find(b => b.owner === name && b.isMutable);
    if (activeMutableBorrow && info.status === "frozen") {
      this.errors.push({
        message: `cannot use '${name}' because it is mutably borrowed`,
        line: line + 1,
        column: character + 1,
        code: "E0503",
      });
    }
  }

  private checkCallExpression(node: ts.CallExpression, sourceFile: ts.SourceFile): void {
    for (const arg of node.arguments) {
      const actualArg = this.unwrapBorrow(arg);
      
      if (ts.isIdentifier(actualArg)) {
        const name = actualArg.getText(sourceFile);
        const varInfo = this.variables.get(name);
        
        if (varInfo && !isCopyType(varInfo.type)) {
          if (this.isBorrow(arg)) {
            // Borrow - remains valid
          } else {
            // Move - ownership transferred
            varInfo.status = "moved";
          }
        }
      }
    }
  }

  private isBorrow(node: ts.Expression): boolean {
    if (ts.isPrefixUnaryExpression(node)) {
      return node.getText().startsWith("&");
    }
    return false;
  }

  private unwrapBorrow(node: ts.Expression): ts.Expression {
    if (ts.isPrefixUnaryExpression(node) && node.getText().startsWith("&")) {
      return node.operand;
    }
    return node;
  }
}
