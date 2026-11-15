#!/usr/bin/env bash
# Read-only: show what a naive extraction (the one that ran earlier) would have
# produced, vs the correct value. Prints lengths + 32-char hashes only, no secrets.
D=/home/suwajal/agentgames/prover
# What the earlier (broken) awk produced — likely the whole line:
NAIVE=$(sed -nE 's/^PROVER_TOKEN=//p' "$D/.env" | tr -d '[:space:]')
# The correct value (field 2 only):
GOOD=$(grep '^PROVER_TOKEN=' "$D/.env" | cut -d= -f2 | tr -d '[:space:]')
echo "naive_len=${#NAIVE}  naive_hash=$(printf '%s' "$NAIVE" | sha256sum | cut -c1-12)"
echo "good_len=${#GOOD}   good_hash=$(printf '%s' "$GOOD" | sha256sum | cut -c1-12)"
echo "match=$( [ "$NAIVE" = "$GOOD" ] && echo SAME || echo DIFFERENT )"
