FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY README.md ./

ENV PORT=3000
ENV DATA_FILE=/app/messages.json

EXPOSE 3000

CMD ["node", "server.js"]
