FROM node:22-slim
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev
COPY server server
COPY web web
ENV DB_PATH=/data/owpuzzle.db
EXPOSE 8080
CMD ["node", "server/index.js"]
