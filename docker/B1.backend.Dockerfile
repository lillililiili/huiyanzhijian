FROM node:22-bookworm AS build
WORKDIR /app/platform
COPY apps/platform/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/platform/tsconfig.json ./
COPY apps/platform/composition ./composition
COPY apps/platform/infrastructure ./infrastructure
COPY apps/platform/modules ./modules
COPY apps/platform/db ./db
COPY apps/platform/config ./config
RUN npm run build
COPY contracts/devices/v1 /app/contracts/devices/v1
ENV CONTRACT_ROOT=/app/contracts
USER node
CMD ["node", "dist/composition/supervisor.js"]
