FROM node:24.17.0-bookworm-slim
COPY --chmod=755 obs-efir-linux-x64 /usr/local/bin/obs-efir
USER node
ENTRYPOINT ["/usr/local/bin/obs-efir"]
