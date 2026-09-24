# Sơ Đồ Domain và Use Case

Trạng thái: Hỗn hợp; phần chưa hoàn thiện được ghi chú riêng
Cập nhật lần cuối: 2026-09-24

## D-06 — Năng lực actor trong Ride

```mermaid
flowchart LR
    customer[Customer]
    driver[Driver]
    operator[Operator]

    subgraph ride[Ride Capabilities]
        authenticate[Authenticate]
        quote[Request Fare Quote]
        createTrip[Create Trip]
        followTrip[Follow Trip]
        manageDriver[Manage Profile and Vehicle]
        publishLocation[Publish Latest Location]
        acceptOffer[Accept or Reject Offer]
        executeTrip[Arrive, Start, Complete]
        settle[Simulate Payment]
        viewHistory[View History]
        diagnose[Inspect Diagnostics]
    end

    customer --> authenticate
    customer --> quote
    customer --> createTrip
    customer --> followTrip
    customer --> settle
    customer --> viewHistory

    driver --> authenticate
    driver --> manageDriver
    driver --> publishLocation
    driver --> acceptOffer
    driver --> executeTrip
    driver --> viewHistory

    operator --> diagnose
```

Các năng lực Customer và Driver trong hình đã được triển khai local. Metric cho
Operator đã có, nhưng action/audit đầy đủ theo FR-18 vẫn còn thiếu.

## D-07 — Năng lực actor trong Parcel Delivery

```mermaid
flowchart LR
    customer[Customer]
    driver[Driver]

    subgraph parcel[First Parcel Slice]
        createDelivery[Create Delivery]
        requestMatch[Request Matching]
        followDelivery[Follow Status]
        viewDeliveryHistory[View History]
        acceptDelivery[Accept Offer]
        arrivePickup[Arrive at Pickup]
        confirmCustody[Confirm Custody]
        recordProof[Record Recipient Proof]
    end

    customer --> createDelivery
    customer --> requestMatch
    customer --> followDelivery
    customer --> viewDeliveryHistory

    driver --> acceptDelivery
    driver --> arrivePickup
    driver --> confirmCustody
    driver --> recordProof
```

Backend và Driver Console đã hỗ trợ lifecycle trong hình. UI tạo Delivery và
trạng thái live cho Customer còn thiếu; lịch sử Customer qua HTTP đã có.

## D-08 — State machine của Trip

```mermaid
stateDiagram-v2
    direction LR
    [*] --> REQUESTED
    REQUESTED --> MATCHING: request match
    MATCHING --> DRIVER_TO_PICKUP: accept offer
    MATCHING --> MATCHING: reject and reassign
    MATCHING --> NO_DRIVER_AVAILABLE: exhaust attempt
    DRIVER_TO_PICKUP --> AT_PICKUP: arrive
    AT_PICKUP --> IN_PROGRESS: start
    IN_PROGRESS --> COMPLETED: complete
    REQUESTED --> CANCELLED: cancel
    MATCHING --> CANCELLED: cancel
    DRIVER_TO_PICKUP --> CANCELLED: cancel by rule
    COMPLETED --> [*]
    CANCELLED --> [*]
    NO_DRIVER_AVAILABLE --> [*]
```

Trạng thái cancellation tồn tại trong model, nhưng API và bằng chứng nghiệm thu
cuối cùng vẫn đang mở trong acceptance matrix.

## D-09 — State machine của Delivery

```mermaid
stateDiagram-v2
    direction LR
    [*] --> REQUESTED
    REQUESTED --> MATCHING: request match
    MATCHING --> DRIVER_TO_PICKUP: accept offer
    MATCHING --> NO_DRIVER_AVAILABLE: no driver or expiry
    DRIVER_TO_PICKUP --> AT_PICKUP: arrive
    AT_PICKUP --> IN_TRANSIT: confirm custody
    IN_TRANSIT --> DELIVERED: record proof
    DELIVERED --> [*]
    NO_DRIVER_AVAILABLE --> [*]
```

Database model có dự phòng `CANCELLED`, nhưng hình không biểu diễn vì Delivery
slice đầu tiên chưa có command hoặc rule cancellation.
