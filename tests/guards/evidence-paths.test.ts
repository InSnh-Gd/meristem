import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

// =============================================================================
// evidence-paths.test.ts
//
// 防盗守卫：确保生产代码、测试文件、文档中不包含内部编排路径引用
// 或任务编号前缀的证据文件名。
//
// 守卫规则：
// 1. docs/、tests/、services/、packages/、apps/ 中任何文件不得包含 ".omo/" 字符串
// 2. docs/、tests/ 中证据文件引用不得使用任务编号前缀（如 t1-、T2-、task-3-）
// 3. 测试文件中的 evidence 路径必须从 import.meta.dir 或 mkdtemp 派生
// =============================================================================

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 扫描源目录（相对于仓库根） */
const SCAN_ROOTS = ["docs", "tests", "services", "packages", "apps"];

/** 需要排除的目录名（不进入扫描） */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".codegraph",
  ".omo",
  ".agents",
]);

/** 需要排除的完整文件路径（不扫描自身） */
const SKIP_FILE_PATHS = new Set<string>();

/** 可读文本文件扩展名 */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".html",
  ".css",
  ".svelte",
  ".xml",
  ".env",
  ".sh",
]);

/** 文件大小上限（字节），超过此大小不扫描内容 */
const MAX_FILE_BYTES = 1_000_000;

/** 内部编排路径模式 */
const OMO_PATH_PATTERN = ".omo/";

/** 任务编号前缀证据文件名模式 */
const TASK_PREFIX_PATTERN = /\bevidence\/[tT]\d+-|\bevidence\/[tT]ask-\d+-/;

// ---------------------------------------------------------------------------
// 文件遍历
// ---------------------------------------------------------------------------

interface FileInfo {
  /** 绝对路径 */
  absPath: string;
  /** 相对于仓库根的路径 */
  relPath: string;
}

/**
 * 递归收集指定目录下的文本文件。
 * 跳过 `.` 开头的隐藏目录、`node_modules` 和排除目录。
 */
function collectTextFiles(rootDir: string, repoRoot: string): FileInfo[] {
  const results: FileInfo[] = [];

  function walk(currentDir: string): void {
    if (!existsSync(currentDir)) return;

    let entries: Dirent<string>[];
    try {
      // Bun readdirSync 支持 withFileTypes 选项
      entries = readdirSync(currentDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return; // 权限不足等跳过
    }

    for (const entry of entries) {
      const absPath = join(currentDir, entry.name);

      // 跳过自身和配置的排除文件
      if (SKIP_FILE_PATHS.has(absPath)) continue;

      if (entry.isDirectory()) {
        // 跳过隐藏目录（.xxx）和语义排除目录
        if (entry.name.startsWith(".") && !SKIP_DIR_NAMES.has(entry.name)) continue;
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(absPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        // 无扩展名文件也可能是文本（如 Dockerfile、Makefile），保守跳过
        if (!TEXT_EXTENSIONS.has(ext) && ext !== "") continue;

        const relPath = relative(repoRoot, absPath);
        results.push({ absPath, relPath });
      }
    }
  }

  walk(rootDir);
  return results;
}

/** 读取文件内容，超过大小上限或二进制则跳过 */
function safeReadFile(absPath: string): string | null {
  try {
    const stats = statSync(absPath);
    if (stats.size > MAX_FILE_BYTES) return null;
    // Bun 的 readFileSync 默认返回 Buffer，指定 encoding 获得 string
    const content = readFileSync(absPath, { encoding: "utf-8" });
    // 简单试探：包含 null 字节视为二进制
    if (content.includes("\0")) return null;
    return content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 扫描逻辑
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  content: string;
  reason: string;
}

/**
 * 扫描所有收集到的文件，查找违规内容。
 */
function scanFiles(files: FileInfo[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const content = safeReadFile(file.absPath);
    if (content === null) continue;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
      if (line === undefined) continue;

      // 检查 .omo/ 引用
      if (line.includes(OMO_PATH_PATTERN)) {
        violations.push({
          file: file.relPath,
          line: lineNo,
          content: line.trim().slice(0, 120),
          reason: `包含禁止的内部编排路径 ".omo/"`,
        });
      }

      // 检查任务编号前缀证据名（仅 docs/ 和 tests/ 需要检查）
      if (
        (file.relPath.startsWith("docs/") || file.relPath.startsWith("tests/")) &&
        TASK_PREFIX_PATTERN.test(line)
      ) {
        violations.push({
          file: file.relPath,
          line: lineNo,
          content: line.trim().slice(0, 120),
          reason: `包含禁止的任务编号前缀证据文件名`,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("evidence path standards guard", () => {
  // 确定仓库根目录（tests/guards/ 的上级的上级）
  const repoRoot = resolve(import.meta.dir, "..", "..");

  // 将守卫测试文件自身加入排除列表
  const guardFilePath = resolve(import.meta.dir, basename(import.meta.file));
  SKIP_FILE_PATHS.add(guardFilePath);

  // 预先收集所有目标文件
  let allFiles: FileInfo[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const rootDir = join(repoRoot, scanRoot);
    if (existsSync(rootDir)) {
      const files = collectTextFiles(rootDir, repoRoot);
      allFiles = allFiles.concat(files);
    }
  }

  // 扫描一次，共享结果
  const violations = scanFiles(allFiles);

  it("no .omo/ references in source, test, or doc files", () => {
    const omoViolations = violations.filter((v) =>
      v.reason.includes(".omo/")
    );

    if (omoViolations.length > 0) {
      const report = omoViolations
        .map((v) => `  ${v.file}:${v.line}: ${v.content}`)
        .join("\n");
      expect().fail(
        `发现 ${omoViolations.length} 处 ".omo/" 内部编排路径引用:\n${report}`
      );
    } else {
      // 断言通过：没有违规
      expect(omoViolations).toHaveLength(0);
    }
  });

  it("no task-number-prefixed evidence names in docs/ and tests/", () => {
    const taskPrefixViolations = violations.filter((v) =>
      v.reason.includes("任务编号前缀")
    );

    if (taskPrefixViolations.length > 0) {
      const report = taskPrefixViolations
        .map((v) => `  ${v.file}:${v.line}: ${v.content}`)
        .join("\n");
      expect().fail(
        `发现 ${taskPrefixViolations.length} 处任务编号前缀证据文件名:\n${report}`
      );
    } else {
      expect(taskPrefixViolations).toHaveLength(0);
    }
  });

  it("all test-code evidence paths derive from import.meta.dir or mkdtemp", () => {
    // 收集 tests/ 目录下所有 .test.ts 文件
    const testFiles = allFiles.filter(
      (f) => f.relPath.startsWith("tests/") && f.relPath.endsWith(".test.ts")
    );

    // 检查测试文件中是否有硬编码的绝对 evidence 路径
    // 正例：join(import.meta.dir, ...) 或 mkdtemp / tmpdir
    // 反例：硬编码的 /home/... 绝对路径，或非 import.meta.dir 派生的 tests/evidence/ 路径
    const hardEvidenceFiles: string[] = [];
    for (const f of testFiles) {
      const content = safeReadFile(f.absPath);
      if (content === null) continue;

      // 检查是否引用了 tests/evidence/ 但不使用 import.meta.dir 或 mkdtemp
      // 简单启发式：如果文件中有 "tests/evidence" 字符串，
      // 检查同一文件内是否有 import.meta.dir 或 mkdtemp 引用
      if (content.includes("tests/evidence")) {
        const hasMetaDir = content.includes("import.meta.dir") || content.includes("import.meta.url");
        const hasMkdtemp = content.includes("mkdtemp") || content.includes("tmpdir");
        // 允许没有 import.meta.dir 但使用文档引用（字符串中不含路径拼接）
        // 这里只严格要求：如果文件包含 tests/evidence 且没有任何路径派生方式
        // 则标记为违规
        if (!hasMetaDir && !hasMkdtemp) {
          // 再检查是否是纯文档引用（即 tests/evidence 出现在字符串中但没有路径拼接操作）
          // 如果只是注释或文档中的引用，放行
          const lines = content.split("\n");
          let isDocRefOnly = true;
          for (const line of lines) {
            if (line.includes("tests/evidence") && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
              // 如果该行不是纯注释，且有路径操作迹象（join, +, concat, template）
              if (/join|concat|[+`]/.test(line)) {
                isDocRefOnly = false;
                break;
              }
            }
          }
          if (!isDocRefOnly) {
            hardEvidenceFiles.push(f.relPath);
          }
        }
      }
    }

    if (hardEvidenceFiles.length > 0) {
      expect().fail(
        `以下测试文件中的 evidence 路径未从 import.meta.dir 或 mkdtemp 派生:\n  ${hardEvidenceFiles.join("\n  ")}`
      );
    } else {
      // 如果没有违规，fall through
      expect(hardEvidenceFiles).toHaveLength(0);
    }
  });

  it("docs reference commands, not evidence output paths", () => {
    // 检查 docs/testing/TESTING.md 不包含将命令输出管道到 evidence 文件的写法
    const testingMdPath = join(repoRoot, "docs", "testing", "TESTING.md");
    if (!existsSync(testingMdPath)) return; // 文件不存在则跳过

    const content = safeReadFile(testingMdPath);
    if (content === null) return;

    const lines = content.split("\n");
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      // 检测 "> tests/evidence/" 模式 — 管道到 evidence 文件的命令
      if (/>\s*tests\/evidence\//.test(line)) {
        violations.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
      }
      // 检测直接引用 evidence 文件路径的格式（作为命令参数而不是输出重定向）
      // 允许测试命令引用（如 `bun test ... --test-name-pattern`），
      // 但禁止文档作为结果文件引用
    }

    if (violations.length > 0) {
      expect().fail(
        `TESTING.md 中包含管道到 evidence 文件的命令引用:\n  ${violations.join("\n  ")}`
      );
    } else {
      expect(violations).toHaveLength(0);
    }
  });
});
