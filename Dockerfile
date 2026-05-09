FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src

COPY admin/package.json admin/package-lock.json ./admin/
RUN cd admin && npm ci

COPY admin/index.html ./admin/index.html
COPY admin/tsconfig.json ./admin/tsconfig.json
COPY admin/vite.config.ts ./admin/vite.config.ts
COPY admin/src ./admin/src

RUN npm run build && cd admin && npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
