import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

type Layer = 'core' | 'website' | 'persistence' | 'reporting' | 'app' | 'infrastructure';

const FORBIDDEN_LAYERS: Record<Layer, Layer[]> = {
  core: ['website', 'persistence', 'reporting', 'app', 'infrastructure'],
  website: ['persistence', 'reporting', 'app', 'infrastructure'],
  persistence: ['website', 'reporting', 'app'],
  reporting: ['website', 'persistence', 'app', 'infrastructure'],
  app: [],
  infrastructure: ['core', 'website', 'persistence', 'reporting', 'app'],
};

function layerOf(absolutePath: string): Layer {
  const rel = relative(SRC, absolutePath).split(sep).join('/');
  const first = rel.split('/')[0] ?? '';
  if (first === 'core') return 'core';
  if (first === 'website') return 'website';
  if (first === 'persistence') return 'persistence';
  if (first === 'reporting') return 'reporting';
  if (first === 'app') return 'app';
  return 'infrastructure';
}

function collectFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveSpecifier(sourceFile: string, specifier: string): string {
  const base = resolve(dirname(sourceFile), specifier);
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return base;
}

function isInside(directory: string, path: string): boolean {
  const rel = relative(directory, path);
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith(sep);
}

export interface BoundaryViolation {
  file: string;
  specifier: string;
  reason: string;
}

export function checkBoundaries(root = ROOT): BoundaryViolation[] {
  const src = join(root, 'src');
  const violations: BoundaryViolation[] = [];
  for (const file of collectFiles(src)) {
    const sourceLayer = layerOf(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) {
        continue;
      }
      const relFile = relative(root, file).split(sep).join('/');
      if (!specifier.startsWith('.')) {
        if (sourceLayer === 'core') {
          violations.push({
            file: relFile,
            specifier,
            reason: 'evaluator core must be dependency-free',
          });
        } else if (sourceLayer === 'reporting' && !specifier.startsWith('node:')) {
          violations.push({
            file: relFile,
            specifier,
            reason: 'reporting may only use node builtins and core types',
          });
        } else if (
          sourceLayer === 'website' &&
          !(specifier.startsWith('node:') || specifier === 'parse5')
        ) {
          violations.push({
            file: relFile,
            specifier,
            reason: 'website analysis may only use node builtins and parse5',
          });
        }
        continue;
      }
      const target = resolveSpecifier(file, specifier);
      if (sourceLayer === 'core' && !isInside(join(src, 'core'), target)) {
        violations.push({
          file: relFile,
          specifier,
          reason: 'evaluator core may only import core modules',
        });
        continue;
      }
      if (sourceLayer === 'website' && !isInside(join(src, 'website'), target)) {
        violations.push({
          file: relFile,
          specifier,
          reason: 'website analysis may only import website modules',
        });
        continue;
      }
      const targetLayer = layerOf(target);
      if (FORBIDDEN_LAYERS[sourceLayer].includes(targetLayer)) {
        violations.push({
          file: relFile,
          specifier,
          reason: `${sourceLayer} must not import ${targetLayer}`,
        });
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = checkBoundaries(ROOT);
  if (violations.length === 0) {
    console.log('Module boundaries are clean.');
  } else {
    for (const violation of violations) {
      console.error(`${violation.file}: ${violation.specifier} — ${violation.reason}`);
    }
    process.exitCode = 1;
  }
}
