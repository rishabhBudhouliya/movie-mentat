#!/usr/bin/env bash
# Usage: ./run.sh <cfg-name>   e.g. ./run.sh base
set -uo pipefail
cd "$(dirname "$0")"
java -XX:+UseParallelGC -cp tools/tla2tools.jar tlc2.TLC -workers auto \
  -config "cfg/$1.cfg" -metadir "states/$1" FactGeneration.tla 2>&1 | python3 trace.py "$1"
