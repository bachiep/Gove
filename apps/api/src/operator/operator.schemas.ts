import { z } from 'zod';

export const operatorTripParamsSchema = z.object({
  tripId: z.uuid(),
});

export const createDiagnosticAuditSchema = z.object({
  reason: z.string().trim().min(3).max(240),
});

export const operatorDriverParamsSchema = z.object({
  driverUserId: z.uuid(),
});

export const operatorVehicleParamsSchema = operatorDriverParamsSchema.extend({
  vehicleId: z.uuid(),
});

export const approveOnboardingSubjectSchema = z.object({
  reason: z.string().trim().min(3).max(240),
});
