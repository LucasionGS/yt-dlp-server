FROM ubuntu:latest
WORKDIR /yt-dlp-server
COPY . .

SHELL [ "bash", "-c" ]
# Set node into production mode
RUN echo export NODE_ENV=production >> ~/.bash_profile
RUN source ~/.bash_profile
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