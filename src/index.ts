import express from "express";
import ytdlp, { YTDlpEventEmitter } from "yt-dlp-wrap";
import os from "os";
import fs from "fs";
import Path from "path";
import WebSocket from "ws";
import http from "http";

const PORT = process.env.PORT || 3333;
const ytdlpDirectory = Path.resolve(os.homedir(), ".yt-dlp-server");
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || Path.join(ytdlpDirectory, "downloads");
const ytdlpFile = Path.resolve(ytdlpDirectory, "yt-dlp");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const onGoingDownloads: { [key: string]: YTDownload } = {};
const cachedDownloads: { [key: string]: YTDownload & {
  // Reset every 12 hours
  expires: number;
} } = {};

setInterval(() => {
  const now = Date.now();
  Object.keys(cachedDownloads).forEach(key => {
    if (cachedDownloads[key].expires < now) {
      delete cachedDownloads[key];
    }
  });
}, 1000 * 60 * 60);

interface YTDownload {
  emitter: YTDlpEventEmitter;
  id: string;
  name: string;
  title: string;
  extension: string;
  extractor: string;
}

const app = express();
app.use(express.json());
const httpServer = http.createServer();
httpServer.on("request", app);
// Create web socket on same port as express
const wss = new WebSocket.Server({
  server: httpServer
});

httpServer.listen(PORT);
httpServer.on("listening", () => {
  console.log("Listening on port " + PORT);
});

(async () => {
  if (!fs.existsSync(ytdlpDirectory)) fs.mkdirSync(ytdlpDirectory, { recursive: true });

  // Check if ytdlp is installed
  if (!fs.existsSync(ytdlpFile)) {
    const version: string = (await ytdlp.getGithubReleases())[0].tag_name;
    console.log("ytdlp not found, installing...");
    console.log("Downloading version: " + version);
    await ytdlp.downloadFromGithub(
      ytdlpFile,
      version,
    );
    console.log("ytdlp installed");
  }

  const yt = new ytdlp();
  yt.setBinaryPath(ytdlpFile);

  const publicDir = Path.resolve(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.post("/download", async (req, res) => {
    const url: string = req.body.url;
    if (!url) {
      res.status(400).send("Missing url");
      return;
    }

    let uniqueId = "";
    while (uniqueId.length < 8 || onGoingDownloads[uniqueId]) {
      uniqueId = Math.random().toString(36).substring(2, 10);
    }

    const info: {
      filename: string;
      extractor: string;
      extractor_key: string;
      fulltitle: string;
      video_ext: string;
    } = await yt.getVideoInfo(url);
    // console.log(info);
    const download = yt.exec(
      [
        url as string,
        "--output",
        Path.resolve(DOWNLOAD_DIR, uniqueId) + "." + info.video_ext,
        // Export to mp4
        "-f",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
      ]
    );

    onGoingDownloads[uniqueId] = {
      emitter: download,
      id: uniqueId,
      extension: info.video_ext,
      name: info.filename,
      title: info.fulltitle,
      extractor: info.extractor_key || info.extractor,
    };

    download.on("close", (code) => {
      console.log("Exit code:", code);
      console.log("Download finished:", uniqueId);
      cachedDownloads[uniqueId] = {
        ...onGoingDownloads[uniqueId],
        expires: Date.now() + 1000 * 60 * 60 * 12
      };
      delete onGoingDownloads[uniqueId];
    });

    // download.on("progress", (progress) => {
    //   const {
    //     currentSpeed,
    //     eta,
    //     percent,
    //     totalSize
    //   } = progress
    //   console.log(`${percent}% ${currentSpeed} ${eta} ${totalSize}`);
    // });

    console.log("Downloading: " + url);


    return res.json({
      id: uniqueId
    });
  });

  app.get("/progress/:id", (req, res) => {
    const id = req.params.id;
    const download = onGoingDownloads[id];
    if (!download) {
      return res.redirect("/");
    }
    res.sendFile(Path.resolve(publicDir, "progress.html"));
  });

  app.use("/download/:id", (req, res) => {
    const id = req.params.id;
    
    const download = cachedDownloads[id];
    const file = Path.resolve(DOWNLOAD_DIR, id + "." + download?.extension ?? "mp4");
    if (download && fs.existsSync(file)) {
      // Rename the file to download.name on download
      res.download(file, download.name ?? (id + "." + download.extension));
    }
    else {
      res.status(404).send("File not found");
    }
  });

  wss.on("connection", (ws) => {
    let isFirstMessage = true;
    ws.on("message", (message) => {
      const data: {
        id: string,
      } = JSON.parse(message.toString());
      if (data.id) {
        const {
          emitter: download,
          name,
          title,
          extractor,
        } = onGoingDownloads[data.id];
        if (download) {
          download.on("progress", (progress) => {
            const {
              currentSpeed,
              eta,
              percent,
              totalSize
            } = progress;

            const clientData: { [key: string]: any } = {
              currentSpeed,
              eta,
              percent,
              totalSize
            };

            if (isFirstMessage) {
              clientData.name = name;
              clientData.title = title;
              clientData.extractor = extractor;
              isFirstMessage = false;
            }
            ws.send(JSON.stringify(clientData));
          });

          download.on("close", (code) => {
            ws.send(JSON.stringify({
              code
            }));
          });
        }
      }
    });
  });
})();
