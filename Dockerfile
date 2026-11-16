# Build the parent dashboard and the API in one image.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY parent-app/package.json parent-app/
RUN npm ci || npm install
COPY shared shared
COPY server server
COPY parent-app parent-app
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY parent-app/package.json parent-app/
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/src/db/migrations server/dist/db/migrations
COPY --from=build /app/parent-app/dist parent-app/dist
USER node
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
