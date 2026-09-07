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

**구현 상태: v0.2.1 기준 아래 7종 전부 구현 완료.** 괄호 안은 계획과 달라진 점.

```
ctxkit init [--auto] [--hooks] [--ci]   # 스캐폴딩 (+manifest에서 명령·모듈 자동 감지,
                                        #  pre-commit 훅, CI 워크플로)
ctxkit sync [--link] [--force]          # AGENTS.md → CLAUDE.md/.cursorrules/... 배포
                                        #  (Ruler 래핑이 아니라 무의존 내부 구현)
ctxkit map [-b <tokens>]                # Tier 1 리포맵 → docs/generated/repomap.md
ctxkit pack [-p <profile>] [-m <module>] [--repomix]
                                        # 프로파일별 팩 (내부 패커 기본, Repomix는 선택)
                                        # → docs/generated/packs/<module>-<profile>.md
ctxkit get <질의> [-b] [-k]             # 규칙·모듈 문서·맵에서 관련 섹션만 stdout
ctxkit check [--max-rule-lines]         # 게이트: 규칙 길이·sync 신선도·맵 스테일·시크릿
ctxkit serve                            # MCP 서버 기동 (stdio) — 아래 4절
```

- 모든 명령은 대상 저장소 루트의 `context.config.yaml`을 읽는다. 없으면 `init` 안내.
- 다른 저장소 대상 실행은 계획의 `--repo` 대신 **전역 `-C, --dir <path>`** 로 구현했다
  (모든 명령에 일관 적용). 원격 git URL 대상 실행은 미구현 — 필요하면 클론 후 `-C`.
- 문서를 출력하는 명령은 `--stdout`을 받는다 — 셸 파이프로 어떤 도구에든 연결된다.

**v2 계획**: `pack --about <질의>` / `pack --diff <범위>`, `check`의 규칙 부패 탐지,
`ctxkit eval` — 상세는 [plan-v2.md](plan-v2.md).

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
| `search_symbol` | 심볼 검색/참조 추적 — **자체 아웃라인 구현**(정의+참조 30건). Serena는 위임 대상이 아니라 나란히 등록하는 별도 서버로 확정 | Tier 3 |
| `make_pack` | 지정 범위·프로파일로 팩 생성 후 경로 반환 | 팩 |

등록 예 (모든 MCP 클라이언트 공통 패턴):

```jsonc
// .mcp.json / mcp_servers 설정
{ "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } }
```

도구 5종은 **v2에서도 개수를 늘리지 않고 파라미터만 넓힌다**(`make_pack`·
`get_module_context`에 `about`/`diff` 추가). 에이전트에게 선택지를 늘리는 것 자체가
비용이기 때문이다.

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

## 7. 로드맵 (ai-context-plan.md P1~P3 구체화) — 결과

1. **P1a** ✅ `init`/`map`/`pack` + 코어/어댑터 골격. 파일 인터페이스(C) 우선 완성.
2. **P1b** ✅ `sync`/`check`/`get` + CI 템플릿 + pre-commit 훅(무료 게이트).
3. **P2** ✅ `serve` MCP 서버 5종 도구. 실사용 에이전트 세션에서 3/3 정답(4턴 9.3초).
4. **P3** ✅ npm 공개 배포(`@seanshin/ctx-kit`) + 실전 저장소 1곳 온보딩 + 자체 적용.
   config 스키마 v1 고정. 2호 온보딩(대형 수작업 규칙 파일 이관)은 대상 저장소 대기.

품질 보강(0.2.x): 테스트 19건(코어 12 + MCP 통합 7), 버전 단일 출처화,
`init --auto` 자동 감지, 온보딩 플레이북, 백서 EN/KO, GitHub 공개 + CI(Node 20/22).

**다음 버전 설계는 [plan-v2.md](plan-v2.md)** — 과제 형태의 컨텍스트로 확장한다.
