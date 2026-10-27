FROM node:22-bookworm AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
ARG VITE_ADMIN_APP_URL
ARG VITE_BUSINESS_APP_URL
ENV VITE_ADMIN_APP_URL=${VITE_ADMIN_APP_URL}
ENV VITE_BUSINESS_APP_URL=${VITE_BUSINESS_APP_URL}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
ENV API_UPSTREAM=http://host.docker.internal:4192
COPY infra/middleware/nginx/frontend.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80

