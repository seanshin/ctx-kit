# 새 프로젝트 온보딩 플레이북

> 전제: `ctxkit`이 글로벌 설치되어 있음 (`npm i -g @seanshin/ctx-kit`).
> 소요: 후보 확인 포함 10분 내외. twin 온보딩(2026-09-07)에서 검증된 절차.

## 1. 스캐폴딩 (자동 감지)

```sh
cd /path/to/project
ctxkit init --auto            # 명령·모듈 경계를 manifest에서 감지해 초안 생성
ctxkit init --auto --hooks    # + 커밋 시 check 실행(git pre-commit, 무료)
```

- 기존 `AGENTS.md`/`CLAUDE.md`가 있으면 **절대 덮어쓰지 않음**(skip 표시).
- `--ci`(GitHub Actions)는 비공개 저장소에서 Actions 분량을 소모하므로 기본 비권장.

## 2. 초안 검증 (사람의 일 — 생략 금지)

1. `AGENTS.md`: 자동 감지된 Commands가 실제로 도는지 확인, Constraints·용어집을
   "코드만 봐서는 알 수 없는 것"으로 채움. **150줄 이하 유지** — 장황한 규칙은
   측정상 에이전트 성능을 해침.
2. `context.config.yaml`: 모듈 경계가 실제 팀의 사고 단위와 맞는지 조정.
   `.venv`·마이그레이션·예제 등 소음은 `exclude`에 추가.
   (dot-디렉토리·node_modules·dist 등은 자동 제외됨)

## 3. 산출물 생성·배포

```sh
ctxkit map                    # Tier 1 리포맵 → docs/generated/repomap.md
ctxkit pack --profile light   # 경량 모델용 팩 (모듈별: --module <name>)
ctxkit sync                   # AGENTS.md → CLAUDE.md 등 배포
ctxkit check                  # 게이트 4종 통과 확인
```

기존 수작업 CLAUDE.md가 있던 저장소는: 내용을 AGENTS.md로 옮긴 뒤
`ctxkit sync --force` (sync가 낯선 파일을 건너뛰며 안내함).

## 4. MCP 등록 (에이전트형 도구)

`.mcp.json` (Claude Code) / Codex `config.toml` / Cursor 설정에:

```json
{ "mcpServers": { "ctxkit": { "command": "ctxkit", "args": ["serve"] } } }
```

LSP급 심볼 분석이 필요하면 Serena MCP를 **나란히** 추가 등록.

## 5. 프로파일 튜닝 (선택 — 실측 근거는 eval/findings.md)

- 기본 light(12k)는 참조 랭킹 상위 파일만 담김 — 대부분 충분.
- 모듈 전체 원문이 필요하고 128K급 로컬 모델을 쓴다면 저장소 config에
  `light-xl: { inject: [agents-summary, repomap, target-files], budget: 45000 }` 추가.
- 검증하고 싶으면 과제를 `eval/twin-tasks.yaml` 형식으로 만들어:
  `node eval/run.mjs --fixture <repo> --tasks <tasks.yaml> --module <m> --out eval/results-<repo>.md`

## 유지보수 루틴

- 코드가 바뀌면 `ctxkit map` 재실행(훅/CI가 stale 경고).
- 규칙 변경은 항상 AGENTS.md에서 → `ctxkit sync`.
- `ctxkit check`가 유일한 게이트: 규칙 길이·sync 신선도·리포맵 신선도·시크릿.
