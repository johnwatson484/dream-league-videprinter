ARG PORT=3002
ARG PORT_DEBUG=9229

FROM node:24-alpine AS development

ENV TZ="Europe/London"
ENV NODE_ENV=development

ARG PORT
ARG PORT_DEBUG
ENV PORT=${PORT}
EXPOSE ${PORT} ${PORT_DEBUG}

USER node
WORKDIR /home/node
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .

CMD ["npm", "run", "dev"]

FROM node:24-alpine AS production

ENV TZ="Europe/London"
ENV NODE_ENV=production

USER root
RUN apk add --no-cache curl

WORKDIR /home/node
COPY --from=development --chown=root:root /home/node/package*.json ./
COPY --from=development --chown=root:root /home/node/src ./src/

RUN npm ci --omit=dev

RUN chmod -R a-w /home/node

USER node

ARG PORT=3002
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD ["node", "src/index.ts"]
