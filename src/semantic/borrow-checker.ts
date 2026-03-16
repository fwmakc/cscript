import * as ts from "typescript";
import { ScopeTracker, VariableStatus } from "./scope-tracker.js";
import { isCopyType } from "../compiler/type-mapper.js";

export interface BorrowCheckError {
  message: string;
  line: number;
  column: number;
  code: string;
}

export class BorrowChecker {
  private scopeTracker: ScopeTracker;
  private errors: BorrowCheckError[] = [];

  constructor() {
    this.scopeTracker = new ScopeTracker();
  }

  check(sourceFile: ts.SourceFile): BorrowCheckError[] {
    this.errors = [];
    this.visitNode(sourceFile, sourceFile);
    return this.errors;
  }

  private visitNode(node: ts.Node, sourceFile: ts.SourceFile): void {
    if (ts.isBlock(node)) {
      this.scopeTracker.enterScope();
      ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
      this.scopeTracker.exitScope();
      return;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.getText(sourceFile);
      const type = node.type?.getText(sourceFile) || "unknown";
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      
      const isLet = this.isLetDeclaration(node);
      this.scopeTracker.declareVariable(name, type, !isLet, line);
    }

    if (ts.isIdentifier(node)) {
      const name = node.getText(sourceFile);
      if (this.scopeTracker.isMoved(name)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        this.errors.push({
          message: `use of moved value: '${name}'`,
          line: line + 1,
          column: character + 1,
          code: "E0382",
        });
      }
    }

    if (ts.isCallExpression(node)) {
      this.checkCallExpression(node, sourceFile);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
  }

  private isLetDeclaration(node: ts.VariableDeclaration): boolean {
    let parent = node.parent;
    while (parent) {
      if (ts.isVariableDeclarationList(parent)) {
        return (parent.flags & ts.NodeFlags.Let) !== 0;
      }
      parent = (parent as any).parent;
    }
    return true;
  }

  private checkCallExpression(node: ts.CallExpression, sourceFile: ts.SourceFile): void {
    for (const arg of node.arguments) {
      const actualArg = this.unwrapBorrow(arg);
      
      if (ts.isIdentifier(actualArg)) {
        const name = actualArg.getText(sourceFile);
        const varInfo = this.scopeTracker.getVariable(name);
        
        if (varInfo && !isCopyType(varInfo.type)) {
          if (this.isBorrow(arg)) {
            this.scopeTracker.markBorrowed(name);
          } else {
            this.scopeTracker.markMoved(name);
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

  getScopeTracker(): ScopeTracker {
    return this.scopeTracker;
  }
}
