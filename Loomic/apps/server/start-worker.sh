#!/bin/sh

cd /www/helstera/apps/server || exit 1
exec node --env-file=/www/.env.local --import tsx ./src/worker.ts
