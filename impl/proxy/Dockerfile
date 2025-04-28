FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY tsconfig.json ./
COPY common ./common
COPY index.ts ./

# Build the application
RUN npm run build

# Set the entry point
ENTRYPOINT ["node", "dist/index.js"]

# Default command line arguments
CMD ["--help"]