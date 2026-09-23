# Gove Product Design System

Status: Designed
Last updated: 2026-09-24

## Direction

Gove uses a mobile-first, map-aware interface with a minimal Swiss-style hierarchy: clear typography, high contrast, restrained decoration, and progressive disclosure. Customer and Driver flows prioritize one primary action per state. Operator views use denser desktop layouts with list-first fallbacks.

The PWA is a demo constraint, not a claim of production-grade background location. A Driver marked `AVAILABLE` must keep Gove open; hidden, disconnected, or stale clients become ineligible after the configured freshness threshold.

## Semantic colors

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--surface-canvas` | `#F8FAFC` | `#0F172A` | Page background |
| `--surface-card` | `#FFFFFF` | `#172033` | Cards and sheets |
| `--text-primary` | `#0F172A` | `#F8FAFC` | Primary copy |
| `--text-muted` | `#475569` | `#CBD5E1` | Secondary copy with AA contrast |
| `--brand-primary` | `#1D4ED8` | `#60A5FA` | Primary navigation and action |
| `--brand-accent` | `#C2410C` | `#FB923C` | Time-sensitive emphasis, not generic danger |
| `--state-success` | `#15803D` | `#4ADE80` | Confirmed success |
| `--state-warning` | `#A16207` | `#FACC15` | Stale or attention state |
| `--state-danger` | `#B91C1C` | `#F87171` | Destructive or failed state |
| `--border-default` | `#CBD5E1` | `#475569` | Structure and input boundaries |
| `--focus-ring` | `#1D4ED8` | `#93C5FD` | Keyboard focus |

Colors never communicate state alone. Icons, labels, and text accompany every status.

## Typography and spacing

- Inter is the application typeface for headings, body, numbers, and controls; system sans-serif is the offline fallback.
- Base body size is 16px with 1.5 line height. Critical Driver controls use larger labels.
- Spacing follows a 4px base with primary steps `4, 8, 12, 16, 24, 32, 48, 64`.
- Mobile controls are at least 44 by 44 CSS pixels; Driver primary controls target 48 pixels or more.
- Content gutters start at 16px, rise to 24px on tablet, and 32px on desktop.

## Shape and motion

- Cards and sheets use 12px radius; compact controls use 8px; pills are reserved for status.
- Motion is subtle: 150ms for state feedback and 250ms for sheets or route changes.
- No layout-shifting hover or press transforms.
- `prefers-reduced-motion` removes non-essential movement and preserves the final state.
- GPS updates do not animate or announce continuously; semantic Trip changes do.

## Screen inventory

### Shared

Authentication, session recovery, network/reconnect banner, stale-data indicator, notification center, and permission guidance.

### Customer

Ride Home, Location Search, Service and Fare Quote, Matching, Active Trip, Fare and Simulated Payment, Receipt, and later Trip History/Profile.

### Driver

Driver Setup, Availability Home, Incoming Offer, Pickup, Active Trip, Completion, and later Earnings/Profile. Offer and Trip controls are large, simple, and unsuitable for interaction while the vehicle is moving.

### Operator

Operations Overview, Live Operations list/map, Trip Detail timeline, Exception Queue, Driver Detail, Payment Status, and Audit Log. On narrow screens, lists replace wide tables and maps become secondary.

## Mandatory UI states

- Global: loading, ready, offline, reconnecting, stale, unavailable, unauthorized, session expired.
- Location: requesting, granted, denied, disabled, unavailable, low accuracy, stale, revoked.
- Quote: calculating, available, expired, unsupported, no service, failed.
- Matching: submitting, matching, retrying, assigned, no Driver, cancelled, conflict.
- Offer: incoming, accepting, accepted, rejected, expired, lost race.
- Trip: Driver assigned, at Pickup, in progress, completing, completed, cancelled, version conflict.
- Payment: processing, succeeded, retryable failure, non-retryable failure, unknown, duplicate prevented.

Assignment and Payment never use optimistic success. An unknown Payment shows reconciliation in progress and does not invite immediate duplicate capture.

## Accessibility rules

- Every map state has a text equivalent with address, ETA/distance where available, status, and last-updated time.
- Manual address input and buttons exist for every map drag or GPS-dependent action.
- One polite live region announces important business transitions; telemetry and countdown ticks remain silent.
- Authentication supports password managers and paste.
- Forms retain inline errors and focus a linked error summary when multiple fields fail.
- Sticky controls never obscure keyboard focus; dialogs trap and restore focus correctly.
- Body text targets at least 4.5:1 contrast and interactive boundaries at least 3:1.

## Responsive verification

Verify 375px, 768px, 1024px, and 1440px widths; portrait and landscape where relevant; light and dark themes; reduced motion; keyboard-only flow; location denied; offline/reconnect; and 200% text zoom. Browser console, network failures, accessibility findings, and clipped controls are release blockers unless explicitly documented.
