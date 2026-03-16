export interface ProjectConfig {
  name: string;
  version: string;
  entry: string;
  outDir: string;
  dependencies?: Record<string, DependencyConfig>;
  assets?: string[];
  platforms?: Record<string, PlatformConfig>;
}

export interface DependencyConfig {
  git?: string;
  tag?: string;
  path?: string;
}

export interface PlatformConfig {
  toolchain?: string;
  flags?: string[];
}

export interface BuildOptions {
  platform?: string;
  release?: boolean;
  verbose?: boolean;
}
