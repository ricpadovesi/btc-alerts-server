# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build the application (build.sh creates dist/ with package.json)
RUN npm run build

# Install production dependencies INSIDE dist/
WORKDIR /app/dist
RUN npm install --production

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy the complete dist directory with node_modules from builder
COPY --from=builder /app/dist ./

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
