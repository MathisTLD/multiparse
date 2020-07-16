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
    this.currentPart = {};

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
      while (
        this.cursor < buff.length &&
        decoder.decode(nextLine) !== this.delimiter
      ) {
        console.warn(
          "removing unnecessary non-boundary line : ",
          JSON.stringify(decoder.decode(nextLine)),
          nextLine
        );
        this.cursor += nextLine.length;
        nextLine = this.getLine(this.cursor);
      }
      if (this.cursor < this.buffer.length) {
        if (decoder.decode(nextLine) === this.delimiter) {
          delete this.currentPart;
          this.currentPart = {};
          let currentPart = this.currentPart;
          currentPart.headers = {};

          this.cursor += this.delimiter.length;

          this.state = 1;
        } else {
          throw new Error(
            `unexpected line `,
            JSON.stringify(decoder.decode(nextLine)),
            nextLine
          );
        }
      }
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
      } else {
        throw new Error("Unexpected line " + decoder.decode(nextLine));
      }
    }
    if (this.state === 2) {
      let contentLength = this.currentPart.contentLength;
      if (buff.length >= this.cursor + contentLength) {
        let body = buff.subarray(this.cursor, this.cursor + contentLength);
        this.currentPart.body = body;

        this.cursor += contentLength;
        this.data();
        this.state = 0;
        if (this.buffer.length > this.cursor) {
          this.parse();
        }
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

    let array = part.body;
    let body = array.buffer.slice(
      array.byteOffset,
      array.byteLength + array.byteOffset
    );

    return { headers, type: contentType, length: contentLength, body };
  }
  static formatBody(part) {
    let array = new Uint8Array(part.body);
    let body;
    switch (part.type) {
      case "application/json":
        body = JSON.parse(decoder.decode(array));
        break;
      case "application/xml":
        body = decoder.decode(array);
        break;
      default:
        body = array.buffer;
    }
    return { ...part, body };
  }
  static encoder = encoder;
  static decoder = decoder;
}

module.exports = MultipartParser;
