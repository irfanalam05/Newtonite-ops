FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install
COPY . .
EXPOSE 3000 5173
CMD ["node", "server/src/server.js"]
