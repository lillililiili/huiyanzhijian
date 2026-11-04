FROM huiyan-backend:ht03-base-20261103
COPY apps/platform/dist/modules/m02-tasks/api.js /app/platform/dist/modules/m02-tasks/api.js
COPY apps/platform/dist/modules/m02-tasks/associations.js /app/platform/dist/modules/m02-tasks/associations.js
COPY apps/platform/dist/modules/m02-tasks/production.js /app/platform/dist/modules/m02-tasks/production.js
COPY apps/platform/dist/modules/m02-tasks/queries.js /app/platform/dist/modules/m02-tasks/queries.js
COPY apps/platform/dist/modules/m02-tasks/scan-lifecycle.js /app/platform/dist/modules/m02-tasks/scan-lifecycle.js
COPY apps/platform/dist/modules/m02-tasks/simulation.js /app/platform/dist/modules/m02-tasks/simulation.js
COPY apps/platform/dist/modules/m02-tasks/task-labels.js /app/platform/dist/modules/m02-tasks/task-labels.js
COPY apps/platform/dist/modules/m03-rules/api.js /app/platform/dist/modules/m03-rules/api.js
COPY apps/platform/dist/modules/m04-measurements/api.js /app/platform/dist/modules/m04-measurements/api.js
COPY apps/platform/dist/modules/m04-measurements/import.js /app/platform/dist/modules/m04-measurements/import.js
COPY apps/platform/dist/modules/m06-quality/service.js /app/platform/dist/modules/m06-quality/service.js
COPY apps/platform/dist/modules/m02-tasks/paired.js /app/platform/dist/modules/m02-tasks/paired.js
COPY apps/platform/dist/modules/m04-measurements/paired.js /app/platform/dist/modules/m04-measurements/paired.js
COPY apps/platform/dist/db/backfill-sheath-tasks.js /app/platform/dist/db/backfill-sheath-tasks.js
COPY apps/platform/db/migrations/016c_paired_sheath_tasks.sql /app/platform/db/migrations/016c_paired_sheath_tasks.sql
COPY apps/platform/db/migrations/016d_sheath_report_pending.sql /app/platform/db/migrations/016d_sheath_report_pending.sql

