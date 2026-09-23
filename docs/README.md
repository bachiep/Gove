# Documentation Register

Status: Active
Last updated: 2026-09-24

Documentation records intended behavior and verified evidence. It must distinguish what is planned from what exists in code and runtime.

## Registers and plans

| Document                                                      | Purpose                                         | Status         |
| ------------------------------------------------------------- | ----------------------------------------------- | -------------- |
| [Project charter](project/charter.md)                         | Goal, constraints, success conditions           | Accepted       |
| [Roadmap](project/roadmap.md)                                 | Milestones and gates                            | Accepted       |
| [Risk register](project/risk-register.md)                     | Active delivery and technical risks             | Active         |
| [Technical debt register](project/technical-debt-register.md) | Deliberate deferrals and removal triggers       | Active         |
| [Open questions](project/open-questions.md)                   | Non-blocking decisions requiring later evidence | Active         |
| [MVP requirements](requirements/mvp.md)                       | Functional and non-functional baseline          | Draft          |
| [Trip lifecycle](domain/trip-lifecycle.md)                    | State machines and invariants                   | Tested         |
| [Architecture overview](architecture/overview.md)             | Runtime shape, modules, and data flow           | Designed       |
| [Data ownership](architecture/data-ownership.md)              | Authoritative writers and projections           | Designed       |
| [Failure model](architecture/failure-model.md)                | Dependency failures and expected behavior       | Designed       |
| [Testing strategy](testing/strategy.md)                       | Test levels and evidence gates                  | Accepted       |
| [Local development](operations/local-development.md)          | Reproducible local environment                  | Tested locally |
| [Vertical slice 01](implementation/vertical-slice-01.md)      | First implementation sequence                   | Accepted       |
| [Product design system](design/design-system.md)              | UI tokens and interaction rules                 | Designed       |

## Architecture decisions

| ADR                                                   | Decision                                 | Status   |
| ----------------------------------------------------- | ---------------------------------------- | -------- |
| [0001](adr/0001-modular-monolith-first.md)            | Begin with a modular monolith            | Accepted |
| [0002](adr/0002-postgresql-is-the-source-of-truth.md) | PostgreSQL owns durable business state   | Accepted |
| [0003](adr/0003-transactional-outbox.md)              | Publish durable events through an outbox | Accepted |

## Evidence rules

- **Planned**: scope and acceptance criteria exist.
- **Designed**: interfaces, invariants, and failure behavior are defined.
- **Implemented**: code exists and builds.
- **Tested**: relevant automated tests ran successfully.
- **Verified**: acceptance evidence was reviewed against requirements.
- **Deployed**: a named environment was deployed and health-checked.
