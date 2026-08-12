FROM node:20-alpine

WORKDIR /repo

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY mcp/apps/backend/package.json mcp/apps/backend/package-lock.json ./mcp/apps/backend/
COPY packages/contracts ./packages/contracts

WORKDIR /repo/mcp/apps/backend
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY mcp/apps/backend/bootstrap.js mcp/apps/backend/server.js ./
COPY mcp/apps/backend/foundation ./foundation

USER node

CMD ["node", "bootstrap.js"]
