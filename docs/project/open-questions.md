# Open Questions

Status: Active
Last updated: 2026-09-24

These questions do not block M0. Each has a safe provisional assumption and a milestone by which it must be resolved.

| ID   | Question                                                              | Provisional assumption                                                                           | Resolve by  |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| Q-01 | Which city and service area constrain demo coordinates?               | Resolved: synthetic `10.7400..10.8200`, `106.6400..106.7400` rectangle; labels are not addresses | Resolved M2 |
| Q-02 | What cancellation fees apply after assignment or pickup arrival?      | Resolved: no cancellation fee in MVP; cancellation metadata remains required                     | Resolved M2 |
| Q-03 | How long may a Trip Offer and Driver Reservation live?                | Resolved: configurable TTL; the demo value is covered by integration tests                       | Resolved M3 |
| Q-04 | Is a map tile or routing provider allowed for the demo?               | Resolved: no provider is required; manual coordinates keep core acceptance provider-free         | Resolved M4 |
| Q-05 | How long should location history be retained?                         | Resolved: only Latest Location is retained in MVP                                                | Resolved M4 |
| Q-06 | What are the target VPS CPU, memory, storage, and domain constraints? | Unresolved external input; local verification is valid, but `Deployed` cannot be claimed         | Before VPS  |
| Q-07 | Which delivery type is first: parcel, food, or general courier?       | Resolved: general parcel with one pickup and one recipient                                       | Resolved M7 |
