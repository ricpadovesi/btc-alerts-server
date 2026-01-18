#!/bin/bash
set -e

echo "Building with esbuild..."
npx esbuild _core/index.ts \
  --platform=node \
  --bundle \
  --format=esm \
  --external:ws \
  --external:mysql2 \
  --external:drizzle-orm \
  --external:firebase-admin \
  --external:dotenv \
  --external:axios \
  --external:express \
  --external:cookie \
  --external:jose \
  --external:superjson \
  --external:zod \
  --external:@trpc/server \
  --outdir=dist

echo "Creating package.json for dist..."
cat > dist/package.json << 'EOF'
{
  "name": "btc-alerts-server",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@trpc/server": "11.7.2",
    "axios": "^1.13.2",
    "cookie": "^1.1.1",
    "dotenv": "^16.6.1",
    "drizzle-orm": "^0.44.7",
    "express": "^4.22.1",
    "firebase-admin": "^13.0.2",
    "jose": "6.1.0",
    "mysql2": "^3.16.0",
    "superjson": "^1.13.3",
    "ws": "^8.18.0",
    "zod": "^4.2.1"
  }
}
EOF

echo "Copying firebase service account..."
cp firebase-service-account.json dist/ 2>/dev/null || echo "No firebase-service-account.json found"

echo "Build complete!"
