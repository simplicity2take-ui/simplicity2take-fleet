// Pure identity guard shared by Bolt sync and its unit tests.
export function hasBoltIdentityConflict(existingBoltId: unknown, incomingBoltId: unknown): boolean {
  return typeof existingBoltId === "string" && existingBoltId.length > 0 &&
    typeof incomingBoltId === "string" && incomingBoltId.length > 0 &&
    existingBoltId !== incomingBoltId;
}
