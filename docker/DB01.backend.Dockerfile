# Incremental image; base must be the inspected current backend image.
# Context: runtime/db01/image, compiled from the DB01 worktree.
ARG DB01_BASE_IMAGE
FROM ${DB01_BASE_IMAGE}
COPY dist/ /app/platform/dist/
COPY db/migrations/ /app/platform/db/migrations/
LABEL huiyan.workpackage="DB01" huiyan.scope="startup-permissions-migration-consistency"
