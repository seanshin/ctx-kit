# ctx-kit

[![npm](https://img.shields.io/npm/v/%40seanshin%2Fctx-kit)](https://www.npmjs.com/package/@seanshin/ctx-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

**AI 코딩 에이전트를 위한 도구 중립 코드베이스 컨텍스트 킷 — 프론티어 모델부터 소형 로컬 LLM까지.**

프로젝트 컨텍스트의 원본은 하나로 두고, 각 모델 계층이 실제로 쓸 수 있는
형태로 제공한다: 에이전트형 도구에는 MCP 서버로, 터미널·CI에는 CLI로, 그 밖의
모든 환경에는 일반 파일로.

English: [README.md](README.md) · 백서: [WHITEPAPER.ko.md](docs/WHITEPAPER.ko.md) · 온보딩: [docs/onboarding.md](docs/onboarding.md)

**목차** — **[사용방법](#사용방법)**: [설치](#설치) · [저장소 준비](#1단계-저장소-준비) · [초안 검증](#2단계-초안-두-개-검증) · [산출물 생성](#3단계-산출물-생성) · [AI 도구 연결](#4단계-ai-도구-연결) · [로컬 모델](#5단계-도구가-없는-모델에-먹이기) · [명령 요약](#명령-요약) · [일상 운용](#일상-운용) — **[배경](#배경)**: [왜](#왜) · [동작 방식](#동작-방식) — **[레퍼런스](#레퍼런스)**: [CLI](#cli-레퍼런스) · [설정](#설정-레퍼런스) · [MCP 도구](#mcp-도구-레퍼런스) · [프로파일](#프로파일-모델-계층별-제공) · [환경별](#환경별-설정) · [로컬 LLM](#소형-로컬-llm-활용) · [여러 저장소](#여러-저장소-전개) · [실측](#실측-결과) · [FAQ](#faq) · [설계 노트](#설계-노트) · [라이선스](#라이선스-태세)

---

# 사용방법

## 설치

Node 20 이상. 패키지에는 `dist/`와 `templates/`만 담긴다(약 21KB).

```sh
npm i -g @seanshin/ctx-kit      # 글로벌 설치 — 실행 파일명은 ctxkit
npx -y @seanshin/ctx-kit <명령> # 설치 없이 바로 실행
npm i -D @seanshin/ctx-kit      # 프로젝트 devDependency로
```

## 1단계: 저장소 준비

```sh
cd your-project
ctxkit init --auto --hooks
```

| 생성물 | 용도 |
|---|---|
| `AGENTS.md` | 규칙 초안. 빌드·테스트 명령은 `package.json`, `pytest.ini`/`pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`에서 **자동 감지** |
| `context.config.yaml` | 모듈 경계(소스 구조에서 자동 감지) + 소비 프로파일 |
| `docs/context/`, `docs/generated/packs/` | 모듈 문서와 생성 산출물이 놓일 자리 |
| `.git/hooks/pre-commit` | (`--hooks`) 커밋 시점에 `ctxkit check` 실행 — CI 없이 무료로 쓰는 게이트 |

기존 `AGENTS.md` / `CLAUDE.md`는 **절대 덮어쓰지 않고** 건너뛴 것으로 보고한다.
GitHub Actions 워크플로도 원하면 `--ci`를 추가한다(비공개 저장소는 Actions
분량을 소모하므로, 같은 게이트를 무료로 쓰는 `--hooks`를 권장).

## 2단계: 초안 두 개 검증

유일한 수동 단계이자 품질을 결정하는 단계다:

1. **`AGENTS.md`** — 감지된 명령이 실제로 도는지 확인하고, 코드가 에이전트에게
   말해줄 수 없는 것을 채운다: 아키텍처 결정, 제약("할인율을 다른 곳에
   인라인하지 말 것", "`legacy/`는 건드리지 말 것"), 도메인 용어집.
   150줄 이하로 유지 — 초과하면 `ctxkit check`가 실패한다. 장황한 규칙 파일은
   실측상 에이전트 성능을 떨어뜨리기 때문이다.
2. **`context.config.yaml`** — 모듈 경계를 팀이 실제로 코드베이스를 사고하는
   단위에 맞추고, 소음 경로(vendored 코드·마이그레이션·픽스처)를 `exclude`에
   추가한다.

## 3단계: 산출물 생성

```sh
ctxkit map                     # → docs/generated/repomap.md
ctxkit pack --profile light    # → docs/generated/packs/all-light.md
ctxkit sync                    # AGENTS.md → CLAUDE.md, .cursorrules, …
ctxkit check                   # 게이트: 규칙·sync·신선도·시크릿
```

## 4단계: AI 도구 연결

에이전트형 도구(Claude Code, Codex CLI, Cursor)는 MCP 서버를 한 번 등록한다:

```json
{ "mcpServers": { "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } } }
```

Claude Code는 `.mcp.json`, Codex CLI는 `config.toml`의 `mcp_servers`.
`AGENTS.md`(및 `sync`가 만든 `CLAUDE.md`)는 설정 없이도 이들 도구가 자동으로
읽는다.

## 5단계: 도구가 없는 모델에 먹이기

```sh
ctxkit pack --profile light --module risk --stdout > /tmp/ctx.md
ollama run qwen3:14b "$(cat /tmp/ctx.md)

위 컨텍스트만 사용해서 답하라: 기본 재시도 간격은?"
```

또는 필요한 섹션만 뽑는 `ctxkit get <질의>`를 쓰거나,
`docs/generated/packs/<모듈>-light.md`를 아무 챗창에나 붙여넣으면 된다.

## 명령 요약

| 명령 | 하는 일 | 산출물 |
|---|---|---|
| `ctxkit init [--auto] [--hooks] [--ci]` | 저장소 스캐폴딩 | `AGENTS.md`, `context.config.yaml`, 디렉토리, 훅 |
| `ctxkit map [-b <토큰>]` | 교차 참조로 파일 랭킹, 심볼 아웃라인 | `docs/generated/repomap.md` |
| `ctxkit pack [-p <프로파일>] [-m <모듈>]` | 토큰 예산 내로 컨텍스트 팩 조립 | `docs/generated/packs/…md` |
| `ctxkit sync [--link] [--force]` | 단일 원본에서 규칙 배포 | `CLAUDE.md`, `.cursorrules`, … |
| `ctxkit check [--max-rule-lines <n>]` | 게이트: 규칙 길이·sync·신선도·시크릿 | exit 0/1 |
| `ctxkit get <질의>` | 해당 컨텍스트 섹션 출력 | stdout |
| `ctxkit serve` | MCP 서버 실행(stdio) | 도구 5종 |

문서를 출력하는 명령은 모두 `--stdout`을 받고, 어느 명령이든 `-C <경로>`로 다른
저장소를 대상으로 실행할 수 있다. 플래그별 상세는 아래
[CLI 레퍼런스](#cli-레퍼런스) 참조.

## 일상 운용

| 시점 | 실행 |
|---|---|
| 코드가 바뀌었을 때 | `ctxkit map` (맵이 오래되면 훅/CI가 경고한다) |
| 규칙이 바뀌었을 때 | `AGENTS.md`를 고치고 `ctxkit sync` — `CLAUDE.md`를 직접 고치지 말 것 |
| 커밋 전 | 할 일 없음: pre-commit 훅이 `ctxkit check`를 돌린다 |
| 약한 모델에게 작업을 넘길 때 | `ctxkit pack --profile light --module <이름>` |
| 다른 저장소 온보딩 | `ctxkit -C /path/to/repo init --auto --hooks` |

10분 온보딩 체크리스트: [docs/onboarding.md](docs/onboarding.md).

---

# 배경

## 왜

AI로 개발되는 저장소는 능력이 크게 다른 모델들이, 종종 같은 날, 함께 소비한다:

| 소비자 | 코드베이스를 읽는 방식 | 필요한 것 |
|---|---|---|
| 프론티어 에이전트 (Claude Code, Codex CLI) | 도구로 탐색, 다중 턴 | 최소 상시 규칙 + 온디맨드 검색 |
| 중형 모델 (32~128K 윈도) | 1회 로드, 제한적 도구 | 규칙 + 구조 맵 |
| 소형 로컬 LLM | 붙여넣은 프롬프트 1회 | 파일 원문이 담긴 사전 재단 팩 |
| 챗창의 사람 | 복사·붙여넣기 | 읽을 수 있는 파일 |

대부분의 컨텍스트 도구는 이 중 하나만 섬긴다. ctx-kit은 원본 하나에서 각
형태를 파생시키며, 아래 실측이 보여주듯 **과제 성패를 가르는 것은 모델 등급이
아니라 컨텍스트 형태**다.

설계를 규정한 두 가지 제약이 더 있다:

- **장황한 규칙 파일은 실제로 해롭다.** 138개 저장소 대상 공개 평가에서 LLM이
  생성한 에이전트 지침 파일은 과제 성공률을 *낮추면서* 추론 비용을 20% 이상
  올렸다. 그래서 `AGENTS.md`는 게이트가 150줄로 제한하고, `init --auto`는
  저장소 자신의 manifest에서 읽어낼 수 있는 사실만 채운다.
- **벤더 종속 회피.** [AGENTS.md](https://agents.md)(Linux Foundation 이관;
  Claude Code·Codex CLI·Cursor·Aider·Copilot·Gemini CLI·Windsurf가 네이티브
  지원)와 MCP가 중립 설계를 현실화했다.

## 동작 방식

**컨텍스트 4계층** — 비용과 신선도 순:

| 계층 | 내용 | 생산 | 갱신 |
|---|---|---|---|
| 0 | `AGENTS.md` — 명령·제약·용어집 (150줄 이하) | 사람 | 변경 시 |
| 1 | 리포맵 — 교차 참조로 랭킹된 파일 + 심볼 아웃라인 | `ctxkit map` | 커밋/CI |
| 2 | `docs/context/<모듈>.md` + 모듈별 팩 | 사람 + `ctxkit pack` | 필요 시 |
| 3 | 심볼 검색 (정의 + 참조 지점) | `ctxkit serve` | 실시간 |

**코어 하나 위의 인터페이스 3중** — 똑똑한 것부터 단순한 것까지:

```
┌──────────────────────────────────────────────────────────┐
│ A. MCP 서버   ctxkit serve      → 에이전트형 도구         │
├──────────────────────────────────────────────────────────┤
│ B. CLI        ctxkit <명령>     → 터미널·훅·CI            │
├──────────────────────────────────────────────────────────┤
│ C. 파일       docs/generated/   → 그 외 전부              │
└──────────────────────────────────────────────────────────┘
```

C는 곁가지가 아니라 바닥이다. 모든 기능은 반드시 일반 파일 산출물을 남기므로,
MCP도 CLI도 없는 환경(챗창에 붙여넣는 사람 포함)까지 항상 지원된다.

---

# 레퍼런스

## CLI 레퍼런스

전역: `-C, --dir <경로>`로 다른 저장소 대상 실행(기본 `.`), `--version`, `--help`.

### `ctxkit init [--auto] [--hooks] [--ci]`

`context.config.yaml`, `AGENTS.md`, `docs/context/`, `docs/generated/packs/`를
스캐폴딩한다. 기존 파일은 건너뛰며 덮어쓰지 않는다.

| 플래그 | 효과 |
|---|---|
| `--auto` | manifest에서 명령·모듈 경계를 감지해 두 초안을 채움 |
| `--hooks` | `ctxkit check`를 돌리는 `.git/hooks/pre-commit` 설치 (로컬·무료; 기존 훅 있으면 건너뜀) |
| `--ci` | `.github/workflows/ctxkit.yml` 설치 (비공개 저장소는 Actions 분량 소모 — `--hooks` 권장) |

### `ctxkit map [-b <토큰>] [--stdout]`

랭킹된 리포맵을 `docs/generated/repomap.md`에 쓴다(기본 예산 8000토큰). 랭킹:
각 파일이 정의한 심볼이 다른 파일에서 참조된 횟수 + 상한 있는 자체 가중치.
테스트 파일은 ×0.2로 강등해 프로덕션 코드가 먼저 오게 한다. 예산을 넘긴 파일은
생략 개수로 표기된다.

### `ctxkit pack [-p <프로파일>] [-m <모듈>] [--repomix] [--stdout]`

`docs/generated/packs/<모듈|all>-<프로파일>.md`에 컨텍스트 팩을 조립하고 근사
토큰 수를 출력한다. 섹션은 프로파일의 `inject` 순서를 따른다. 규모가 커져도
팩이 쓸모를 유지하게 하는 예산 규칙 셋:

- 내장 맵은 팩 예산의 ⅓(최대 4000)로 제한되어 파일 원문 자리를 굶길 수 없다.
- `--module` 사용 시 내장 맵도 **해당 모듈 범위로 좁혀지고**, 모듈 밖에서 가장
  많이 참조되는 파일들의 경로 색인이 덧붙는다. 실측된 트레이드오프: 모듈 팩은
  *모듈 밖 심볼이 어디 정의됐는지* 답할 수 없다(색인은 경로만 담고 개요는 담지
  않는다) — 그런 질문은 `search_symbol`로 보내거나 `--module`을 빼면 된다.
  대신 모듈 자신의 파일이 예산을 갖는다: 실전 모듈에서 무관한 파일 4개가 맵에서
  빠지고 포함된 소스가 4개 → 13개가 됐다.
- 대상 파일은 참조 랭킹 순으로 배치되며, 예산에 안 들어가는 큰 파일은 섹션을
  끝내지 않고 건너뛴다 — 랭킹 중간의 큰 파일 하나가 뒤에 있는 더 작고 여전히
  유효한 파일들의 예산까지 날려서는 안 되기 때문이다. 건너뛴 파일은 개수로
  보고된다.

`--repomix`는
설치돼 있으면 외부 [Repomix](https://github.com/yamadashy/repomix) CLI에
위임하고, 실패 시 내부 패커로 폴백한다.

### `ctxkit sync [--link] [--force]`

`AGENTS.md`를 도구별 규칙 파일로 배포한다. 대상은 `sync.targets`에서 온다:

| 대상 | 파일 |
|---|---|
| `claude` | `CLAUDE.md` |
| `cursor` | `.cursorrules` |
| `gemini` | `GEMINI.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `windsurf` | `.windsurfrules` |

생성 사본에는 `<!-- generated by ctxkit sync … -->` 헤더가 붙는다. ctx-kit이
만들지 않은 파일은 `skipped-foreign`으로 보고하고 exit 1 — 내용을 `AGENTS.md`로
병합하거나 `--force`를 쓴다. `--link`는 사본 대신 심링크를 만든다.

### `ctxkit check [--max-rule-lines <n>]`

게이트. 하나라도 실패하면 exit 1.

| 검사 | 수준 | 잡아내는 것 |
|---|---|---|
| `agents-length` | fail | `AGENTS.md` 없음, 또는 150줄 초과 |
| `sync` | fail / warn | 도구별 파일이 `AGENTS.md`와 다름(stale) / 아직 생성 안 됨 |
| `repomap` | warn | 소스가 `repomap.md`보다 최신 (mtime 휴리스틱) |
| `secrets` | fail | 규칙·모듈 문서·생성 팩의 개인키 블록, `AKIA…` 키, `ghp_…` 토큰, `api_key = "…"` 형태 대입 |

시크릿 스캔은 정확히 외부 서비스에 붙여넣어지는 파일들을 대상으로 한다. 리포맵
신선도가 경고인 이유는 git 체크아웃이 mtime을 보존하지 않기 때문이다.

### `ctxkit get <질의> [-b <토큰>] [-k <n>]`

질의에 맞는 컨텍스트 섹션을 stdout에 출력한다 — `AGENTS.md`,
`docs/context/*.md`, 리포맵을 `##` 제목 단위로 나눠 랭킹한다(제목 일치 5배
가중). 파이프용으로 설계됐다:

```sh
ctxkit get billing | llm -m local-model "세금 계산은 어디서 하나?"
ctxkit get auth --budget 2000 | pbcopy
```

### `ctxkit serve`

MCP 서버를 stdio로 실행한다. 프로토콜은 stdout, 로그는 stderr.

---

## 설정 레퍼런스

`context.config.yaml`은 대상 저장소에 남는 유일한 ctx-kit 파일이다 — 로직은
전부 패키지 안에 있다.

```yaml
version: 1                     # 스키마 버전; 불일치는 거부

modules:                       # 2계층 경계: 이름 → 글롭(저장소 상대)
  risk:    ["src/risk/**"]
  web:     ["web/src/**"]

exclude:                       # 내장 제외에 더할 항목
  - "**/generated/**"

profiles:                      # 모델 계층별 제공 내용
  frontier: { inject: [agents], budget: 4000 }
  mid:      { inject: [agents, repomap], budget: 24000 }
  light:    { inject: [agents-summary, repomap, target-files], budget: 12000 }
  light-xl: { inject: [agents-summary, repomap, target-files], budget: 45000 }

sync:
  targets: [claude, cursor]    # 위 sync 표 참조
```

**`inject` 섹션**

| 섹션 | 내용 |
|---|---|
| `agents` | `AGENTS.md` 전문 |
| `agents-summary` | 앞 40줄 + 팩 *끝*에 붙는 12줄 리마인더 |
| `repomap` | 랭킹된 맵 (신선하고 상한 내면 캐시, 아니면 재생성) |
| `target-files` | 파일 원문, 참조 랭킹 순, 예산에서 잘림 |

`agents-summary` + 꼬리 리마인더 구조는 모델이 긴 프롬프트의 중간보다 앞뒤를
훨씬 잘 기억하기 때문이다.

**항상 제외**(설정 불필요): dot 항목(`.git`, `.venv`, `.next` …),
`node_modules`, `dist`, `build`, `out`, `target`, `vendor`, `__pycache__`,
`venv`, `.cache`, `coverage`, 512KiB 초과 파일, 바이너리.

**심볼 추출 지원 언어**: TypeScript/TSX, JavaScript/JSX, Python, Go, Rust,
Java, Kotlin, C#, Ruby, PHP, Swift, C/C++.

토큰 수는 `문자수/4` 근사다 — 예산 판단에는 충분하며, 같은 인터페이스 뒤로 실제
토크나이저로 교체할 수 있다. 다만 **CJK 텍스트는 과소평가한다**(한글·일문·중문
주석은 실제로 글자당 1토큰에 가깝다). CJK 비중이 큰 코드베이스는 여유를 두거나
예산을 낮춰 잡을 것.

## MCP 도구 레퍼런스

```json
{ "mcpServers": { "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } } }
```

| 도구 | 파라미터 | 반환 |
|---|---|---|
| `get_rules` | — | `AGENTS.md` |
| `get_repomap` | `budget?` (500~50000) | 심볼 아웃라인이 붙은 랭킹 맵 |
| `get_module_context` | `module`, `profile?` | `docs/context/<모듈>.md` + 해당 모듈 팩 |
| `search_symbol` | `name`, `include_references?` | 정의 위치(정확→부분 일치) + 참조 라인 최대 30개 |
| `make_pack` | `profile?`, `module?` | 팩 파일을 쓰고 경로·토큰 수 반환 |

`make_pack`이 핸드오프 도구다 — 프론티어 에이전트가 세션을 떠나지 않고 더 약한
모델을 위한 컨텍스트를 준비할 수 있다. `search_symbol`은 아웃라인 기반이며,
LSP급 분석이 필요하면 [Serena](https://github.com/oraios/serena)를 ctx-kit과
*나란히* 등록한다 — 도구 설명이 에이전트에게 그렇게 하라고 알린다.

## 프로파일: 모델 계층별 제공

| 프로파일 | 주입 | 대표 예산 | 대상 |
|---|---|---|---|
| `frontier` | 규칙만 | 4K | MCP로 탐색하는 도구형 에이전트 |
| `mid` | 규칙 + 맵 | 24K | 중형 모델, 구조 질문 |
| `light` | 규칙 요약 + 맵 + 랭킹된 파일 원문 + 리마인더 | 12K | 소형 로컬 LLM, 1회 프롬프트 |
| `light-xl` | `light`와 동일 | 45K | 모듈 전체가 필요한 128K급 로컬 모델 |

실측에서 나온 경험칙: **구조 질문**("X는 어디 정의됐나?")은 맵만으로 훨씬 적은
토큰에 해결된다. **구현 세부 질문**("이 기본값은?")은 *모든* 모델 계층에서 파일
원문을 요구한다. **호출 관계 질문**은 맵이 아니라 `search_symbol`로 보내야
한다 — [eval/findings.md](eval/findings.md)의 주의사항 참조.

---

## 환경별 설정

| 환경 | 설정 |
|---|---|
| **Claude Code** | `.mcp.json`에 위 스니펫; `AGENTS.md`는 네이티브 인식; `ctxkit init --hooks`로 커밋 게이트 |
| **Codex CLI** | `config.toml`의 `mcp_servers`에 동일 서버 |
| **Cursor / Windsurf** | MCP 설정 + `ctxkit sync`가 `.cursorrules` / `.windsurfrules` 생성 |
| **aider** | 파일 인터페이스: `aider --read docs/generated/repomap.md` |
| **로컬 에이전트 (OpenCode, Ollama 기반)** | 도구 사용 가능하면 MCP, 아니면 `ctxkit pack --profile light --stdout` 파이프 |
| **챗창 (도구 없음)** | `docs/generated/packs/<모듈>-light.md` 붙여넣기 |
| **CI** | `npx -y @seanshin/ctx-kit map && npx -y @seanshin/ctx-kit check` |
| **아무 저장소, 설치 없이** | `ctxkit -C /path/to/repo <명령>` |

## 소형 로컬 LLM 활용

```sh
ctxkit pack --profile light --module risk --stdout > /tmp/ctx.md
ollama run qwen3:14b "$(cat /tmp/ctx.md)

위 컨텍스트만 사용해서 답하라: 기본 재시도 간격은?"
```

팩이 대신 해주는 세 가지: 규칙을 앞에 놓고 끝에 반복하고, 파일 원문을 참조 랭킹
순으로 배치해 잘림이 가장 덜 중요한 파일에 떨어지게 하며, 내장 맵을 제한해
정작 필요한 소스를 밀어내지 못하게 한다. Ollama 쪽 `num_ctx`는 팩이 보고한 토큰
수 이상으로 설정한다.

같은 하네스로 자기 저장소를 측정할 수 있다:

```sh
node eval/run.mjs --fixture /path/to/repo --tasks my-tasks.yaml \
  --module risk --custom "qwen=ollama run qwen3:14b" --out results.md
```

과제는 3필드 YAML(`id`, `question`, `expect` 키워드)이며, 모델 프로세스는 빈
임시 디렉토리에서 실행돼 저장소를 읽어 우회할 수 없다.

## 여러 저장소 전개

대상 저장소에는 `context.config.yaml`과 생성 산출물만 남고 로직은 전부 패키지
안에 있으므로, 전체 업그레이드는 `npm i -g @seanshin/ctx-kit@latest` 한 번이다.

```sh
for repo in ~/src/*/; do ctxkit -C "$repo" init --auto --hooks; done
```

이미 손으로 쓴 `CLAUDE.md`가 있는 저장소 이관: 내용을 `AGENTS.md`로 옮긴 뒤
`ctxkit sync --force` (그냥 `sync`는 자기가 만들지 않은 파일을 건드리지 않는다).

---

## 실측 결과

과제 3개 × 프로파일 2종 × 모델 2계층을 합성 픽스처와 소스 308개 실전 저장소에서
실행했다. 전체 데이터와 방법론: [eval/findings.md](eval/findings.md).

| | 소형 모델 | 상위 모델 |
|---|---|---|
| `mid` (규칙 + 맵) | 2/3 | 2/3 |
| `light` (+ 랭킹된 파일 원문) | **3/3** | **3/3** |

구현 세부 과제는 파일 원문이 없으면 **두 계층 모두** 실패했고 있으면 **두 계층
모두** 통과했다 — 결과를 정한 것은 컨텍스트 프로파일이지 모델이 아니다. 두 모델
모두 환각 대신 "컨텍스트에 없다"고 답했다.

별도로, 같은 저장소에서 파일 읽기 도구를 차단하고 ctx-kit MCP만 준 실사용
에이전트 세션은 세 질문 모두를 **4턴 9.3초**에 정확히 답했다 — `get_rules`와
`search_symbol` 한 번뿐. 어떤 팩보다 적은 토큰으로 `frontier` 프로파일이 설계
그대로 작동한 것이다.

그 실전 온보딩은 합성 픽스처가 숨겼던 결함 3건도 잡아냈다(테스트 파일의 랭킹
독점, 캐시된 맵이 파일 섹션을 굶긴 것, 알파벳 잘림이 엉뚱한 파일을 버린 것).
전부 수정됐고 테스트로 고정됐다.

## FAQ

**`AGENTS.md`를 대체하나?** 아니다 — 그 위에 세워졌다. ctx-kit은 `AGENTS.md`를
단일 원본으로 두고 도구별 변형을 생성한다.

**내 `CLAUDE.md`를 덮어쓰나?** `--force` 없이는 절대. ctx-kit이 만들지 않은
파일은 보고하고 건너뛴다.

**GitHub Actions가 필요한가?** 아니다. `ctxkit init --hooks`가 같은 게이트를
커밋 시점에 로컬에서 무료로 돌린다. 워크플로는 선택 사항이며 명시돼 있다.

**왜 tree-sitter가 아닌가?** 심볼 추출기는 tree-sitter 어댑터로 교체 가능한
인터페이스 뒤에 있다. 정규식 아웃라인은 패키지를 가볍게 유지하고 오프라인에서
동작한다. 의미론 수준 분석은 Serena의 몫이다.

**어딘가로 전송되나?** 아니다. 전부 로컬에서 돌고 네트워크 호출이 없다.

**리포맵이 내 구조에 안 맞는다.** 소음 경로를 `exclude`에 넣고 `ctxkit map`을
다시 돌린다. 보통 vendored 코드·마이그레이션·픽스처가 원인이다.

## 설계 노트

- **어댑터 경계 = 라이선스 경계.** 외부 도구는 CLI로 실행할 뿐 벤더링하지
  않으므로, Repomix를 code2prompt로 바꾸는 것은 파일 한 개 교체이고 MIT 태세는
  기계적으로 유지된다.
- **축소 가능 코어.** 외부 도구가 하나도 없어도 전부 동작한다 — 오프라인·폐쇄망
  환경에 중요하다.
- **계약으로서의 파일.** 모든 명령이 파일을 남기므로 가장 약한 환경도 항상
  지원되고, CI가 산출물을 diff할 수 있다.

프로젝트 구조:

```
src/core/      config, fs walk, tokens, repomap, pack, sync, check, get, detect
src/adapters/  symbols(자체), repomix(CLI 래퍼), ruler/serena(주석)
src/cli.ts     인터페이스 B      src/mcp.ts   인터페이스 A
templates/     init 스캐폴드, pre-commit 훅, CI 워크플로
eval/          측정 하네스, 픽스처, 과제, 결론
test/          node --test 스위트
```

## 개발

```sh
npm install
npm test        # 빌드 후 node --test 스위트(10건) 실행
npm run build   # tsc만
```

테스트 범위: 설정 기본값·스키마 거부, 제외 규칙, 심볼 추출, 랭킹과 테스트 강등,
팩 예산·모듈 필터, sync의 외부 파일 보호·stale 감지, 시크릿 스캔, 자동 감지,
질의 검색.

## 라이선스 태세

MIT. 외부 도구는 **코드 차용 없이 CLI 실행으로만** 통합한다:
[Repomix](https://github.com/yamadashy/repomix)(MIT, 선택적 패커),
[Serena](https://github.com/oraios/serena)(MIT, LSP급 검색 — 래핑하지 않고
나란히 등록). 리포맵 랭킹은 [aider](https://aider.chat/docs/repomap.html)의
tree-sitter+PageRank 접근에서 영감을 받은 독립 구현이다(Apache-2.0 — 알고리즘
참고만). universal-ctags 같은 GPL 도구는 의도적으로 제외했다.

## 문서

- [백서](docs/WHITEPAPER.ko.md) · [Whitepaper](docs/WHITEPAPER.md) — 설계·알고리즘·측정
- [온보딩 플레이북](docs/onboarding.md) — 10분 체크리스트
- [**기획 v2**](docs/plan-v2.md) — 과제 형태의 컨텍스트: `--about`, `--diff`, 규칙 부패 탐지, 공변경 랭킹, `ctxkit eval`
- [컨텍스트 체계 기획](docs/ai-context-plan.md) · [패키지 아키텍처](docs/package-architecture.md) — v1, 실행 결과 기록 포함
- [측정 결론](eval/findings.md)

MIT © 2026 Hyounmouk Shin
