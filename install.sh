#!/bin/bash

useradd -r -d /var/aps-node -s /sbin/nologin aps-node
chown -R aps-node:aps-node /usr/share/aps/node /etc/aps/node-runtime /var/aps-node
chmod -R 0755 /usr/share/aps/node /etc/aps/node-runtime /var/aps-node
