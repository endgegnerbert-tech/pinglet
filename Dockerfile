FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY pinglet-server.ts pinglet.ts pinglet-cli.ts postinstall.mjs ./
RUN npm ci && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
ENV PORT=3456
ENV PINGLET_DATA_DIR=/data
EXPOSE 3456
CMD ["node", "dist/pinglet-server.js"]
