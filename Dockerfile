FROM ubuntu:latest
WORKDIR /yt-dlp-server
COPY . .
# Install nodejs 17.x
RUN apt-get update
RUN apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_17.x | bash -
RUN apt-get install -y nodejs
# Install ffmpeg
RUN apt-get install -y ffmpeg
# Install dependencies
RUN npm install
# Compile typescript
RUN npm run compile

EXPOSE 3333

CMD [ "npm", "start" ]