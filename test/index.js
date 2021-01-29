const fs = require("fs");
const path = require("path");

const MultipartParser = require("../src");

async function test() {
  let nbFrames = 0;
  const fpsCache = {
    date: null,
    nbFrames,
  };

  const display = () => {
    const now = Date.now();

    let fps = 0;
    if (fpsCache.date) {
      dn = nbFrames - fpsCache.nbFrames;
      dt = now - fpsCache.date;
      fps = (dn / dt) * 1000;
    }
    if (!fpsCache.date) {
      fpsCache.date = now;
      fpsCache.nbFrames = nbFrames;
    }

    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.moveCursor(0, -1);
    process.stdout.clearLine();
    process.stdout.write(
      `frames: ${String(nbFrames).padStart(9, "0")}, fps: ${fps.toFixed(1)}\n`
    );
  };

  const displayInterval = setInterval(() => {
    display();
  }, 10);
  const end = () => {
    clearInterval(displayInterval);
    display();
    process.exit(0);
  };

  const parser = new MultipartParser("W1LPKOILE6Bu");
  parser
    .on("data", () => {
      nbFrames++;
      if (nbFrames === Math.pow(10, 6)) end();
    })
    .on("finish", () => {
      end();
    });

  const inputStream = require("./loop-stream")();
  inputStream.pipe(parser, { close: false });
}

test();
