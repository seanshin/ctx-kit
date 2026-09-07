/**
 * Symbol extraction adapter.
 *
 * P1a ships a dependency-free, regex-based extractor (reduced-capability
 * core). A tree-sitter based adapter can replace `extractSymbols` later
 * behind the same interface without touching the repomap builder.
 */
import { extname } from "node:path";

export interface CodeSymbol {
  kind: string;
  name: string;
  signature: string;
  line: number;
}

export const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".cs",
  ".rb", ".php", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp",
]);

interface Rule {
  re: RegExp;
  kind: string;
}

const JS_RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\)?)/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "function" },
];

const PY_RULES: Rule[] = [
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*(\([^)]*\)?)/, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
];

const GO_RULES: Rule[] = [
  { re: /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)\s*(\([^)]*\)?)/, kind: "func" },
  { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: "type" },
];

const RS_RULES: Rule[] = [
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(\([^)]*\)?)/, kind: "fn" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, kind: "type" },
];

const JVM_RULES: Rule[] = [
  { re: /^\s*(?:public|private|protected|internal)?\s*(?:abstract\s+|final\s+|sealed\s+|static\s+)*(?:class|interface|enum|record|object)\s+([A-Za-z_]\w*)/, kind: "class" },
];

const RB_RULES: Rule[] = [
  { re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, kind: "method" },
  { re: /^\s*(?:class|module)\s+([A-Z]\w*)/, kind: "class" },
];

const C_RULES: Rule[] = [
  { re: /^[A-Za-z_][\w\s*]*\s\**([A-Za-z_]\w*)\s*(\([^;{)]*\)?)\s*\{?\s*$/, kind: "function" },
  { re: /^\s*(?:typedef\s+)?(?:struct|enum|union)\s+([A-Za-z_]\w*)/, kind: "type" },
];

const RULES_BY_EXT: Record<string, Rule[]> = {
  ".ts": JS_RULES, ".tsx": JS_RULES, ".js": JS_RULES, ".jsx": JS_RULES,
  ".mjs": JS_RULES, ".cjs": JS_RULES,
  ".py": PY_RULES,
  ".go": GO_RULES,
  ".rs": RS_RULES,
  ".java": JVM_RULES, ".kt": JVM_RULES, ".cs": JVM_RULES, ".swift": JVM_RULES,
  ".rb": RB_RULES,
  ".php": PY_RULES,
  ".c": C_RULES, ".h": C_RULES, ".cc": C_RULES, ".cpp": C_RULES, ".hpp": C_RULES,
};

const MAX_SYMBOLS_PER_FILE = 50;

export function extractSymbols(relPath: string, content: string): CodeSymbol[] {
  const rules = RULES_BY_EXT[extname(relPath)];
  if (!rules) return [];
  const symbols: CodeSymbol[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS_PER_FILE; i++) {
    const line = lines[i];
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (m) {
        symbols.push({
          kind: rule.kind,
          name: m[1],
          signature: (m[2] ?? "").trim(),
          line: i + 1,
        });
        break;
      }
    }
  }
  return symbols;
}
