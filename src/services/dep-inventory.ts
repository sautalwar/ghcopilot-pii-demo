import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DependencyNode {
  name: string;
  version: string;
  depth: number;
  isDirect: boolean;
  license?: string;
  dependencies: DependencyNode[];
}

export interface DependencyInventory {
  direct: Map<string, string>;       // name → version range from package.json
  all: Map<string, string>;          // name → resolved version (all deps including transitive)
  tree: DependencyNode[];            // full tree from root
  totalCount: number;
  maxDepth: number;
}

export interface DependencyChain {
  target: string;
  chains: string[][];                // all paths from root → target, each entry is "pkg@version"
  minDepth: number;
  maxDepth: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

interface LockfileEntry {
  version?: string;
  resolved?: string;
  license?: string;
  dependencies?: Record<string, string | LockfileEntry>;
  dev?: boolean;
}

interface Lockfile {
  lockfileVersion?: number;
  packages?: Record<string, LockfileEntry>;
  dependencies?: Record<string, LockfileEntry>;
}

interface PkgJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Extract the package name from a `packages` key path.
 * Paths look like:
 *   "node_modules/express"
 *   "node_modules/express/node_modules/qs"
 *   "node_modules/@scope/pkg"
 */
function packageNameFromPath(entryPath: string): string | null {
  const segments = entryPath.split('node_modules/');
  const last = segments[segments.length - 1];
  return last || null;
}

/**
 * Compute depth from the lockfile path.
 * "node_modules/express"                          → depth 1
 * "node_modules/express/node_modules/qs"          → depth 2
 * "node_modules/a/node_modules/b/node_modules/c"  → depth 3
 */
function depthFromPath(entryPath: string): number {
  const parts = entryPath.split('node_modules/');
  // First element is always "" (before the first node_modules/)
  return parts.length - 1;
}

// ── Lockfile v2/v3 parsing (packages map) ──────────────────────────────────────

function buildFromPackagesMap(
  packages: Record<string, LockfileEntry>,
  directNames: Set<string>,
): { allDeps: Map<string, string>; tree: DependencyNode[]; maxDepth: number } {

  const allDeps = new Map<string, string>();
  // Map: packageName → { version, license, depth, childNames }
  interface ParsedEntry {
    name: string;
    version: string;
    license?: string;
    depth: number;
    path: string;
    childNames: string[];
  }

  const entries: ParsedEntry[] = [];
  // parentPath → child ParsedEntry[]
  const childrenByParent = new Map<string, ParsedEntry[]>();

  for (const [entryPath, entry] of Object.entries(packages)) {
    if (entryPath === '') continue; // root entry
    const name = packageNameFromPath(entryPath);
    if (!name) continue;
    const version = entry.version ?? 'unknown';
    allDeps.set(name, version);

    const depth = depthFromPath(entryPath);
    const childNames = entry.dependencies ? Object.keys(entry.dependencies) : [];

    const parsed: ParsedEntry = {
      name,
      version,
      license: entry.license,
      depth,
      path: entryPath,
      childNames,
    };
    entries.push(parsed);

    // Determine logical parent path
    const lastNm = entryPath.lastIndexOf('node_modules/');
    const parentPath = lastNm > 0
      ? entryPath.substring(0, lastNm - 1) // strip trailing /
      : '';                                  // direct dep → parent is root

    if (!childrenByParent.has(parentPath)) {
      childrenByParent.set(parentPath, []);
    }
    childrenByParent.get(parentPath)!.push(parsed);
  }

  // Recursive tree builder with cycle detection
  const visited = new Set<string>();

  function buildNode(parsed: ParsedEntry): DependencyNode {
    const node: DependencyNode = {
      name: parsed.name,
      version: parsed.version,
      depth: parsed.depth,
      isDirect: directNames.has(parsed.name) && parsed.depth === 1,
      license: parsed.license,
      dependencies: [],
    };

    if (visited.has(parsed.path)) return node;
    visited.add(parsed.path);

    const children = childrenByParent.get(parsed.path) ?? [];
    node.dependencies = children.map(c => buildNode(c));

    // Also resolve declared dependencies that are hoisted (not nested)
    for (const childName of parsed.childNames) {
      const alreadyIncluded = node.dependencies.some(d => d.name === childName);
      if (alreadyIncluded) continue;

      // Look for the hoisted package by walking up
      const hoisted = findHoisted(childName, parsed.path, entries);
      if (hoisted && !visited.has(hoisted.path)) {
        node.dependencies.push(buildNode(hoisted));
      }
    }

    visited.delete(parsed.path);
    return node;
  }

  // Walk up to find a hoisted dependency
  function findHoisted(name: string, fromPath: string, allEntries: ParsedEntry[]): ParsedEntry | undefined {
    // Try "node_modules/<name>" (top-level hoist)
    const topLevel = allEntries.find(e => e.path === `node_modules/${name}`);
    if (topLevel) return topLevel;

    // Try intermediate hoist levels
    const segments = fromPath.split('/node_modules/');
    for (let i = segments.length - 1; i >= 1; i--) {
      const prefix = segments.slice(0, i).join('/node_modules/');
      const candidate = `${prefix}/node_modules/${name}`;
      const found = allEntries.find(e => e.path === candidate);
      if (found) return found;
    }
    return undefined;
  }

  // Build the top-level tree from root's direct children
  const rootChildren = childrenByParent.get('') ?? [];
  const tree = rootChildren.map(c => buildNode(c));

  let maxDepth = 0;
  for (const e of entries) {
    if (e.depth > maxDepth) maxDepth = e.depth;
  }

  return { allDeps, tree, maxDepth };
}

// ── Lockfile v1 fallback (dependencies map) ────────────────────────────────────

function buildFromDependenciesMap(
  deps: Record<string, LockfileEntry>,
  directNames: Set<string>,
): { allDeps: Map<string, string>; tree: DependencyNode[]; maxDepth: number } {

  const allDeps = new Map<string, string>();
  let maxDepth = 0;

  function walk(
    depsMap: Record<string, LockfileEntry>,
    currentDepth: number,
    visited: Set<string>,
  ): DependencyNode[] {
    const nodes: DependencyNode[] = [];
    for (const [name, entry] of Object.entries(depsMap)) {
      const version = entry.version ?? 'unknown';
      allDeps.set(name, version);
      if (currentDepth > maxDepth) maxDepth = currentDepth;

      if (visited.has(name)) {
        nodes.push({
          name,
          version,
          depth: currentDepth,
          isDirect: directNames.has(name) && currentDepth === 1,
          dependencies: [],
        });
        continue;
      }

      visited.add(name);
      const children = entry.dependencies
        ? walk(entry.dependencies as Record<string, LockfileEntry>, currentDepth + 1, visited)
        : [];
      visited.delete(name);

      nodes.push({
        name,
        version,
        depth: currentDepth,
        isDirect: directNames.has(name) && currentDepth === 1,
        dependencies: children,
      });
    }
    return nodes;
  }

  const tree = walk(deps, 1, new Set());
  return { allDeps, tree, maxDepth };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function buildInventory(repoRoot?: string): DependencyInventory {
  const root = repoRoot ?? process.cwd();
  const pkgPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');

  const pkg = readJson<PkgJson>(pkgPath);
  if (!pkg) {
    return {
      direct: new Map(),
      all: new Map(),
      tree: [],
      totalCount: 0,
      maxDepth: 0,
    };
  }

  const direct = new Map<string, string>();
  const combinedDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  for (const [name, range] of Object.entries(combinedDeps)) {
    direct.set(name, range);
  }
  const directNames = new Set(direct.keys());

  const lockfile = readJson<Lockfile>(lockPath);

  if (lockfile?.packages) {
    // Lockfile v2 or v3
    const { allDeps, tree, maxDepth } = buildFromPackagesMap(lockfile.packages, directNames);
    return { direct, all: allDeps, tree, totalCount: allDeps.size, maxDepth };
  }

  if (lockfile?.dependencies) {
    // Lockfile v1
    const { allDeps, tree, maxDepth } = buildFromDependenciesMap(lockfile.dependencies, directNames);
    return { direct, all: allDeps, tree, totalCount: allDeps.size, maxDepth };
  }

  // No lockfile — return direct deps only
  const tree: DependencyNode[] = [];
  for (const [name, version] of direct.entries()) {
    tree.push({ name, version, depth: 1, isDirect: true, dependencies: [] });
  }
  return { direct, all: new Map(direct), tree, totalCount: direct.size, maxDepth: direct.size > 0 ? 1 : 0 };
}

export function findDependencyChains(packageName: string, repoRoot?: string): DependencyChain {
  const inventory = buildInventory(repoRoot);
  const chains: string[][] = [];

  function walk(node: DependencyNode, currentPath: string[]): void {
    const entry = `${node.name}@${node.version}`;
    const pathSoFar = [...currentPath, entry];

    if (node.name === packageName) {
      chains.push(pathSoFar);
    }

    for (const child of node.dependencies) {
      walk(child, pathSoFar);
    }
  }

  for (const root of inventory.tree) {
    walk(root, []);
  }

  const depths = chains.map(c => c.length);
  return {
    target: packageName,
    chains,
    minDepth: depths.length > 0 ? Math.min(...depths) : 0,
    maxDepth: depths.length > 0 ? Math.max(...depths) : 0,
  };
}

/** Alias for findDependencyChains — useful when tracing vulnerable package paths. */
export function getVulnerablePaths(packageName: string, repoRoot?: string): DependencyChain {
  return findDependencyChains(packageName, repoRoot);
}

export function isDirectDependency(packageName: string, repoRoot?: string): boolean {
  const root = repoRoot ?? process.cwd();
  const pkg = readJson<PkgJson>(path.join(root, 'package.json'));
  if (!pkg) return false;
  return !!(pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]);
}
