---
status: accepted
---

# Begin with a modular monolith

Gove will deploy the MVP as one NestJS application with explicit domain modules rather than independent microservices. This preserves transactional correctness and makes local and VPS operation reproducible while retaining seams that can be extracted when measured scaling, ownership, security, or failure-isolation evidence justifies the operational cost.

## Considered options

An initial microservice fleet was rejected because it introduces network failure, distributed transactions, broker operations, and deployment overhead before those costs solve an observed requirement. An unstructured monolith was rejected because it would hide ownership and make later extraction unsafe.
