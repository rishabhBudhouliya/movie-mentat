--------------------------- MODULE FactGeneration ---------------------------
(***************************************************************************)
(* Movie Memory, Variant A: a 60-second fact cache guarded by a           *)
(* transaction-scoped Postgres advisory lock per (user, movie).          *)
(*                                                                         *)
(* Each request is one HTTP call to the fact endpoint:                     *)
(*   Begin   : open a transaction, read startedAt from the DB clock, and   *)
(*             take the fast path if the last fact is fresh               *)
(*   Lock    : pg_advisory_xact_lock(user, movie), bounded by lock_timeout *)
(*   Recheck : under the lock, re-read the state row: fresh -> cached,     *)
(*             failure newer than startedAt -> shared failure, else gen    *)
(*   Gen     : call OpenAI; commit a success or failure, then release      *)
(*                                                                         *)
(* Ghost (history) variables exist only so the invariants can talk about   *)
(* the past. The code never reads them.                                    *)
(*                                                                         *)
(* Mutations is a set of deliberate bugs, used to prove the invariants are *)
(* not vacuous. It is {} in the real design. See README.md.                *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS Users, Movies, Requests,
          W,            \* freshness window (60 s, scaled)
          GenTimeout,   \* OpenAI timeout (8 s, scaled)
          LockTimeout,  \* Postgres lock_timeout (scaled)
          MaxTime,      \* bound on the clock so the state space is finite
          AllowAbort,   \* rollback (tx timeout) or process death while generating
          FailureOrder, \* "timestamp" (G2 as decided) or "counter" (proposed refinement)
          Mutations     \* {} = the real design

Keys   == Users \X Movies
NoTime == -1
NoFact == [k |-> <<"-", "-">>, at |-> NoTime, trueAt |-> NoTime, by |-> "-"]
NoResp == [kind |-> "none", fact |-> NoFact]
M(x)   == x \in Mutations

(* --algorithm FactGeneration
variables
  clock         = 0,                          \* the single DB clock (decision G1)
  sess          \in [Requests -> Keys],       \* (user, movie) from each request's session
  lockHolder    = [k \in Keys |-> "-"],       \* advisory lock per (user, movie)
  lockQueue     = [k \in Keys |-> <<>>],      \* Postgres grants waiters in arrival order
  lastSuccessAt = [k \in Keys |-> NoTime],    \* per-(user, movie) state row
  failedAt      = [k \in Keys |-> NoTime],    \* per-(user, movie) state row
  attemptNo     = [k \in Keys |-> 0],         \* "counter" only: finished attempts
  failedNo      = [k \in Keys |-> 0],         \* "counter" only: attemptNo of last failure
  seenNo        = [r \in Requests |-> 0],     \* "counter" only: attemptNo read at Begin
  facts         = {},                         \* Fact table
  resp          = [r \in Requests |-> NoResp],
  txStart       = [r \in Requests |-> NoTime],
  startedAt     = [r \in Requests |-> NoTime],
  genStart      = [r \in Requests |-> NoTime],
  \* ---- ghost variables ----
  trueLast      = [k \in Keys |-> NoTime],    \* real time of the last successful commit
  decided       = [r \in Requests |-> "none"],
  genAge        = [r \in Requests |-> NoTime],
  cacheAge      = [r \in Requests |-> NoTime],
  ghostLatest   = [r \in Requests |-> NoFact],
  overlapped    = [r \in Requests |-> {}],     \* attempts in flight while r was undecided
  failSince     = [r \in Requests |-> FALSE],  \* a failure committed while r was undecided
  attemptSeq    = [r \in Requests |-> 0],
  outcome       = [r \in Requests |-> "none"],
  nextSeq       = 1;

define
  K(r)     == sess[r]
  \* G1: the code reads clock_timestamp(). The txStartTime mutation uses now() instead.
  DbNow(r) == IF M("txStartTime") THEN txStart[r] ELSE clock

  Fresh(k, now) ==
    /\ lastSuccessAt[k] # NoTime
    /\ IF M("boundary") THEN now - lastSuccessAt[k] <= W
                        ELSE now - lastSuccessAt[k] <  W

  \* G2: share a failure only if it committed after this request started.
  SharedFailure(r) ==
    IF FailureOrder = "timestamp"
      THEN /\ failedAt[K(r)] # NoTime
           /\ (M("noStartedAtCmp") \/ failedAt[K(r)] > startedAt[r])
      ELSE /\ failedNo[K(r)] # 0
           /\ (M("noStartedAtCmp") \/ failedNo[K(r)] > seenNo[r])

  LatestAt(S)     == IF S = {} THEN NoFact ELSE CHOOSE f \in S : \A g \in S : g.at <= f.at
  LatestTrueAt(S) == IF S = {} THEN NoFact ELSE CHOOSE f \in S : \A g \in S : g.trueAt <= f.trueAt

  \* What the code's query returns ...
  QueryFacts(r) == {f \in facts : IF M("noUserFilter") THEN f.k[2] = K(r)[2] ELSE f.k = K(r)}
  CodeLatest(r) == LatestAt(QueryFacts(r))
  \* ... and what it should return (ghost, used only by S6).
  TrueLatest(r) == LatestTrueAt({f \in facts : f.k = K(r)})

  FailResp(r) ==
    IF M("fallbackError") \/ CodeLatest(r) = NoFact
      THEN [kind |-> "error",    fact |-> NoFact]
      ELSE [kind |-> "fallback", fact |-> CodeLatest(r)]

  Without(q, r) == SelectSeq(q, LAMBDA x : x # r)
  Age(k) == IF trueLast[k] = NoTime THEN NoTime ELSE clock - trueLast[k]
  Undecided(x, k) == pc[x] \in {"Lock", "Recheck"} /\ sess[x] = k
end define;

fair process req \in Requests
begin
Begin:
  txStart[self] := clock;
  startedAt[self] := clock;
  seenNo[self] := attemptNo[K(self)];
  overlapped[self] := {g \in Requests : g # self /\ pc[g] = "Gen" /\ sess[g] = K(self)};
  if Fresh(K(self), clock) then
    decided[self] := "cached";
    cacheAge[self] := Age(K(self));
    resp[self] := [kind |-> "cached", fact |-> CodeLatest(self)];
    goto Done;
  else
    lockQueue[K(self)] := Append(lockQueue[K(self)], self);
  end if;
Lock:
  either
    await \/ lockHolder[K(self)] = "-" /\ Head(lockQueue[K(self)]) = self
          \/ M("noLock");
    lockHolder[K(self)] := self;
    lockQueue[K(self)] := Without(lockQueue[K(self)], self);
  or
    await ~M("noLockTimeout") /\ clock - txStart[self] >= LockTimeout;
    lockQueue[K(self)] := Without(lockQueue[K(self)], self);
    decided[self] := "lockTimeout";
    ghostLatest[self] := TrueLatest(self);
    resp[self] := FailResp(self);
    goto Done;
  end either;
Recheck:
  if ~M("noRecheck") /\ Fresh(K(self), DbNow(self)) then
    decided[self] := "cached";
    cacheAge[self] := Age(K(self));
    resp[self] := [kind |-> "cached", fact |-> CodeLatest(self)];
    lockHolder[K(self)] := "-";
    goto Done;
  elsif SharedFailure(self) then
    decided[self] := "shared";
    ghostLatest[self] := TrueLatest(self);
    resp[self] := FailResp(self);
    lockHolder[K(self)] := "-";
    goto Done;
  else
    decided[self] := "gen";
    genAge[self] := Age(K(self));
    genStart[self] := clock;
    attemptSeq[self] := nextSeq;
    nextSeq := nextSeq + 1;
    overlapped := [x \in Requests |->
                     IF x # self /\ Undecided(x, K(self))
                       THEN overlapped[x] \cup {self} ELSE overlapped[x]];
  end if;
Gen:
  either \* OpenAI succeeded: persist the fact and return it
    facts := facts \cup {[k |-> K(self), at |-> DbNow(self), trueAt |-> clock, by |-> self]};
    lastSuccessAt[K(self)] := DbNow(self);
    trueLast[K(self)] := clock;
    attemptNo[K(self)] := attemptNo[K(self)] + 1;
    outcome[self] := "success";
    resp[self] := [kind |-> "fresh",
                   fact |-> [k |-> K(self), at |-> DbNow(self), trueAt |-> clock, by |-> self]];
    lockHolder[K(self)] := "-";
  or \* OpenAI error, timeout or abstention: commit failedAt, then release
    failedAt[K(self)] := DbNow(self);
    attemptNo[K(self)] := attemptNo[K(self)] + 1;
    failedNo[K(self)] := attemptNo[K(self)];  \* the value just incremented
    if M("failAdvances") then lastSuccessAt[K(self)] := DbNow(self) end if;
    outcome[self] := "failure";
    failSince := [x \in Requests |->
                    IF x # self /\ Undecided(x, K(self)) THEN TRUE ELSE failSince[x]];
    ghostLatest[self] := TrueLatest(self);
    resp[self] := FailResp(self);
    if ~M("leakLock") then lockHolder[K(self)] := "-" end if;
  or \* transaction timeout: rollback releases the lock, our catch block responds
    await AllowAbort;
    outcome[self] := "aborted";
    ghostLatest[self] := TrueLatest(self);
    resp[self] := FailResp(self);
    lockHolder[K(self)] := "-";
  or \* process killed: Postgres drops the connection, which releases the lock
    await AllowAbort;
    outcome[self] := "aborted";
    resp[self] := [kind |-> "crash", fact |-> NoFact];
    lockHolder[K(self)] := "-";
  end either;
end process;

fair process clk = "clock"
begin
Tick:
  while clock < MaxTime do
    \* time cannot pass beyond the OpenAI timeout or the lock_timeout
    await \A r \in Requests :
            /\ (pc[r] = "Gen"  => clock - genStart[r] < GenTimeout)
            /\ (pc[r] = "Lock" => (M("noLockTimeout") \/ clock - txStart[r] < LockTimeout))
            \* the recheck is a millisecond read: no time passes there
            /\ pc[r] # "Recheck"
            \* every request arrives early enough for its lock_timeout to fire
            \* before the time horizon (a bound of the model, not of the design)
            /\ (clock >= MaxTime - LockTimeout => pc[r] # "Begin");
    \* a free lock with waiters is granted immediately
    await \A k \in Keys : lockHolder[k] = "-" => lockQueue[k] = <<>>;
    clock := clock + 1;
  end while;
end process;

end algorithm; *)
\* BEGIN TRANSLATION
VARIABLES clock, sess, lockHolder, lockQueue, lastSuccessAt, failedAt, 
          attemptNo, failedNo, seenNo, facts, resp, txStart, startedAt, 
          genStart, trueLast, decided, genAge, cacheAge, ghostLatest, 
          overlapped, failSince, attemptSeq, outcome, nextSeq, pc

(* define statement *)
K(r)     == sess[r]

DbNow(r) == IF M("txStartTime") THEN txStart[r] ELSE clock

Fresh(k, now) ==
  /\ lastSuccessAt[k] # NoTime
  /\ IF M("boundary") THEN now - lastSuccessAt[k] <= W
                      ELSE now - lastSuccessAt[k] <  W


SharedFailure(r) ==
  IF FailureOrder = "timestamp"
    THEN /\ failedAt[K(r)] # NoTime
         /\ (M("noStartedAtCmp") \/ failedAt[K(r)] > startedAt[r])
    ELSE /\ failedNo[K(r)] # 0
         /\ (M("noStartedAtCmp") \/ failedNo[K(r)] > seenNo[r])

LatestAt(S)     == IF S = {} THEN NoFact ELSE CHOOSE f \in S : \A g \in S : g.at <= f.at
LatestTrueAt(S) == IF S = {} THEN NoFact ELSE CHOOSE f \in S : \A g \in S : g.trueAt <= f.trueAt


QueryFacts(r) == {f \in facts : IF M("noUserFilter") THEN f.k[2] = K(r)[2] ELSE f.k = K(r)}
CodeLatest(r) == LatestAt(QueryFacts(r))

TrueLatest(r) == LatestTrueAt({f \in facts : f.k = K(r)})

FailResp(r) ==
  IF M("fallbackError") \/ CodeLatest(r) = NoFact
    THEN [kind |-> "error",    fact |-> NoFact]
    ELSE [kind |-> "fallback", fact |-> CodeLatest(r)]

Without(q, r) == SelectSeq(q, LAMBDA x : x # r)
Age(k) == IF trueLast[k] = NoTime THEN NoTime ELSE clock - trueLast[k]
Undecided(x, k) == pc[x] \in {"Lock", "Recheck"} /\ sess[x] = k


vars == << clock, sess, lockHolder, lockQueue, lastSuccessAt, failedAt, 
           attemptNo, failedNo, seenNo, facts, resp, txStart, startedAt, 
           genStart, trueLast, decided, genAge, cacheAge, ghostLatest, 
           overlapped, failSince, attemptSeq, outcome, nextSeq, pc >>

ProcSet == (Requests) \cup {"clock"}

Init == (* Global variables *)
        /\ clock = 0
        /\ sess \in [Requests -> Keys]
        /\ lockHolder = [k \in Keys |-> "-"]
        /\ lockQueue = [k \in Keys |-> <<>>]
        /\ lastSuccessAt = [k \in Keys |-> NoTime]
        /\ failedAt = [k \in Keys |-> NoTime]
        /\ attemptNo = [k \in Keys |-> 0]
        /\ failedNo = [k \in Keys |-> 0]
        /\ seenNo = [r \in Requests |-> 0]
        /\ facts = {}
        /\ resp = [r \in Requests |-> NoResp]
        /\ txStart = [r \in Requests |-> NoTime]
        /\ startedAt = [r \in Requests |-> NoTime]
        /\ genStart = [r \in Requests |-> NoTime]
        /\ trueLast = [k \in Keys |-> NoTime]
        /\ decided = [r \in Requests |-> "none"]
        /\ genAge = [r \in Requests |-> NoTime]
        /\ cacheAge = [r \in Requests |-> NoTime]
        /\ ghostLatest = [r \in Requests |-> NoFact]
        /\ overlapped = [r \in Requests |-> {}]
        /\ failSince = [r \in Requests |-> FALSE]
        /\ attemptSeq = [r \in Requests |-> 0]
        /\ outcome = [r \in Requests |-> "none"]
        /\ nextSeq = 1
        /\ pc = [self \in ProcSet |-> CASE self \in Requests -> "Begin"
                                        [] self = "clock" -> "Tick"]

Begin(self) == /\ pc[self] = "Begin"
               /\ txStart' = [txStart EXCEPT ![self] = clock]
               /\ startedAt' = [startedAt EXCEPT ![self] = clock]
               /\ seenNo' = [seenNo EXCEPT ![self] = attemptNo[K(self)]]
               /\ overlapped' = [overlapped EXCEPT ![self] = {g \in Requests : g # self /\ pc[g] = "Gen" /\ sess[g] = K(self)}]
               /\ IF Fresh(K(self), clock)
                     THEN /\ decided' = [decided EXCEPT ![self] = "cached"]
                          /\ cacheAge' = [cacheAge EXCEPT ![self] = Age(K(self))]
                          /\ resp' = [resp EXCEPT ![self] = [kind |-> "cached", fact |-> CodeLatest(self)]]
                          /\ pc' = [pc EXCEPT ![self] = "Done"]
                          /\ UNCHANGED lockQueue
                     ELSE /\ lockQueue' = [lockQueue EXCEPT ![K(self)] = Append(lockQueue[K(self)], self)]
                          /\ pc' = [pc EXCEPT ![self] = "Lock"]
                          /\ UNCHANGED << resp, decided, cacheAge >>
               /\ UNCHANGED << clock, sess, lockHolder, lastSuccessAt, 
                               failedAt, attemptNo, failedNo, facts, genStart, 
                               trueLast, genAge, ghostLatest, failSince, 
                               attemptSeq, outcome, nextSeq >>

Lock(self) == /\ pc[self] = "Lock"
              /\ \/ /\ \/ lockHolder[K(self)] = "-" /\ Head(lockQueue[K(self)]) = self
                       \/ M("noLock")
                    /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = self]
                    /\ lockQueue' = [lockQueue EXCEPT ![K(self)] = Without(lockQueue[K(self)], self)]
                    /\ pc' = [pc EXCEPT ![self] = "Recheck"]
                    /\ UNCHANGED <<resp, decided, ghostLatest>>
                 \/ /\ ~M("noLockTimeout") /\ clock - txStart[self] >= LockTimeout
                    /\ lockQueue' = [lockQueue EXCEPT ![K(self)] = Without(lockQueue[K(self)], self)]
                    /\ decided' = [decided EXCEPT ![self] = "lockTimeout"]
                    /\ ghostLatest' = [ghostLatest EXCEPT ![self] = TrueLatest(self)]
                    /\ resp' = [resp EXCEPT ![self] = FailResp(self)]
                    /\ pc' = [pc EXCEPT ![self] = "Done"]
                    /\ UNCHANGED lockHolder
              /\ UNCHANGED << clock, sess, lastSuccessAt, failedAt, attemptNo, 
                              failedNo, seenNo, facts, txStart, startedAt, 
                              genStart, trueLast, genAge, cacheAge, overlapped, 
                              failSince, attemptSeq, outcome, nextSeq >>

Recheck(self) == /\ pc[self] = "Recheck"
                 /\ IF ~M("noRecheck") /\ Fresh(K(self), DbNow(self))
                       THEN /\ decided' = [decided EXCEPT ![self] = "cached"]
                            /\ cacheAge' = [cacheAge EXCEPT ![self] = Age(K(self))]
                            /\ resp' = [resp EXCEPT ![self] = [kind |-> "cached", fact |-> CodeLatest(self)]]
                            /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                            /\ pc' = [pc EXCEPT ![self] = "Done"]
                            /\ UNCHANGED << genStart, genAge, ghostLatest, 
                                            overlapped, attemptSeq, nextSeq >>
                       ELSE /\ IF SharedFailure(self)
                                  THEN /\ decided' = [decided EXCEPT ![self] = "shared"]
                                       /\ ghostLatest' = [ghostLatest EXCEPT ![self] = TrueLatest(self)]
                                       /\ resp' = [resp EXCEPT ![self] = FailResp(self)]
                                       /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                                       /\ pc' = [pc EXCEPT ![self] = "Done"]
                                       /\ UNCHANGED << genStart, genAge, 
                                                       overlapped, attemptSeq, 
                                                       nextSeq >>
                                  ELSE /\ decided' = [decided EXCEPT ![self] = "gen"]
                                       /\ genAge' = [genAge EXCEPT ![self] = Age(K(self))]
                                       /\ genStart' = [genStart EXCEPT ![self] = clock]
                                       /\ attemptSeq' = [attemptSeq EXCEPT ![self] = nextSeq]
                                       /\ nextSeq' = nextSeq + 1
                                       /\ overlapped' = [x \in Requests |->
                                                           IF x # self /\ Undecided(x, K(self))
                                                             THEN overlapped[x] \cup {self} ELSE overlapped[x]]
                                       /\ pc' = [pc EXCEPT ![self] = "Gen"]
                                       /\ UNCHANGED << lockHolder, resp, 
                                                       ghostLatest >>
                            /\ UNCHANGED cacheAge
                 /\ UNCHANGED << clock, sess, lockQueue, lastSuccessAt, 
                                 failedAt, attemptNo, failedNo, seenNo, facts, 
                                 txStart, startedAt, trueLast, failSince, 
                                 outcome >>

Gen(self) == /\ pc[self] = "Gen"
             /\ \/ /\ facts' = (facts \cup {[k |-> K(self), at |-> DbNow(self), trueAt |-> clock, by |-> self]})
                   /\ lastSuccessAt' = [lastSuccessAt EXCEPT ![K(self)] = DbNow(self)]
                   /\ trueLast' = [trueLast EXCEPT ![K(self)] = clock]
                   /\ attemptNo' = [attemptNo EXCEPT ![K(self)] = attemptNo[K(self)] + 1]
                   /\ outcome' = [outcome EXCEPT ![self] = "success"]
                   /\ resp' = [resp EXCEPT ![self] = [kind |-> "fresh",
                                                      fact |-> [k |-> K(self), at |-> DbNow(self), trueAt |-> clock, by |-> self]]]
                   /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                   /\ UNCHANGED <<failedAt, failedNo, ghostLatest, failSince>>
                \/ /\ failedAt' = [failedAt EXCEPT ![K(self)] = DbNow(self)]
                   /\ attemptNo' = [attemptNo EXCEPT ![K(self)] = attemptNo[K(self)] + 1]
                   /\ failedNo' = [failedNo EXCEPT ![K(self)] = attemptNo'[K(self)]]
                   /\ IF M("failAdvances")
                         THEN /\ lastSuccessAt' = [lastSuccessAt EXCEPT ![K(self)] = DbNow(self)]
                         ELSE /\ TRUE
                              /\ UNCHANGED lastSuccessAt
                   /\ outcome' = [outcome EXCEPT ![self] = "failure"]
                   /\ failSince' = [x \in Requests |->
                                      IF x # self /\ Undecided(x, K(self)) THEN TRUE ELSE failSince[x]]
                   /\ ghostLatest' = [ghostLatest EXCEPT ![self] = TrueLatest(self)]
                   /\ resp' = [resp EXCEPT ![self] = FailResp(self)]
                   /\ IF ~M("leakLock")
                         THEN /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                         ELSE /\ TRUE
                              /\ UNCHANGED lockHolder
                   /\ UNCHANGED <<facts, trueLast>>
                \/ /\ AllowAbort
                   /\ outcome' = [outcome EXCEPT ![self] = "aborted"]
                   /\ ghostLatest' = [ghostLatest EXCEPT ![self] = TrueLatest(self)]
                   /\ resp' = [resp EXCEPT ![self] = FailResp(self)]
                   /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                   /\ UNCHANGED <<lastSuccessAt, failedAt, attemptNo, failedNo, facts, trueLast, failSince>>
                \/ /\ AllowAbort
                   /\ outcome' = [outcome EXCEPT ![self] = "aborted"]
                   /\ resp' = [resp EXCEPT ![self] = [kind |-> "crash", fact |-> NoFact]]
                   /\ lockHolder' = [lockHolder EXCEPT ![K(self)] = "-"]
                   /\ UNCHANGED <<lastSuccessAt, failedAt, attemptNo, failedNo, facts, trueLast, ghostLatest, failSince>>
             /\ pc' = [pc EXCEPT ![self] = "Done"]
             /\ UNCHANGED << clock, sess, lockQueue, seenNo, txStart, 
                             startedAt, genStart, decided, genAge, cacheAge, 
                             overlapped, attemptSeq, nextSeq >>

req(self) == Begin(self) \/ Lock(self) \/ Recheck(self) \/ Gen(self)

Tick == /\ pc["clock"] = "Tick"
        /\ IF clock < MaxTime
              THEN /\ \A r \in Requests :
                        /\ (pc[r] = "Gen"  => clock - genStart[r] < GenTimeout)
                        /\ (pc[r] = "Lock" => (M("noLockTimeout") \/ clock - txStart[r] < LockTimeout))
                      
                        /\ pc[r] # "Recheck"
                      
                      
                        /\ (clock >= MaxTime - LockTimeout => pc[r] # "Begin")
                   /\ \A k \in Keys : lockHolder[k] = "-" => lockQueue[k] = <<>>
                   /\ clock' = clock + 1
                   /\ pc' = [pc EXCEPT !["clock"] = "Tick"]
              ELSE /\ pc' = [pc EXCEPT !["clock"] = "Done"]
                   /\ clock' = clock
        /\ UNCHANGED << sess, lockHolder, lockQueue, lastSuccessAt, failedAt, 
                        attemptNo, failedNo, seenNo, facts, resp, txStart, 
                        startedAt, genStart, trueLast, decided, genAge, 
                        cacheAge, ghostLatest, overlapped, failSince, 
                        attemptSeq, outcome, nextSeq >>

clk == Tick

(* Allow infinite stuttering to prevent deadlock on termination. *)
Terminating == /\ \A self \in ProcSet: pc[self] = "Done"
               /\ UNCHANGED vars

Next == clk
           \/ (\E self \in Requests: req(self))
           \/ Terminating

Spec == /\ Init /\ [][Next]_vars
        /\ \A self \in Requests : WF_vars(req(self))
        /\ WF_vars(clk)

Termination == <>(\A self \in ProcSet: pc[self] = "Done")

\* END TRANSLATION
-----------------------------------------------------------------------------
TypeOK ==
  /\ clock \in 0..MaxTime
  /\ lockHolder \in [Keys -> Requests \cup {"-"}]
  /\ decided \in [Requests -> {"none", "cached", "shared", "gen", "lockTimeout"}]
  /\ resp \in [Requests -> [kind : {"none", "cached", "fresh", "fallback", "error", "crash"},
                            fact : {NoFact} \cup facts]]

\* S1: a response only ever carries a fact for its own session (user, movie).
S1 == \A r \in Requests : resp[r].fact # NoFact => resp[r].fact.k = sess[r]

\* S2: at most one generation in flight per (user, movie).
S2 == \A k \in Keys : Cardinality({r \in Requests : pc[r] = "Gen" /\ sess[r] = k}) <= 1

\* S3: generation starts only at age >= W (or with no prior fact),
\*     and a cached response is always younger than W, measured by the real clock.
S3 == \A r \in Requests :
        /\ (decided[r] = "gen"    => (genAge[r] = NoTime \/ genAge[r] >= W))
        /\ (decided[r] = "cached" => (cacheAge[r] # NoTime /\ cacheAge[r] < W))

\* S4: a request that was undecided while an attempt ran never starts its own,
\*     and it gets the outcome of the latest such attempt.
LastAttempt(r) == CHOOSE g \in overlapped[r] : \A h \in overlapped[r] : attemptSeq[h] <= attemptSeq[g]
S4 == \A r \in Requests :
        /\ (decided[r] = "gen" => overlapped[r] = {})
        /\ ((decided[r] \notin {"none", "gen"} /\ overlapped[r] # {}) =>
              LET g == LastAttempt(r) IN
                /\ (outcome[g] = "success" => (decided[r] = "cached" /\ resp[r].fact.by = g))
                /\ (outcome[g] = "failure" => decided[r] = "shared"))

\* S4' (F2, approved): as S4, but an attempt whose transaction rolled back
\*     or whose process died committed no outcome, so a waiter may start its own.
S4CommittedFor(r) ==
        /\ (decided[r] = "gen" => \A g \in overlapped[r] : outcome[g] = "aborted")
        /\ ((decided[r] \notin {"none", "gen"} /\ overlapped[r] # {}) =>
              LET g == LastAttempt(r) IN
                /\ (outcome[g] = "success" => (decided[r] = "cached" /\ resp[r].fact.by = g))
                /\ (outcome[g] = "failure" => decided[r] = "shared"))
S4Committed == \A r \in Requests : S4CommittedFor(r)

\* S4'' (F3, approved): the invariant the design is held to. A lock_timeout
\*     response is exempt from S4'; S6 still constrains what it returns.
S4Final == \A r \in Requests : decided[r] # "lockTimeout" => S4CommittedFor(r)

\* S5: lastSuccessAt changes only when a fact is saved with that timestamp.
S5 == [][\A k \in Keys : lastSuccessAt'[k] # lastSuccessAt[k] =>
           \E f \in facts' \ facts : f.k = k /\ f.at = lastSuccessAt'[k]]_vars

\* S6: a failure response is the latest saved fact for (user, movie), else an error.
S6 == \A r \in Requests :
        /\ (resp[r].kind = "fallback" => (ghostLatest[r] # NoFact /\ resp[r].fact = ghostLatest[r]))
        /\ (resp[r].kind = "error"    => ghostLatest[r] = NoFact)

\* S7: a request shares a failure only if that failure committed after it arrived.
\*     So a request arriving after a failure, with no fresh fact, starts a new attempt.
S7 == \A r \in Requests : decided[r] = "shared" => failSince[r]

\* L1: every request terminates with a response.
L1 == \A r \in Requests : <>(pc[r] = "Done" /\ resp[r].kind # "none")

\* Witnesses: each is EXPECTED to be violated, which proves the scenario is reachable.
WitnessShared     == \A r \in Requests : decided[r] # "shared"
WitnessFallback   == \A r \in Requests : resp[r].kind # "fallback"
WitnessRetry      == \A r \in Requests : ~(decided[r] = "gen" /\ failedAt[sess[r]] # NoTime)
WitnessWaitCached == \A r \in Requests : ~(decided[r] = "cached" /\ overlapped[r] # {})
WitnessRegen      == \A r \in Requests : ~(decided[r] = "gen" /\ genAge[r] # NoTime)
=============================================================================
