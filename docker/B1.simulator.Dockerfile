FROM node:22-bookworm
WORKDIR /app/simulator
COPY tools/simulator/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tools/simulator/tsconfig.json ./
COPY tools/simulator/src ./src
COPY tools/simulator/web ./web
COPY contracts/devices/v1 /app/contracts/devices/v1
ENV CONTRACT_ROOT=/app/contracts
RUN npm run build && mkdir /data && chown node:node /data
USER node
CMD ["node", "dist/cli.js", "status"]
