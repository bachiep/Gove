# Technical Debt Register

Status: Active
Last updated: 2026-09-24

These are deliberate deferrals, not completed capabilities.

| ID    | Deferred capability                    | Initial choice                                                                     | Removal trigger                                                          |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TD-01 | Road-network distance and ETA          | Use deterministic straight-line distance for demo pricing; label it as an estimate | Before claiming realistic ETA or fare accuracy                           |
| TD-02 | Multi-instance WebSocket routing       | Run one application instance first                                                 | Before scaling the gateway beyond one instance                           |
| TD-03 | Historical GPS route storage           | Keep only Latest Location in the MVP                                               | A defined audit, dispute, or analytics requirement                       |
| TD-04 | Real payment provider                  | Use an explicit simulator adapter                                                  | Before any real-money or card-data workflow                              |
| TD-05 | Independent services and broker        | Use in-process module calls plus transactional outbox                              | A documented architecture evolution gate is met                          |
| TD-06 | Native mobile clients                  | Use an installable responsive PWA                                                  | A device capability or distribution requirement cannot be met on the web |
| TD-07 | Distributed auth abuse protection      | Process-local fixed-window limits protect one API process only                     | Before a multi-instance or public deployment                             |
| TD-08 | Account recovery and verification      | No email verification, password reset, MFA, or operator provisioning in M1         | Before a user account is treated as an operational identity              |
| TD-09 | Delivery reassignment and cancellation | First parcel slice closes expired offers as no-driver and omits cancellation       | Before operational Delivery service or cancellation promises             |
| TD-10 | Proof media and recipient verification | Store bounded confirmation text only; no photo, signature, or identity document    | Before stronger proof is required; complete privacy and retention design |
