# Local Resource Budget

Status: Operational guardrail for local development
Last updated: 2026-09-25

Gove is developed on a workstation with approximately 16 GiB RAM. The main
constraint is not CPU; IDE processes, Chrome, Docker/Supabase, and Node
watchers can coexist until a build, test suite, browser session, and agent are
started at the same time. The gate therefore uses Linux `MemAvailable` and
swap usage, not the misleading `free` column.

## Gate

Run this read-only check before starting an agent, browser session, full build,
or full test suite:

```bash
tools/operations/resource-budget.sh
```

| Mode               | Condition                                                | Work policy                                                         |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `normal`           | At least 20% of total RAM available and swap below 1 GiB | Run normal agent work; serialize only duplicate heavy builds/tests. |
| `guarded`          | 10–20% of total RAM available, or swap above 1 GiB       | Continue normally; avoid another heavy task if latency rises.       |
| `stop-and-recover` | Below 10% of total RAM available, or swap above 2 GiB    | Do not start new agents; stop idle project sessions and recheck.    |

The 20% warning boundary corresponds approximately to 80% memory pressure for
this workstation. These are safety thresholds, not capacity claims. A task
that has previously caused instability is treated as medium/heavy even if the
current snapshot is green.

## Session policy

1. Keep one API dev server and one web dev server only when browser acceptance
   is active. Stop both after the acceptance pass.
2. Keep one browser profile and one tab for the current scenario. Do not open a
   browser per agent.
3. Run one full `npm run check` or production build at a time. Prefer targeted
   typecheck/build while iterating.
4. Use agents for disjoint tasks. In `guarded` mode, agents may continue, but
   do not start another heavy runtime task if the machine begins lagging.
5. Never stop unrelated IDE, Supabase, Docker, or user services solely to make
   an agent fit. Stop only project-owned sessions created for the current
   verification pass.
6. If the gate enters `stop-and-recover`, capture the state, stop the idle
   project browser/dev servers gracefully, wait for memory to settle, and run
   the gate again. Do not kill processes by broad name matching.

## Current measured baseline

On 2026-09-25, the workstation reported approximately 6.0 GiB available RAM
and 8 MiB swap in use. That is `normal` under this policy; the team may keep
working normally, while duplicate heavy builds/tests remain serialized.
