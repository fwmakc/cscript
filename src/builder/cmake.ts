import * as fs from "fs";
import * as path from "path";
import { ProjectConfig, DependencyConfig, BuildOptions } from "./types.js";

export function generateCMake(config: ProjectConfig, sourceFile: string): string {
  const lines: string[] = [];
  
  lines.push(`cmake_minimum_required(VERSION 3.14)`);
  lines.push(`project(${config.name} C)`);
  lines.push("");
  lines.push(`set(CMAKE_C_STANDARD 11)`);
  lines.push(`set(CMAKE_C_STANDARD_REQUIRED ON)`);
  lines.push("");
  
  if (config.dependencies && Object.keys(config.dependencies).length > 0) {
    lines.push(`include(FetchContent)`);
    lines.push("");
    
    for (const [depName, depConfig] of Object.entries(config.dependencies)) {
      lines.push(...generateDependency(depName, depConfig));
    }
  }
  
  lines.push(`add_executable(${config.name} ${sourceFile})`);
  lines.push("");
  
  const linkedLibs: string[] = [];
  if (config.dependencies) {
    linkedLibs.push(...Object.keys(config.dependencies));
  }
  
  if (linkedLibs.length > 0) {
    lines.push(`target_link_libraries(${config.name} PRIVATE ${linkedLibs.join(" ")})`);
    lines.push("");
  }
  
  lines.push(`if(WIN32)`);
  lines.push(`    target_link_libraries(${config.name} PRIVATE winmm gdi32)`);
  lines.push(`endif()`);
  lines.push("");
  
  if (config.assets && config.assets.length > 0) {
    lines.push(`# Copy assets to build directory`);
    for (const asset of config.assets) {
      lines.push(`file(COPY "\${CMAKE_CURRENT_SOURCE_DIR}/${asset}" DESTINATION "\${CMAKE_BINARY_DIR}")`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

function generateDependency(name: string, config: DependencyConfig): string[] {
  const lines: string[] = [];
  
  if (config.git) {
    lines.push(`FetchContent_Declare(`);
    lines.push(`    ${name}`);
    lines.push(`    GIT_REPOSITORY ${config.git}`);
    if (config.tag) {
      lines.push(`    GIT_TAG ${config.tag}`);
    }
    lines.push(`)`);
    lines.push(`FetchContent_MakeAvailable(${name})`);
    lines.push("");
  } else if (config.path) {
    lines.push(`add_subdirectory(${config.path} ${name})`);
    lines.push("");
  }
  
  return lines;
}

export function writeCMake(config: ProjectConfig, outputDir: string, sourceFile: string): void {
  const cmakeContent = generateCMake(config, sourceFile);
  const cmakePath = path.join(outputDir, "CMakeLists.txt");
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(cmakePath, cmakeContent);
}

export function loadConfig(projectDir: string): ProjectConfig | null {
  const configPath = path.join(projectDir, "typescriptc.json");
  
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  const content = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(content) as ProjectConfig;
}

export function createDefaultConfig(name: string): ProjectConfig {
  return {
    name,
    version: "1.0.0",
    entry: "src/main.tsc",
    outDir: "dist",
  };
}

export function saveConfig(config: ProjectConfig, projectDir: string): void {
  const configPath = path.join(projectDir, "typescriptc.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
