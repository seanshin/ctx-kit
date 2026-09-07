# ctx-kit

AI로 개발되는 소스 저장소를 관리하고, 고성능(Claude/Codex)부터 저성능(로컬 LLM)까지
다양한 AI가 사용될 때의 규칙(rule)과 형태(form)를 관리하는 도구 중립적 컨텍스트 킷.

- 기획: [docs/ai-context-plan.md](docs/ai-context-plan.md) · 패키지 설계: [docs/package-architecture.md](docs/package-architecture.md)
- 호출 인터페이스 3중 구조: **MCP 서버**(P2) / **CLI** / **파일 산출물**(`docs/generated/`)
- 라이선스: MIT. 외부 도구(Repomix, Ruler, Serena)는 코드 차용 없이 CLI 실행으로만 래핑.

## 사용

npm 배포됨: **`@seanshin/ctx-kit`** (공개, 무료 — `ctx-kit`은 기존 `ctxkit`과의 유사명 정책으로 불가, 실행 파일명은 `ctxkit`):

```sh
npm i -g @seanshin/ctx-kit             # 어느 머신·저장소에서든
ctxkit init --auto                     # 새 프로젝트 온보딩: docs/onboarding.md 참고
npx -y @seanshin/ctx-kit check         # 설치 없이 일회 실행
```

개발 중 실행:

```sh
npm install && npm test          # 빌드 + 테스트 스위트(node --test)

node dist/cli.js init            # 대상 저장소에 context.config.yaml + AGENTS.md 스캐폴딩
node dist/cli.js init --auto     # 빌드·테스트 명령과 모듈 경계를 자동 감지해 초안 생성
node dist/cli.js map             # Tier 1 리포맵 -> docs/generated/repomap.md
node dist/cli.js pack --profile light --module auth
                                 # 프로파일별 컨텍스트 팩 -> docs/generated/packs/
node dist/cli.js pack --stdout | pbcopy   # 파이프/복붙용

node dist/cli.js sync            # AGENTS.md -> CLAUDE.md, .cursorrules 등 배포 (--link 심링크)
node dist/cli.js check           # CI 게이트: 규칙 길이·sync 신선도·리포맵 스테일·시크릿 검사
node dist/cli.js get auth        # 질의에 맞는 컨텍스트 섹션만 stdout 출력
node dist/cli.js init --hooks    # git pre-commit 훅으로 check 실행 (로컬·무료, 권장)
node dist/cli.js init --ci       # GitHub Actions 워크플로 설치 — 비공개 저장소는 Actions
                                 # 분량(유료 기능)을 소모하므로 필요할 때만

node dist/cli.js serve           # MCP 서버 (stdio) — 아래 등록 예 참고
```

MCP 등록 (Claude Code `.mcp.json`, Codex `config.toml`, Cursor 등 동일 패턴):

```jsonc
{ "mcpServers": { "ctxkit": { "command": "ctxkit", "args": ["serve"] } } }
// 글로벌 미설치 환경: { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] }
```

노출 도구: `get_rules` · `get_repomap` · `get_module_context` · `search_symbol`(아웃라인 기반 폴백 — LSP급이 필요하면 Serena MCP를 나란히 등록) · `make_pack`

다른 저장소 대상: `node dist/cli.js -C /path/to/repo init`, 또는 npm 배포 후 대상 저장소에서 `npx ctx-kit init --ci` 한 번으로 온보딩(패키지명은 `ctx-kit`, 실행 파일명은 `ctxkit`).

## 상태

- [x] P1a: `init` / `map` / `pack`, 코어(config·walk·tokens·repomap·pack) + 어댑터 골격
- [x] P1b: `sync`(내부 구현, Ruler는 선택 어댑터로 보류) / `check`(CI 게이트) / `get` / CI 템플릿
- [x] P2: `serve` — MCP 서버(get_rules, get_repomap, get_module_context, search_symbol, make_pack). Serena는 재구현 대신 나란히 등록하는 구성으로 확정
- [x] P3(검증): `npm pack` 타르볼을 별도 저장소에 설치해 init→map→check→sync→serve 전 과정 확인
- [ ] P3(배포): `npm publish` — npm 로그인 필요
- [x] P4(1차): 측정 하네스(`eval/run.mjs`) + 프로파일×모델 매트릭스 실측 — 결론은 [eval/findings.md](eval/findings.md). 로컬 LLM(ollama) 실측은 설치 후 `--custom`으로 재실행
- [x] 실전 온보딩 1호: `../twin` (소스 308개, 의료 디지털 트윈) — init→모듈 정의→AGENTS.md 초안→map(1.5초)→pack→sync→check→MCP 등록. 이 과정에서 리포맵 랭킹 결함(테스트 파일 상위 독점) 발견·수정(테스트 경로 0.2배 강등, 자체 가중 상한)
- [x] P4(2차, twin 실측): 픽스처 결론 재현(mid 2/3, light 3/3) + 결함 2건 수정(팩 내 리포맵 섹션 캡, target-files 참조 랭킹 정렬 — 알파벳 순 잘림 제거)
- [x] 완성도/전개(0.2.0): 테스트 스위트 10건(`npm test`), `init --auto`(명령·모듈 자동 감지), 글로벌 설치, [docs/onboarding.md](docs/onboarding.md) 플레이북
