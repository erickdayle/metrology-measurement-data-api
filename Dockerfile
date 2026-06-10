FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copy all source files and directories
COPY index.js ./
COPY services/ ./services/
COPY utils/ ./utils/
COPY entrypoint.sh ./

RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]

CMD ["--recordId", "defaultRecordId", "--projectId", "defaultProjectId"]
