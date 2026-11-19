#!/usr/bin/env bash
# Regenerates cfg/*.cfg. Columns: name, AllowAbort, FailureOrder, Mutations, invariants, properties.
cd "$(dirname "$0")"
SAFE="TypeOK S1 S2 S3 S4 S6 S7"; LIVE="S5 L1"
mk() { { echo "SPECIFICATION Spec"; echo "CONSTANTS"; cat cfg/_common.inc
         echo "  AllowAbort = $2"; echo "  FailureOrder = \"$3\""; echo "  Mutations = $4"
         echo "INVARIANTS $5"; if [ -n "${6:-}" ]; then echo "PROPERTIES $6"; fi; } > "cfg/$1.cfg"; }
# The design as decided (timestamps for G2), then variants that isolate each finding
mk base               TRUE  timestamp '{}' "$SAFE" "$LIVE"
mk counter            TRUE  counter   '{}' "$SAFE" "$LIVE"
mk counter-noabort    FALSE counter   '{}' "$SAFE" "$LIVE"
mk timestamp-noabort  FALSE timestamp '{}' "$SAFE" "$LIVE"
# Mutations (run against the counter variant without aborts, which passes)
mk mut-a-noLock         FALSE counter '{"noLock"}'         "$SAFE"
mk mut-b-noRecheck      FALSE counter '{"noRecheck"}'      "$SAFE"
mk mut-c-failAdvances   FALSE counter '{"failAdvances"}'   "TypeOK" "S5"
mk mut-d-txStartTime    FALSE counter '{"txStartTime"}'    "$SAFE"
mk mut-d-txStartTime-ts FALSE timestamp '{"txStartTime"}'  "$SAFE"
mk mut-e-noStartedAtCmp FALSE counter '{"noStartedAtCmp"}' "$SAFE"
mk mut-f-noUserFilter   FALSE counter '{"noUserFilter"}'   "$SAFE"
mk mut-g-boundary       FALSE counter '{"boundary"}'       "$SAFE"
mk mut-h-fallbackError  FALSE counter '{"fallbackError"}'  "$SAFE"
mk mut-i-leakLock       FALSE counter '{"leakLock"}'       "$SAFE" "L1"
mk mut-j-leakLockNoTimeout FALSE counter '{"leakLock","noLockTimeout"}' "$SAFE" "L1"
# Witnesses: each must be VIOLATED, proving the scenario is reachable
for w in WitnessShared WitnessFallback WitnessRetry WitnessWaitCached WitnessRegen; do
  mk "wit-$w" FALSE counter '{}' "$w"
done
# Is S4 the only casualty? (everything except S4)
mk counter-abort-exceptS4     TRUE  counter   '{}' "TypeOK S1 S2 S3 S6 S7" "$LIVE"
mk timestamp-noabort-exceptS4 FALSE timestamp '{}' "TypeOK S1 S2 S3 S6 S7" "$LIVE"
# Does lock_timeout alone keep L1 true when a lock leaks?
mk mut-i-leakLock-L1          FALSE counter   '{"leakLock"}' "TypeOK" "L1"
# Proposed S4' under aborts, for each failure ordering
mk counter-abort-S4committed   TRUE counter   '{}' "S4Committed"
mk timestamp-abort-S4committed TRUE timestamp '{}' "S4Committed"
# Approved design (F1 counter, F2 S4', F3 lock_timeout exempt): everything, aborts on
mk decided                TRUE  counter   '{}' "TypeOK S1 S2 S3 S4Final S6 S7" "$LIVE"
# Non-vacuity of S4Final: the rejected timestamp ordering must still violate it (F1)
mk decided-timestamp-F1   FALSE timestamp '{}' "S4Final"
# Non-vacuity of S4Final: dropping the attemptNo comparison must violate something
mk decided-mut-noCmp      TRUE  counter   '{"noStartedAtCmp"}' "TypeOK S1 S2 S3 S4Final S6 S7"
