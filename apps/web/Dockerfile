FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY packages/api-client ./packages/api-client
RUN pnpm --filter @rightsrader/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@rightsrader/web", "exec", "next", "start", "--hostname", "0.0.0.0"]
