const fs = require("fs");
const path = require("path");

const SAMPLES_DIR = path.resolve(__dirname, "samples");

module.exports = function() {
  return fs.createReadStream(path.resolve(SAMPLES_DIR, "sample-end"));
};
