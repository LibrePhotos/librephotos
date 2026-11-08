# The report mail bridge: one compiled Bun binary on Debian slim, which keeps
# /bin/sh for Coolify's health check. Builds natively on amd64 and arm64.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production \
 && bun test \
 && bun build --compile --bytecode --minify src/main.ts --outfile /report-mail-bridge

FROM debian:13.7-slim
COPY --from=build /report-mail-bridge /usr/local/bin/report-mail-bridge
RUN mkdir /data && chown 65532:65532 /data
USER 65532:65532
ENV DATABASE=/data/bridge.sqlite HTTP_PORT=3000 SMTP_PORT=2525
EXPOSE 3000 2525
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["report-mail-bridge", "health"]
ENTRYPOINT ["report-mail-bridge"]
