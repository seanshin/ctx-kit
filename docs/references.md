# 참고 자료집 — 외부 프로젝트·논문·문서

> 2026-09-07 조사. 라이선스·스타 수는 GitHub API로 조사 시점에 직접 확인한 값.
> **도입 가능** = MIT/ISC/BSD(코드 차용·어댑터 가능), **참고만** = Apache-2.0/GPL(알고리즘·설계만 참고, 코드 차용 금지 — [AGENTS.md](../AGENTS.md) 제약).
> 각 항목의 "→ ctx-kit" 줄은 이 자료가 기획의 어느 결정에 근거를 주는지 적는다.

## A. 규칙 파일과 컨텍스트 엔지니어링

**Gloaguen, Mündler, Müller, Raychev, Vechev. *Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?* ETH Zurich / LogicStar, 2026. [arXiv:2602.11988](https://arxiv.org/abs/2602.11988)**
12개 저장소 138개 과제(버그 수정+기능 추가). 개발자 작성 컨텍스트 파일은 평균 +4%, LLM 생성 파일은 평균 **−3%**, 두 경우 모두 추론 비용 **+20% 이상**.
→ ctx-kit: 150줄 상한을 게이트로 강제하는 근거. `init --auto`가 manifest에서 읽어낸 사실만 채우고 LLM으로 규칙을 쓰지 않는 근거. 규칙 부패 탐지(부패한 규칙 = 비용만 내는 규칙)의 동기.

**AGENTS.md 표준.** [agents.md](https://agents.md) — Linux Foundation 산하. Claude Code·Codex CLI·Cursor·Aider·Copilot·Gemini CLI·Windsurf 네이티브 지원.
→ ctx-kit: Tier 0의 단일 원본 포맷.

**Anthropic. *Effective context engineering for AI agents.* 2025-09. [anthropic.com/engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)**
핵심: 컨텍스트는 유한한 주의 예산. **Just-in-time 검색** — 데이터를 미리 싣지 않고 파일 경로·질의 같은 가벼운 식별자를 들고 있다가 필요할 때 도구로 가져온다. Claude Code는 CLAUDE.md를 선적재하고 glob/grep으로 JIT 탐색하는 하이브리드.
→ ctx-kit: `frontier` 프로파일(규칙만 상시 + `search_symbol` 온디맨드)이 정확히 이 모델. 3차 실측(2회 호출로 3/3)이 이를 확인. 모듈 팩의 "경로 색인"도 가벼운 식별자 원칙의 적용.

**Ruler** — [intellectronica/ruler](https://github.com/intellectronica/ruler), MIT, ★2.9k. 규칙 하나를 30+ 에이전트 포맷으로 배포.
→ ctx-kit: `sync`는 공통 부분집합을 무의존으로 내부 구현. 포맷이 30종 필요해지면 어댑터로 교체 가능.

## B. 위치 찾기와 검색 — `--about`, 계층 설계의 근거

**Xia, Deng, Dou, Zhang. *Agentless: Demystifying LLM-based Software Engineering Agents.* 2024. [arXiv:2407.01489](https://arxiv.org/abs/2407.01489) · [코드](https://github.com/OpenAutoCoder/Agentless) MIT ★2.1k**
에이전트 없이 **계층적 위치 찾기(파일 → 클래스/함수 → 편집 지점)** + 수정의 2단계로 SWE-bench Lite 40.67%. 저장소를 AST로 압축한 구조 개요를 먼저 보여주고 파일을 고르게 한다.
→ ctx-kit: 4계층이 같은 계층 구조다 — 맵(구조) → 팩(파일) → `search_symbol`(심볼). `--about`은 "구조 개요로 파일 고르기" 단계를 정적으로 수행하는 것. 도입 가능(MIT)이지만 Python 전용 AST라 참고만.

**Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.* NeurIPS 2024. [arXiv:2405.15793](https://arxiv.org/abs/2405.15793) · [코드](https://github.com/SWE-agent/SWE-agent) MIT ★20k**
LM 에이전트는 고유한 요구를 가진 새로운 종류의 사용자이며, 인터페이스 설계가 성능을 좌우한다. 원칙: **단순성, 간결성, 간결한 피드백, 오류 가드레일**.
→ ctx-kit: MCP 도구를 5종으로 고정하고 파라미터로만 넓히는 원칙 8의 근거. `search_symbol`이 "LSP급이 필요하면 Serena"라고 스스로 한계를 말하는 설명문, `get_module_context`의 "unknown module — defined modules: …" 오류 메시지가 가드레일.

**BM25.** Robertson & Zaragoza, *The Probabilistic Relevance Framework: BM25 and Beyond*, 2009. SWE-bench 계열 연구의 파일 위치 찾기 기준선: SWE-bench Verified에서 **BM25 Top-1 재현율 43.6%, Top-30 재현율 87.7%** ([Dissecting the SWE-Bench Leaderboards](https://arxiv.org/html/2506.17208v2) 등).
→ ctx-kit: 두 가지 결론. ① `--about`의 질의 점수는 임의 가중치가 아니라 **BM25**(경로·심볼명·본문을 필드로)로 계산한다. ② 파일 수준 위치 찾기는 어휘적 검색만으로 재현율 87.7%에 도달하므로 **임베딩을 도입하지 않는** 비목표의 정량 근거.

**Ouyang et al. *RepoGraph: Enhancing AI Software Engineering with Repository-level Code Graph.* ICLR 2025. [arXiv:2410.14684](https://arxiv.org/html/2410.14684v2) · [코드](https://github.com/ozyyshr/RepoGraph) Apache-2.0 ★301 — 참고만**
줄 단위 코드 그래프와 ego-graph 검색을 Agentless·RAG·에이전트에 붙여 일관되게 향상. BM25 RAG와의 비교 실험 포함.
→ ctx-kit: `search_symbol`의 "정의 + 참조 지점" 출력이 축소판 ego-graph. 이후 확장 시 그래프 깊이 파라미터의 참고.

**aider repository map.** [aider.chat/docs/repomap](https://aider.chat/docs/repomap.html) · [코드](https://github.com/Aider-AI/aider) Apache-2.0 ★48k — 참고만.
tree-sitter 태그 + PageRank로 파일·심볼 중요도. 편집 중인 파일을 기준으로 맵을 개인화.
→ ctx-kit: 리포맵 랭킹의 알고리즘 참고(코드 차용 없음). "편집 중 파일 기준 개인화"는 `--diff`·`--about`의 선례.

**CodeRAG-Bench.** [code-rag-bench/code-rag-bench](https://github.com/code-rag-bench/code-rag-bench) ★173, LICENSE 파일 없음(주의). BM25·밀집 검색·API 임베딩을 같은 조건에서 비교하는 벤치마크.
→ ctx-kit: `ctxkit eval`이 검색 방식 A/B(BM25 vs 참조 랭킹 vs 혼합)를 지원할 때의 방법론 참고.

## C. 이력 신호 — 공변경 랭킹

**Zimmermann, Weißgerber, Diehl, Zeller. *Mining Version Histories to Guide Software Changes.* ICSE 2004 / IEEE TSE 2005. [PDF](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf)**
ROSE: 버전 이력에서 연관 규칙을 학습해 "이 함수를 바꾼 사람들은 저것도 바꿨다"를 추천. **프로그램 분석으로는 탐지 불가능한 결합**을 드러내고, 불완전한 변경으로 인한 오류를 예방. 기존 코드 변경에서 예측력이 가장 높다.
→ ctx-kit: 공변경 랭킹(§4.7)의 원전. "시드 상대적일 때 의미가 크다"는 설계와 "참조가 놓친 결합이 실제로 나오는가"라는 채택/기각 기준이 여기서 나온다.

**Tornhill. *Your Code as a Crime Scene.* Pragmatic Bookshelf, 2015. · [code-maat](https://github.com/adamtornhill/code-maat) GPL-3.0 ★2.6k — 참고만(코드 차용 금지)**
핫스팟(변경 빈도 × 복잡도), 시간적 결합(temporal coupling) 분석의 실무 정립.
→ ctx-kit: 대량 리팩터링 커밋 제외(|C| > 50), 최근 N커밋 창 같은 실무 파라미터의 참고.

## D. 저장소 건강 — 원천 목표의 "관리" 축

**dependency-cruiser** — [sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser), MIT ★7.1k. JS/TS 의존 규칙 검증("ui/는 db/를 import하지 못한다").
**import-linter** — [seddonym/import-linter](https://github.com/seddonym/import-linter), BSD-2 ★1.2k. Python 아키텍처 계약(layers, forbidden, independence).
**ArchUnit** — [TNG/ArchUnit](https://github.com/TNG/ArchUnit), Apache-2.0 ★3.8k — 참고만. Java 아키텍처 테스트의 원형.
→ ctx-kit: "아키텍처 피트니스 함수"(CI에서 실행되는 실행 가능한 아키텍처 명세)의 확립된 도구들. `constraints:` 블록은 이들의 **언어 중립·규칙 문서 연동** 축소판이며, 언어별 정밀 검사가 필요하면 어댑터로 이 도구들을 호출한다.

**ast-grep** — [ast-grep/ast-grep](https://github.com/ast-grep/ast-grep), MIT ★15.8k. tree-sitter 기반 구조적 검색·린트·재작성 CLI.
→ ctx-kit: 제약을 정규식이 아니라 AST 패턴으로 표현해야 할 때의 어댑터 후보. 정규식 심볼 추출기의 tree-sitter 업그레이드 경로이기도 하다.

**knip** — [webpro-nl/knip](https://github.com/webpro-nl/knip), ISC ★12.2k. JS/TS 미사용 파일·의존성·export.
**vulture** — [jendrikseipp/vulture](https://github.com/jendrikseipp/vulture), MIT ★4.8k. Python 죽은 코드.
**jscpd** — [kucherenko/jscpd](https://github.com/kucherenko/jscpd), MIT ★6.2k. 220+ 언어 복사·붙여넣기 탐지, SARIF 출력.
→ ctx-kit: 드리프트 지표(고아 파일·중복 구현)의 정밀 버전. 1차는 이미 있는 심볼 인덱스·참조 점수로 언어 중립 근사치를 내고, 정밀도가 필요하면 어댑터로 이들을 호출한다.

## E. 긴 컨텍스트의 위치 효과

**Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni, Liang. *Lost in the Middle: How Language Models Use Long Contexts.* TACL 2024. [arXiv:2307.03172](https://arxiv.org/abs/2307.03172)**
정답 문서가 컨텍스트 중간에 있을 때 정확도가 최저, 앞·뒤에서 최고인 U자 곡선. 다중 문서 QA와 키-값 검색 모두에서 재현.
→ ctx-kit: `light` 팩이 규칙을 앞에 두고 12줄 리마인더를 꼬리에 반복하는 배치의 근거.

## F. 평가 방법론

**SWE-bench.** Jimenez et al., ICLR 2024. [arXiv:2310.06770](https://arxiv.org/html/2310.06770) — 실제 GitHub 이슈 해결. 위 BM25 수치의 출처 벤치마크.
**RepoBench.** Liu et al., 2023 — 검색(RepoBench-R)·완성(-C)·파이프라인(-P) 세 과제로 저장소 수준 컨텍스트 활용을 분리 측정.
**CrossCodeEval.** Ding et al., NeurIPS 2023 — Python/Java/TS/C# 1만 예제의 교차 파일 완성.
**Long Code Arena**, **LoCoBench**, **LongCodeBench** (2024–2025) — 긴 컨텍스트 코드 이해.
→ ctx-kit: `ctxkit eval`의 `expect_file` 포함률 지표는 RepoBench-R(검색 단계를 따로 채점)의 축소판. 모델 호출 없이 계산되는 무료 지표를 두는 설계의 선례. 과제 설계 원칙(구조/세부/규칙 분리)은 이 벤치마크들의 과제 분류를 따른다.

## G. 토큰 계수와 파싱 — 어댑터 후보

**gpt-tokenizer** — [niieani/gpt-tokenizer](https://github.com/niieani/gpt-tokenizer), MIT ★841. 순수 JS BPE.
**tiktoken (JS)** — [dqbd/tiktoken](https://github.com/dqbd/tiktoken), MIT ★1.1k. WASM 바인딩.
→ ctx-kit: `chars/4` 근사를 대체할 토크나이저 어댑터. CJK 과소평가 문제의 해법. 둘 다 MIT라 도입 가능하나 번들 크기(BPE 테이블) 대비 이득을 측정 후 결정.

**tree-sitter** — [tree-sitter/tree-sitter](https://github.com/tree-sitter/tree-sitter), MIT ★26.9k. 증분 파서; `web-tree-sitter`로 WASM 문법 로드.
→ ctx-kit: 정규식 아웃라인의 상위 어댑터. 문법 WASM 파일 크기가 배포 크기(현재 21KB)를 크게 늘리므로 선택적 설치로.

## H. 프로토콜·규격

**Model Context Protocol.** [modelcontextprotocol.io](https://modelcontextprotocol.io) · TypeScript SDK MIT.
→ ctx-kit: 인터페이스 A. stdio 전송, `registerTool` + zod 스키마.

**llms.txt.** [llmstxt.org](https://llmstxt.org) — 사이트·프로젝트가 LLM에게 주는 진입점 문서 규격.
→ ctx-kit: 개념적 친척. 저장소용 `docs/generated/repomap.md`가 같은 역할. 필요 시 `llms.txt` 출력 어댑터는 몇 줄.

## 도입 판단 요약

| 도구 | 라이선스 | 판단 |
|---|---|---|
| Agentless, SWE-agent, ast-grep, jscpd, vulture, dependency-cruiser, gpt-tokenizer, tiktoken-js, tree-sitter, Ruler, Serena, Repomix, code2prompt | MIT | 도입 가능 |
| knip | ISC | 도입 가능(MIT 호환) |
| import-linter | BSD-2 | 도입 가능(MIT 호환) |
| aider, RepoGraph, ArchUnit | Apache-2.0 | 참고만 — 고지 의무 회피 위해 코드 차용 금지 |
| code-maat | GPL-3.0 | 참고만 — 코드 차용 금지 |
| CodeRAG-Bench | 미표기 | 방법론 참고만 |
