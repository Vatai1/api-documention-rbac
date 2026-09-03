# ── API Портал: production-образ ──
FROM node:20-alpine AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
COPY corp-ca.pem /certs/corp-ca.pem
ENV NODE_EXTRA_CA_CERTS=/certs/corp-ca.pem
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
COPY corp-ca.pem /certs/corp-ca.pem
ENV NODE_EXTRA_CA_CERTS=/certs/corp-ca.pem
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js parse-docx.js data.json ./
COPY --from=build /app/dist ./dist
EXPOSE 3010
CMD ["node", "server.js"]
