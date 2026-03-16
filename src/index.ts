#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { CScriptCompiler } from "./compiler/index.js";
import { BorrowChecker } from "./semantic/borrow-checker.js";
import { loadConfig, saveConfig, createDefaultConfig, generateCMake } from "./builder/index.js";
import * as ts from "typescript";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compiler = new CScriptCompiler();

function printUsage(): void {
  console.log(`
CScript - TypeScript to C Compiler

Usage:
  cscript compile <file> [-o <output>]   Compile CScript to C
  cscript check <file>                   Type and borrow check only
  cscript build [--platform <name>]     Build project with CMake
  cscript init <name>                    Create new project
  cscript --help                           Show this help

Examples:
  cscript compile src/main.cs -o dist/main.c
  cscript check src/main.cs
  cscript build
  cscript build --platform web
  cscript init my-project
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

function buildProject(projectDir: string, options: { platform?: string }): void {
  const config = loadConfig(projectDir);
  
  if (!config) {
    console.error(`Error: cscript.json not found in ${projectDir}`);
    process.exit(1);
  }

  const entryFile = path.resolve(projectDir, config.entry);
  
  if (!fs.existsSync(entryFile)) {
    console.error(`Error: Entry file not found: ${entryFile}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(entryFile, "utf-8");
  const result = compiler.compile(sourceCode, { inputFile: entryFile });
  
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(formatCompileError(error));
    }
    process.exit(1);
  }

  const outDir = path.resolve(projectDir, config.outDir);
  const cFile = path.join(outDir, path.basename(entryFile, ".c"));
  
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(cFile, result.code);
  
  const cmakeFile = path.join(outDir, "CMakeLists.txt");
  const cmakeContent = generateCMake(config, cFile);
  fs.writeFileSync(cmakeFile, cmakeContent);
  
  const buildDir = path.join(outDir, "build");
  
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const buildProcess = child_process.spawn("cmake", ["-S", buildDir, "-B", "RELEASE"], {
    cwd: buildDir,
    stdio: "inherit",
  });
  
  buildProcess.on("close", () => {
    if (buildProcess.exitCode === 0) {
      console.log(`✓ Build successful: ${config.name}`);
      console.log(`  Binary: ${path.join(buildDir, config.name)}`);
    } else {
      console.error("Build failed");
      process.exit(1);
    }
  });
}

function initProject(projectName: string): void {
  const projectDir = path.resolve(projectName);
  
  if (fs.existsSync(projectDir)) {
    console.error(`Error: Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  
  const mainContent = `@native("printf")
declare function print(format: string, ...args: any): void;

function main(): i32 {
    print("Hello from ${projectName}!\\n");
    return 0;
}
`;
  
  const mainFile = path.join(projectDir, "src", "main.cs");
  fs.writeFileSync(mainFile, mainContent);
  
  const config = createDefaultConfig(projectName);
  saveConfig(config, projectDir);
  
  console.log(`Created project: ${projectName}`);
  console.log(`  Entry: src/main.cs`);
  console.log(`  Run: cscript build`);
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
  
  case "build": {
    const platformIdx = args.indexOf("--platform");
    const platform = platformIdx !== -1 ? args[platformIdx + 1] : undefined;
    
    buildProject(process.cwd(), { platform });
    break;
  }
  
  case "init": {
    const nameIdx = args.findIndex((a) => !a.startsWith("-") && a !== "init");
    
    if (nameIdx === -1) {
      console.error("Error: No project name specified");
      process.exit(1);
    }
    
    initProject(args[nameIdx]);
    break;
  }
  
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
