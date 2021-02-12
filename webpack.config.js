const path = require("path");

module.exports = {
  mode: "production",
  entry: path.resolve(__dirname, "lib"),
  output: {
    library: "MultipartParser",
    libraryTarget: "umd"
  },
  resolve: {
    fallback: {
      buffer: require.resolve("buffer/"),
      stream: require.resolve("stream-browserify"),
      util: require.resolve("util/")
    }
  }
};
