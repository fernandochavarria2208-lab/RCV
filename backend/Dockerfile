# ---- build (instala deps) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# ---- runtime (ligero) ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app

# Cloud Run inyecta PORT; Express debe escuchar en 0.0.0.0:PORT
EXPOSE 8080
CMD ["node","server.js"]
