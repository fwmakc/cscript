export enum VariableStatus {
  Alive = "Alive",
  Borrowed = "Borrowed", 
  Moved = "Moved",
}

export interface VariableInfo {
  name: string;
  type: string;
  status: VariableStatus;
  scopeLevel: number;
  isMutable: boolean;
  line: number;
}

export class ScopeTracker {
  private scopes: Map<number, Map<string, VariableInfo>> = new Map();
  private currentScope = 0;

  enterScope(): void {
    this.currentScope++;
    if (!this.scopes.has(this.currentScope)) {
      this.scopes.set(this.currentScope, new Map());
    }
  }

  exitScope(): { name: string; type: string }[] {
    const varsToFree: { name: string; type: string }[] = [];
    const scope = this.scopes.get(this.currentScope);
    
    if (scope) {
      for (const [name, info] of scope) {
        if (info.status === VariableStatus.Alive) {
          varsToFree.push({ name, type: info.type });
        }
      }
      scope.clear();
    }
    
    this.currentScope--;
    return varsToFree;
  }

  declareVariable(
    name: string,
    type: string,
    isMutable: boolean,
    line: number
  ): void {
    const scope = this.scopes.get(this.currentScope);
    if (scope) {
      scope.set(name, {
        name,
        type,
        status: VariableStatus.Alive,
        scopeLevel: this.currentScope,
        isMutable,
        line,
      });
    }
  }

  markMoved(name: string): boolean {
    for (let i = this.currentScope; i >= 0; i--) {
      const scope = this.scopes.get(i);
      if (scope?.has(name)) {
        const info = scope.get(name)!;
        info.status = VariableStatus.Moved;
        return true;
      }
    }
    return false;
  }

  markBorrowed(name: string): boolean {
    for (let i = this.currentScope; i >= 0; i--) {
      const scope = this.scopes.get(i);
      if (scope?.has(name)) {
        const info = scope.get(name)!;
        info.status = VariableStatus.Borrowed;
        return true;
      }
    }
    return false;
  }

  getVariable(name: string): VariableInfo | undefined {
    for (let i = this.currentScope; i >= 0; i--) {
      const scope = this.scopes.get(i);
      if (scope?.has(name)) {
        return scope.get(name);
      }
    }
    return undefined;
  }

  isAlive(name: string): boolean {
    const info = this.getVariable(name);
    return info?.status === VariableStatus.Alive;
  }

  isMoved(name: string): boolean {
    const info = this.getVariable(name);
    return info?.status === VariableStatus.Moved;
  }

  isBorrowed(name: string): boolean {
    const info = this.getVariable(name);
    return info?.status === VariableStatus.Borrowed;
  }
}
