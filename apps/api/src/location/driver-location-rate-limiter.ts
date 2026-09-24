const acceptedLocationWindowMilliseconds = 3_000;

/**
 * Process-local admission control for Driver location writes.
 *
 * A successful admission reserves the Driver's next three-second window before
 * the repository is called, preventing concurrent requests from both writing.
 */
export class DriverLocationRateLimiter {
  private readonly acceptedAtByDriver = new Map<string, number>();

  tryAccept(driverUserId: string, now = Date.now()): boolean {
    const acceptedAt = this.acceptedAtByDriver.get(driverUserId);
    if (
      acceptedAt !== undefined &&
      now - acceptedAt < acceptedLocationWindowMilliseconds
    ) {
      return false;
    }

    this.acceptedAtByDriver.set(driverUserId, now);
    this.pruneExpired(now);
    return true;
  }

  private pruneExpired(now: number): void {
    if (this.acceptedAtByDriver.size < 1_000) return;

    for (const [driverUserId, acceptedAt] of this.acceptedAtByDriver) {
      if (now - acceptedAt >= acceptedLocationWindowMilliseconds) {
        this.acceptedAtByDriver.delete(driverUserId);
      }
    }
  }
}
