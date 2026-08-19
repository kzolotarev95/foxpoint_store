FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma

RUN npm install
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

COPY apps/api apps/api

RUN npm run build --workspace @foxpoint/api
RUN npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json apps/api/package.json
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/db/prisma packages/db/prisma

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
