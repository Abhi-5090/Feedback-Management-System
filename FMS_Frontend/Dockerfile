# ── FMS Web image (build with Vite, serve with nginx) ────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Same-origin API: leave VITE_API_URL empty so the app calls "/api", which nginx
# proxies to the api service (keeps the auth cookie first-party).
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
