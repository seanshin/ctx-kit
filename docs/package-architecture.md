# 패키지 아키텍처 기획 — `ctxkit` (가칭)

> `docs/ai-context-plan.md`의 4계층 컨텍스트 체계를 **배포 가능한 패키지**로 만들어,
> 각 개발환경(Claude Code, Codex CLI, Cursor, 로컬 LLM 에이전트, CI, 타 저장소)에서
> 호출 가능한 구조를 정의한다.

---

## 1. 배포 형태

**npm 패키지 단일 배포**를 기본으로 한다.

- 이유: `npx ctxkit@latest <cmd>` 로 **설치 없이 호출** 가능 — "각 개발환경에서 호출 가능"이라는 요구를 가장 싸게 충족한다. 의존 도구인 Repomix·Ruler도 npm 생태계라 통합 비용이 낮다.
- Serena(Python)는 패키지에 내장하지 않고 `ctxkit serve` 가 `uvx serena ...` 를 감싸 실행하는 **런처**로 통합한다. 미설치 시 안내만 출력.
- Node 20+ 단일 런타임 요구. Python/pip 배포는 수요 확인 후 2차(P5)로 미룬다.

버전 정책: 산출물 포맷(리포맵, 팩)에 스키마 버전을 새겨 넣어(`<!-- ctxkit:v1 -->`), 소비 측이 버전 불일치를 감지할 수 있게 한다.

---

## 2. 호출 인터페이스 — 3중 구조

같은 코어 로직을 세 가지 방식으로 노출한다. **환경이 똑똑할수록 위쪽, 단순할수록 아래쪽 인터페이스를 쓴다.**

```
┌─────────────────────────────────────────────────────┐
│  A. MCP 서버        ctxkit serve                     │  에이전트가 직접 도구 호출
├─────────────────────────────────────────────────────┤
│  B. CLI             npx ctxkit <cmd>                 │  터미널·훅·CI·스크립트
├─────────────────────────────────────────────────────┤
│  C. 파일 산출물      docs/generated/*.md             │  아무 환경이나 파일만 읽으면 됨
└─────────────────────────────────────────────────────┘
```

- **C(파일)가 최종 안전망**: MCP도 CLI도 못 쓰는 환경(웹 챗에 복붙, 소형 로컬 LLM 프롬프트 조립)은 생성된 파일을 읽기만 하면 된다. 따라서 모든 기능은 반드시 파일 산출물을 남기는 것을 1차 계약으로 한다.
- A와 B는 C를 만드는 수단이자, 실시간 질의(심볼 검색 등) 수단이다.

---

## 3. CLI 명령 설계

```
npx ctxkit init                  # 대상 저장소 스캐폴딩: context.config.yaml + AGENTS.md 템플릿 생성
npx ctxkit sync                  # AGENTS.md → CLAUDE.md/.cursorrules/... 배포 (Ruler 래핑)
npx ctxkit map                   # Tier 1 리포맵 생성 → docs/generated/repomap.md
npx ctxkit pack [--profile p] [--module m]
                                 # 프로파일별 컨텍스트 팩 생성 (Repomix 래핑)
                                 # → docs/generated/packs/<module>-<profile>.md
npx ctxkit get <질의>            # 팩/맵에서 관련 부분만 stdout 출력 (파이프 연결용)
npx ctxkit serve                 # MCP 서버 기동 (stdio) — 아래 4절
npx ctxkit check                 # AGENTS.md 줄 수 초과·시크릿 포함·산출물 스테일 여부 검사 (CI 게이트)
```

- 모든 명령은 대상 저장소 루트의 `context.config.yaml`을 읽는다. 없으면 `init` 안내.
- `--repo <path|git-url>` 옵션으로 **다른 저장소를 원격 대상**으로 실행 가능(중앙에서 여러 repo의 팩 일괄 생성).
- 출력은 기본 파일, `--stdout` 시 표준출력 — 셸 파이프로 어떤 도구에든 연결된다.

### context.config.yaml (대상 저장소에 남는 유일한 설정)

```yaml
version: 1
modules:                  # Tier 2 모듈 경계
  auth: ["src/auth/**"]
  billing: ["src/billing/**"]
profiles:
  frontier: { inject: [agents], budget: 4000 }
  mid:      { inject: [agents, repomap], budget: 24000 }
  light:    { inject: [agents-summary, repomap, target-files], budget: 12000 }
sync:
  targets: [claude, cursor, gemini, copilot]   # Ruler 배포 대상
```

---

## 4. MCP 서버 (`ctxkit serve`)

에이전트형 환경(Claude Code, Codex CLI, Cursor 등)이 도구로 직접 호출하는 인터페이스. stdio 전송 기본.

노출 도구(초기 5개, 최소주의):

| 도구 | 기능 | 대응 계층 |
|---|---|---|
| `get_rules` | AGENTS.md(+하위 디렉토리 규칙) 반환 | Tier 0 |
| `get_repomap` | 리포맵 반환, `budget` 토큰 예산 파라미터 | Tier 1 |
| `get_module_context` | 모듈 문서 + 해당 모듈 팩 반환 | Tier 2 |
| `search_symbol` | 심볼 검색/참조 추적 — Serena 위임, 미설치 시 tree-sitter 폴백(정의 위치만) | Tier 3 |
| `make_pack` | 지정 범위·프로파일로 팩 생성 후 경로 반환 | 팩 |

등록 예 (모든 MCP 클라이언트 공통 패턴):

```jsonc
// .mcp.json / mcp_servers 설정
{ "ctxkit": { "command": "npx", "args": ["-y", "ctxkit", "serve"] } }
```

---

## 5. 개발환경별 호출 매트릭스

| 환경 | 호출 방식 | 설정 |
|---|---|---|
| **Claude Code** | MCP(`serve`) + `AGENTS.md` 자동 인식. 훅으로 `ctxkit check`를 커밋 전 실행 가능 | `.mcp.json`에 위 등록 |
| **Codex CLI** | MCP + `AGENTS.md` | `config.toml`의 mcp_servers |
| **Cursor / Windsurf 등** | MCP + `sync`가 생성한 .cursorrules 등 | 각 도구 MCP 설정 |
| **aider** | 파일 인터페이스: `--read docs/generated/repomap.md` | 없음 |
| **로컬 에이전트 (OpenCode, Ollama 기반)** | 도구 사용 가능하면 MCP, 아니면 `ctxkit pack --profile light` 산출물을 프롬프트에 포함 | 런처 스크립트에서 CLI 호출 |
| **소형 로컬 LLM (직접 프롬프트 조립)** | `ctxkit get ... --stdout \| llm ...` 파이프, 또는 팩 파일 복붙 | 없음 |
| **CI (GitHub Actions 등)** | `npx ctxkit map && npx ctxkit check` — 산출물 재생성·스테일 검사 | 워크플로 1스텝 |
| **타 저장소** | `npx ctxkit init` 스캐폴딩만으로 온보딩 — 로직은 전부 패키지 안, 저장소엔 config+산출물만 | package.json devDependency(선택) |

---

## 6. 패키지 내부 구조

```
ctxkit/
├── package.json            # bin: ctxkit
├── src/
│   ├── core/               # 도구 비의존 코어 (설정 로드, 토큰 예산, 팩 조립)
│   ├── adapters/           # 외부 도구 어댑터 — 전부 교체 가능
│   │   ├── repomix.ts      #   팩 생성 (MIT)
│   │   ├── ruler.ts        #   규칙 배포 (라이선스 재확인)
│   │   ├── treesitter.ts   #   리포맵용 심볼 추출 (자체 구현, aider 알고리즘 참고만)
│   │   └── serena.ts       #   uvx 런처 + 폴백
│   ├── cli.ts              # 3-B
│   └── mcp.ts              # 3-A (공식 MCP SDK 사용)
└── templates/              # init용: AGENTS.md, context.config.yaml, CI 워크플로
```

- **어댑터 패턴이 라이선스 방어선**: 외부 도구는 코드 차용 없이 CLI 실행으로만 호출 → MIT 정책 유지가 쉽고, 도구 교체(예: Repomix→code2prompt)가 어댑터 1파일 교체로 끝난다.
- 코어는 외부 도구 없이도 동작(축소 기능) — 오프라인/폐쇄망 환경 대비.

---

## 7. 로드맵 반영 (ai-context-plan.md P1~P3 구체화)

1. **P1a**: `init`/`map`/`pack` + 코어/어댑터 골격. 파일 인터페이스(C) 완성이 최우선.
2. **P1b**: `sync`/`check` + CI 템플릿.
3. **P2**: `serve` MCP 서버 + Claude Code/Codex/로컬 에이전트 3개 환경에서 호출 검증.
4. **P3**: npm 배포 + 실제 개발 중인 타 저장소 2곳에 `init` 온보딩, 피드백으로 config 스키마 고정(v1).
