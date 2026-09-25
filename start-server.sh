#!/bin/bash
fuser -k 3000/tcp 2>/dev/null
sleep 2
cd /c/Users/desti/qa-robot
exec node server.js
