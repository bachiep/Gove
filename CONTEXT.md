# Gove Domain Language

Canonical language for the ride-hailing domain. Delivery is a later context and must not be modeled as a renamed Trip.

## Actors

**User**:
A person with credentials and one or more authorized roles.
_Avoid_: Account, login

**Customer**:
A User who requests and pays for transportation.
_Avoid_: Passenger when referring to the role, client

**Driver**:
A User approved to provide transportation with an eligible Vehicle.
_Avoid_: Provider, courier in the ride context

**Vehicle**:
An approved means of transport assigned to a Driver.
_Avoid_: Car when the service type may allow other vehicles

## Ride

**Ride Request**:
A Customer's intent to travel from a Pickup to a Dropoff under a selected Service Type.
_Avoid_: Order, booking, Trip before creation succeeds

**Trip**:
The durable ride aggregate created from a validated Ride Request and tracked through its lifecycle.
_Avoid_: Order, Job, Ride when referring to persisted state

**Pickup**:
The location where the Driver meets the Customer.
_Avoid_: Origin

**Dropoff**:
The intended location where transportation ends.
_Avoid_: Destination

**Service Type**:
A named transportation offering with eligibility and pricing rules.
_Avoid_: Product, vehicle class

**Fare Quote**:
An expiring price estimate calculated for a Ride Request from a versioned pricing rule snapshot.
_Avoid_: Fare when it has not been finalized, invoice

## Dispatch

**Trip Offer**:
A time-limited invitation for one Driver to accept one Trip.
_Avoid_: Assignment before acceptance, notification

**Driver Reservation**:
An exclusive, expiring claim that prevents a Driver from being offered to competing Trips.
_Avoid_: Lock, assignment

**Dispatch Request**:
Dispatch's durable representation of demand for a Driver, linked to a Trip or later Delivery.
_Avoid_: Trip, generic Job

**Driver Work State**:
Dispatch's operational state governing whether a Driver is offline, available, reserved, traveling to Pickup, or on a Trip.
_Avoid_: Online status, presence, eligibility

**Driver Eligibility**:
Whether a Driver and Vehicle are approved for a Service Type independently of current Driver Work State.
_Avoid_: Availability, verification status when all eligibility rules are intended

**Latest Location**:
The freshest accepted position for a Driver, including its capture time and freshness status.
_Avoid_: Driver location when historical points are intended

## Settlement

**Payment Attempt**:
One idempotent effort to authorize or capture money for a completed Trip.
_Avoid_: Payment when the lifecycle state is relevant, transaction
