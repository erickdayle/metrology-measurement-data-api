#!/bin/sh

# Extract values from arguments
while [ "$#" -gt 0 ]; do
  case "$1" in
    --recordId) recordId="$2"; shift 2;;
    --projectId) projectId="$2"; shift 2;;
    *) shift;;
  esac
done

# Run node with extracted values
node index.js "$recordId" "$projectId"
