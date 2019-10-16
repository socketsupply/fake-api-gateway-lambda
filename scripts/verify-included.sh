#!/usr/bin/env bash
set -e

find test \
    -name '*.ts' \
    -not -path 'test/lib/*' \
    -not -path 'test/index.ts' |
    sed s/\.ts// |
while read FILE; do
    if ! grep -q "import.*\./${FILE#*/}" test/index.ts ; then
        echo "Could not find $FILE" >&2
        exit 1
    fi
done

echo "All tests included!"
