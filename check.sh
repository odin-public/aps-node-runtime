#!/bin/bash
if iojs -v > /dev/null; then
    echo "Found io.js $(iojs -v)"
else
    echo 'io.js not found. Install it first!'
    exit 1
fi
