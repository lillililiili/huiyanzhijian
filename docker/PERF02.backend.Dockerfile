# Minimal repair image: retain the verified running backend and replace only
# the two compiled M04 query modules. Context: runtime/perf02/image.
# The base must be tagged from the inspected running image, never a remote tag.
ARG PERF02_BASE_IMAGE
FROM ${PERF02_BASE_IMAGE}
COPY api.js /app/platform/dist/modules/m04-measurements/api.js
COPY storage-api.js /app/platform/dist/modules/m04-measurements/storage-api.js
LABEL huiyan.workpackage="PERF02" huiyan.scope="m04-query-concurrency"
