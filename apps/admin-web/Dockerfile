FROM node:22-bookworm AS build
WORKDIR /repo/apps/admin-web
COPY apps/admin-web/package.json apps/admin-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/src/ /repo/apps/web/src/
COPY apps/web/public/ /repo/apps/web/public/
COPY apps/admin-web/ ./
ARG VITE_BUSINESS_APP_URL
ARG VITE_ADMIN_APP_URL
ENV VITE_BUSINESS_APP_URL=${VITE_BUSINESS_APP_URL}
ENV VITE_ADMIN_APP_URL=${VITE_ADMIN_APP_URL}
RUN npm run build

FROM nginx:1.27-alpine
ENV API_UPSTREAM=http://host.docker.internal:4192
COPY infra/middleware/nginx/frontend.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/admin-web/dist/ /usr/share/nginx/html/
EXPOSE 80
