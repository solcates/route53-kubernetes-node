FROM node:6.3.1
WORKDIR /app
COPY index.js /app/
COPY package.json /app/
RUN npm install
CMD node index.js