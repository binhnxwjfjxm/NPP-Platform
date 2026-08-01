FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY bootstrap.js server.js ./
COPY foundation ./foundation

USER node

CMD ["node", "bootstrap.js"]
