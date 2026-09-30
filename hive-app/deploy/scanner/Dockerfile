# The HIVE quarantine scanner runner (WO-015): the ClamAV lane's puller,
# built from the repository's own scripts and nothing else — no npm
# install, no dependency, the node runtime the app itself pins.
#
# Build from the app root, so the COPY paths are the repository's:
#   docker build -f deploy/scanner/Dockerfile -t hive-scanner-runner .
#
# The image carries the manifest of the two hosted projects: the runner
# refuses any other origin. It carries no key: the project's secret key
# reaches the container through its environment at run time, from the
# host's secret store, never from a file in the image.
FROM node:22.23.2-alpine

WORKDIR /app
COPY scripts/scanner-runner.mjs scripts/scanner-runner.mjs
COPY scripts/lib/clamav.mjs \
     scripts/lib/scan-pipeline.mjs \
     scripts/lib/scanner-config.mjs \
     scripts/lib/hosted-targets.mjs \
     scripts/lib/
COPY security/hosted-targets.json security/hosted-targets.json

ENV NODE_ENV=production
USER node
CMD ["node", "scripts/scanner-runner.mjs"]
