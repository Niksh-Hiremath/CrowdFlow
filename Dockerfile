# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN groupadd --gid 10001 crowdflow \
    && useradd --uid 10001 --gid crowdflow --create-home --shell /usr/sbin/nologin crowdflow

COPY --from=build --chown=crowdflow:crowdflow /app/package*.json ./
COPY --from=build --chown=crowdflow:crowdflow /app/node_modules ./node_modules
COPY --from=build --chown=crowdflow:crowdflow /app/dist ./dist

USER crowdflow
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT||'7860';fetch(`http://127.0.0.1:${port}/api/health`).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["npm", "start"]
