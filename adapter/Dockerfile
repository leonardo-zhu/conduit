FROM oven/bun:1.3.11-slim

WORKDIR /app
COPY index.ts globals.d.ts tsconfig.json ./
COPY lib ./lib
COPY proxies ./proxies

USER bun
CMD ["bun", "run", "index.ts"]
