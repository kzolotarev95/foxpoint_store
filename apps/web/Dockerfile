FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY apps/web apps/web

RUN npm run build --workspace @foxpoint/web

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
