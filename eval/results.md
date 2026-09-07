# P4 results (2026-09-07)

| profile | model | task | pass | ctx tokens | secs | answer |
|---|---|---|---|---|---|---|
| mid | haiku | q1-structure | ✅ | ~214 | 4.0 | lib/discount.py |
| mid | haiku | q2-detail | ❌ | ~214 | 11.7 | I cannot answer this question with only the context provided. The repository map |
| mid | haiku | q3-callgraph | ✅ | ~214 | 11.4 | Based on the repository map provided, the function is: **calc_total** |
| mid | sonnet | q1-structure | ✅ | ~214 | 3.4 | lib/discount.py |
| mid | sonnet | q2-detail | ❌ | ~214 | 5.3 | The context provided (AGENTS.md constraints and the repository map) only shows t |
| mid | sonnet | q3-callgraph | ✅ | ~214 | 5.5 | calc_total |
| light | haiku | q1-structure | ✅ | ~500 | 4.2 | lib/discount.py |
| light | haiku | q2-detail | ✅ | ~500 | 4.2 | 0.8 |
| light | haiku | q3-callgraph | ✅ | ~500 | 4.2 | `calc_total` |
| light | sonnet | q1-structure | ✅ | ~500 | 4.0 | lib/discount.py |
| light | sonnet | q2-detail | ✅ | ~500 | 3.4 | 0.8 |
| light | sonnet | q3-callgraph | ✅ | ~500 | 3.4 | calc_total |

## Pass rate by cell

| profile | model | passed |
|---|---|---|
| mid | haiku | 2/3 |
| mid | sonnet | 2/3 |
| light | haiku | 3/3 |
| light | sonnet | 3/3 |
