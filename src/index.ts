#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { CScriptCompiler } from "./compiler/index.js";
import { BorrowChecker } from "./semantic/borrow-checker.js";
import * as ts from "typescript";

const compiler = new CScriptCompiler();

function printUsage(): void {
  console.log(`
CScript - TypeScript to C Compiler

Usage:
  cscript compile <file> [-o <output>]   Compile CScript to C
  cscript check <file>                   Type and borrow check only
  cscript --help                         Show this help

Examples:
  cscript compile src/main.cs -o dist/main.c
  cscript check src/main.cs
`);
}

function compileFile(inputFile: string, outputFile?: string): void {
  const absoluteInput = path.resolve(inputFile);
  
  if (!fs.existsSync(absoluteInput)) {
    console.error(`Error: File not found: ${absoluteInput}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(absoluteInput, "utf-8");
  const result = compiler.compile(sourceCode, { inputFile: absoluteInput });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(formatCompileError(error));
    }
    process.exit(1);
  }

  if (outputFile) {
    const absoluteOutput = path.resolve(outputFile);
    const outputDir = path.dirname(absoluteOutput);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(absoluteOutput, result.code);
    console.log(`Compiled: ${absoluteInput} -> ${absoluteOutput}`);
  } else {
    console.log(result.code);
  }
}

function checkFile(inputFile: string): void {
  const absoluteInput = path.resolve(inputFile);
  
  if (!fs.existsSync(absoluteInput)) {
    console.error(`Error: File not found: ${absoluteInput}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(absoluteInput, "utf-8");
  
  const sourceFile = ts.createSourceFile(
    absoluteInput,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const borrowChecker = new BorrowChecker();
  const borrowErrors = borrowChecker.check(sourceFile);

  if (borrowErrors.length > 0) {
    for (const error of borrowErrors) {
      console.error(formatBorrowError(error, absoluteInput));
    }
    process.exit(1);
  }

  console.log(`✓ No errors found in ${inputFile}`);
}

function formatCompileError(error: { message: string; line?: number; column?: number; code?: string }): string {
  let result = "";
  if (error.code) {
    result += `error[${error.code}]: `;
  } else {
    result += "error: ";
  }
  result += error.message;
  if (error.line) {
    result += ` (line ${error.line}`;
    if (error.column) {
      result += `:${error.column}`;
    }
    result += ")";
  }
  return result;
}

function formatBorrowError(error: { message: string; line: number; column: number; code: string }, file: string): string {
  return `error[${error.code}]: ${error.message}\n  --> ${file}:${error.line}:${error.column}`;
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printUsage();
  process.exit(0);
}

const command = args[0];

switch (command) {
  case "compile": {
    const inputIdx = args.findIndex((a) => !a.startsWith("-") && a !== "compile");
    const outputIdx = args.indexOf("-o");
    
    if (inputIdx === -1) {
      console.error("Error: No input file specified");
      process.exit(1);
    }
    
    const inputFile = args[inputIdx];
    const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
    
    compileFile(inputFile, outputFile);
    break;
  }
  
  case "check": {
    const inputIdx = args.findIndex((a) => !a.startsWith("-") && a !== "check");
    
    if (inputIdx === -1) {
      console.error("Error: No input file specified");
      process.exit(1);
    }
    
    checkFile(args[inputIdx]);
    break;
  }
  
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
