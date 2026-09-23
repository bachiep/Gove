# Documentation Register

Status: Active
Last updated: 2026-09-24

Documentation records intended behavior and verified evidence. It must distinguish what is planned from what exists in code and runtime.

## Registers and plans

| Document                                                                | Purpose                                         | Status         |
| ----------------------------------------------------------------------- | ----------------------------------------------- | -------------- |
| [Project charter](project/charter.md)                                   | Goal, constraints, success conditions           | Accepted       |
| [Roadmap](project/roadmap.md)                                           | Milestones and gates                            | Active         |
| [Risk register](project/risk-register.md)                               | Active delivery and technical risks             | Active         |
| [Technical debt register](project/technical-debt-register.md)           | Deliberate deferrals and removal triggers       | Active         |
| [Open questions](project/open-questions.md)                             | Non-blocking decisions requiring later evidence | Active         |
| [MVP requirements](requirements/mvp.md)                                 | Functional and non-functional baseline          | Draft          |
| [Trip lifecycle](domain/trip-lifecycle.md)                              | State machines and invariants                   | Tested         |
| [Architecture overview](architecture/overview.md)                       | Runtime shape, modules, and data flow           | Designed       |
| [Data ownership](architecture/data-ownership.md)                        | Authoritative writers and projections           | Designed       |
| [Failure model](architecture/failure-model.md)                          | Dependency failures and expected behavior       | Designed       |
| [Testing strategy](testing/strategy.md)                                 | Test levels and evidence gates                  | Accepted       |
| [Local development](operations/local-development.md)                    | Reproducible local environment                  | Tested locally |
| [Vertical slice 01](implementation/vertical-slice-01.md)                | First implementation sequence                   | Accepted       |
| [Vertical slice 02](implementation/vertical-slice-02.md)                | Quote, durable Ride Request, and customer PWA   | Tested locally |
| [Product design system](design/design-system.md)                        | UI tokens and interaction rules                 | Designed       |
| [Authentication API](api/authentication.md)                             | Auth/session and driver self-service contracts  | Tested locally |
| [Ride request API](api/ride-requests.md)                                | M2 quote and Trip creation contracts            | Tested locally |
| [Authentication boundary](security/authentication-and-authorization.md) | Implemented identity controls and limitations   | Tested locally |
| [Identity and driver data](data/identity-driver-schema.md)              | M1 ownership, schema, and migration rules       | Implemented    |

## Architecture decisions

| ADR                                                   | Decision                                 | Status   |
| ----------------------------------------------------- | ---------------------------------------- | -------- |
| [0001](adr/0001-modular-monolith-first.md)            | Begin with a modular monolith            | Accepted |
| [0002](adr/0002-postgresql-is-the-source-of-truth.md) | PostgreSQL owns durable business state   | Accepted |
| [0003](adr/0003-transactional-outbox.md)              | Publish durable events through an outbox | Accepted |
| [0004](adr/0004-rotating-refresh-sessions.md)         | Rotate opaque refresh sessions           | Accepted |
| [0005](adr/0005-immutable-single-use-fare-quotes.md)  | Persist immutable single-use Fare Quotes | Accepted |

## Evidence rules

- **Planned**: scope and acceptance criteria exist.
- **Designed**: interfaces, invariants, and failure behavior are defined.
- **Implemented**: code exists and builds.
- **Tested**: relevant automated tests ran successfully.
- **Verified**: acceptance evidence was reviewed against requirements.
- **Deployed**: a named environment was deployed and health-checked.
