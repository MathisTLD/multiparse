const EventEmitter = require("events");

let encoder = new TextEncoder();
let decoder = new TextDecoder();

function isEndOfLine(el, index, array) {
  if (el !== 13) return false;
  if (array.length === index + 1) return false;
  return array[index + 1] === 10;
}

class MultipartParser extends EventEmitter {
  constructor(boundary) {
    super();

    if (!boundary) throw new Error("a boudary is required");
    this.boundary = boundary;

    this.buffer = new Uint8Array();

    this.state = 0;
    this.cursor = 0;
  }
  get delimiter() {
    return `--${this.boundary}\r\n`;
  }
  get endDelimiter() {
    return `--${this.boundary}--`;
  }
  getLine(start) {
    let end = this.buffer.indexOf(13, start) + 2;
    let line = this.buffer.subarray(start, end);
    return line;
  }
  purge(i) {
    if (i > this.cursor) throw new Error("cannot purge after cursor");
    this.buffer = this.buffer.slice(i);
    this.cursor -= i;
  }
  error(e) {
    this.emit("error", e);
  }
  data() {
    let part = MultipartParser.formatPart(this.currentPart);
    this.emit("data", part);
    this.purge(this.cursor);
  }
  end() {
    this.emit("end");
  }
  feed(buff) {
    let prevBuff = this.buffer;
    let l = prevBuff.length + buff.length;
    this.buffer = new Uint8Array(prevBuff.length + buff.length);
    this.buffer.set(prevBuff);
    this.buffer.set(buff, prevBuff.length);

    this.parse();
  }
  parse() {
    let buff = this.buffer;

    if (this.state === 0) {
      // push cursor to next non-blank line
      let nextLine = this.getLine(this.cursor);
      while (["\r\n", "\n", "\r"].includes(decoder.decode(nextLine))) {
        console.warn("removing unnecessary blank line : ", nextLine);
        this.cursor += nextLine.length;
        nextLine = this.getLine(this.cursor);
      }

      if (decoder.decode(nextLine) !== this.delimiter) {
        console.error("unexpected line : ", nextLine);
        throw new Error(
          `a part must start with the boundary delimiter (got ${decoder.decode(
            nextLine
          )})`
        );
      }

      let currentPart = (this.currentPart = {});
      let headers = (currentPart.headers = {});

      this.cursor += this.delimiter.length;

      this.state = 1;
    }
    if (this.state === 1) {
      // parsing headers
      let headers = this.currentPart.headers;

      let nextLine = this.getLine(this.cursor);

      while (decoder.decode(nextLine) !== "\r\n") {
        let header = decoder.decode(nextLine);
        headers[header.substring(0, header.indexOf(":"))] = header
          .substring(header.indexOf(":") + 1)
          .trim();

        this.cursor += nextLine.length;
        nextLine = this.getLine(this.cursor);
      }

      if (decoder.decode(nextLine) === "\r\n") {
        // all headers have been parsed
        if (!headers.hasOwnProperty("Content-Length"))
          throw new Error(`Content length must be set`);
        this.currentPart.contentLength = Number(headers["Content-Length"]);

        this.cursor += encoder.encode("\r\n").length;
        this.state = 2;
      }
    }
    if (this.state === 2) {
      let contentLength = this.currentPart.contentLength;
      if (buff.length >= this.cursor + contentLength) {
        let body = buff.subarray(this.cursor, this.cursor + contentLength);
        this.currentPart.body = body;

        this.cursor += contentLength;
        this.state = 0;

        this.data();
      }
    }
  }
  static formatPart(part) {
    let headers = part.headers;
    if (!headers.hasOwnProperty("Content-Type"))
      throw new Error(
        "can't format a part without the content-type header set"
      );

    let contentTypeHeader = headers["Content-Type"];
    let contentType = contentTypeHeader.split(";")[0].trim();

    let contentLength = part.contentLength;

    let body;
    let array = part.body;
    switch (contentType) {
      case "application/json":
        body = JSON.parse(decoder.decode(array));
        break;
      case "application/xml":
        body = decoder.decode(array);
        break;
      default:
        body = array.buffer.slice(
          array.byteOffset,
          array.byteLength + array.byteOffset
        );
    }
    return { headers, type: contentType, length: contentLength, body };
  }
  static encoder = encoder;
  static decoder = decoder;
}

module.exports = MultipartParser;
