#!/usr/bin/env sh
# The Live Activity types are duplicated across the app target (`app-intents/`) and the
# widget target (`targets/widget/`) because @bacons/apple-targets links each folder to
# exactly one target, so there is no shared source folder. Fail if they drift.
set -e

for file in ExpenseCaptureAttributes.swift SaveExpenseCaptureIntent.swift; do
  if ! diff -q "app-intents/$file" "targets/widget/$file" >/dev/null; then
    echo "ERROR: app-intents/$file and targets/widget/$file have drifted; keep them byte-identical." >&2
    exit 1
  fi
done

echo "Swift target parity OK"
