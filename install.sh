#!/bin/bash
if iojs -v > /dev/null; then
    echo "Found io.js $(iojs -v)"
else
    echo 'io.js not found. Install it first!'
    exit
fi
mkdir -p /usr/share/aps/node
mkdir -p /etc/aps/node-runtime
mkdir -p /var/aps-node

cp -r src /usr/share/aps/node

