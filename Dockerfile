# HydraSmart API — imagem de produção
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Instala só as dependências de produção (serialport é opcional e fica de fora na VPS)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY src ./src

USER node
EXPOSE 3333

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
