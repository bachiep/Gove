-- Gove acceptance queries. Read-only; safe for a demo/staging database.

-- Applied migration evidence.
SELECT version, applied_at
FROM public.schema_migrations
ORDER BY version;

-- A Driver work-state row must never reference both a Trip and a Delivery.
SELECT driver_user_id, work_state, current_trip_id, current_delivery_id
FROM dispatch.driver_work_states
WHERE current_trip_id IS NOT NULL
  AND current_delivery_id IS NOT NULL;

-- No Driver may have more than one active Ride assignment.
SELECT driver_user_id, count(*) AS active_assignments
FROM dispatch.assignments
WHERE status = 'ACTIVE'
GROUP BY driver_user_id
HAVING count(*) > 1;

-- No Driver may have more than one active Delivery assignment.
SELECT driver_user_id, count(*) AS active_assignments
FROM delivery.assignments
WHERE status = 'ACTIVE'
GROUP BY driver_user_id
HAVING count(*) > 1;

-- Cross-domain active assignments must not overlap.
SELECT ride.driver_user_id,
       ride.trip_id,
       parcel.delivery_id
FROM dispatch.assignments AS ride
JOIN delivery.assignments AS parcel
  ON parcel.driver_user_id = ride.driver_user_id
WHERE ride.status = 'ACTIVE'
  AND parcel.status = 'ACTIVE';

-- No Trip may have multiple pending offers.
SELECT trip_id, count(*) AS pending_offers
FROM dispatch.trip_offers
WHERE status = 'PENDING'
GROUP BY trip_id
HAVING count(*) > 1;

-- No Delivery may have multiple pending offers.
SELECT delivery_id, count(*) AS pending_offers
FROM delivery.delivery_offers
WHERE status = 'PENDING'
GROUP BY delivery_id
HAVING count(*) > 1;

-- Transition versions must be gap-free from zero to the aggregate version.
SELECT t.id,
       t.version,
       count(st.id) AS transition_count,
       max(st.to_version) AS latest_transition_version
FROM trip.trips AS t
LEFT JOIN trip.state_transitions AS st ON st.trip_id = t.id
GROUP BY t.id, t.version
HAVING count(st.id) <> t.version + 1
    OR max(st.to_version) <> t.version;

SELECT d.id,
       d.version,
       count(st.id) AS transition_count,
       max(st.to_version) AS latest_transition_version
FROM delivery.deliveries AS d
LEFT JOIN delivery.state_transitions AS st ON st.delivery_id = d.id
GROUP BY d.id, d.version
HAVING count(st.id) <> d.version + 1
    OR max(st.to_version) <> d.version;

-- A completed Trip must have final metering and fare.
SELECT id, state, actual_distance_meters, actual_duration_seconds,
       final_fare_minor, completed_at
FROM trip.trips
WHERE state = 'COMPLETED'
  AND (actual_distance_meters IS NULL
    OR actual_duration_seconds IS NULL
    OR final_fare_minor IS NULL
    OR completed_at IS NULL);

-- A delivered parcel must have pickup custody and one proof.
SELECT d.id, a.id AS assignment_id, p.id AS proof_id
FROM delivery.deliveries AS d
LEFT JOIN delivery.assignments AS a ON a.delivery_id = d.id
LEFT JOIN delivery.delivery_proofs AS p ON p.delivery_id = d.id
WHERE d.state = 'DELIVERED'
  AND (a.pickup_custody_confirmation IS NULL OR p.id IS NULL);

-- Outbox backlog snapshot for the report; this is not itself an error.
SELECT 'trip' AS producer, count(*) AS unpublished
FROM trip.outbox_events
WHERE published_at IS NULL
UNION ALL
SELECT 'payment', count(*)
FROM payment.outbox_events
WHERE published_at IS NULL
UNION ALL
SELECT 'delivery', count(*)
FROM delivery.outbox_events
WHERE published_at IS NULL;
