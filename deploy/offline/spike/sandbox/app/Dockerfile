# SANDBOX SPIKE ONLY: unchanged v1.2.1 app (standalone output added in the sandbox copy),
# built with synthetic spike values. Not the Phase 3 image.
FROM tybc-spike/node:22
COPY --chown=nobody:nogroup app /app
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Bangkok
USER nobody
EXPOSE 3000
CMD ["node", "server.js"]
