FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.mjs ./
COPY src ./src
COPY public ./public
RUN mkdir /app/data && chown -R node:node /app
USER node
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
