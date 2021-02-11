const { Transform } = require("stream");

const GrowableUint8Array = require("./growable-uint8-array");

let encoder = new TextEncoder();
let decoder = new TextDecoder();

function isEndOfLine(el, index, array) {
  if (el !== 13) return false;
  if (array.length === index + 1) return false;
  return array[index + 1] === 10;
}

class MultipartParser extends Transform {
  constructor(boundary, warn = false) {
    super({ readableObjectMode: true });
    this.warn = warn;

    this.boundary = boundary || "";

    this.buffer = new GrowableUint8Array();
    this.currentPart = {};

    this.state = 0;
    this.cursor = 0;
  }
  getLine(start) {
    const endIndex = this.buffer.indexOf(13, start); // indexOf re-implemented in GrowableUint8Array
    if (endIndex < 0) throw new Error("no new line");
    const line = this.buffer.subarray(start, endIndex + 2);
    return line;
  }
  purge(i) {
    if (i > this.cursor) throw new Error("cannot purge after cursor");

    // avoid creating new buffer
    const remaining = this.buffer.unwrap(false).slice(i);
    this.buffer.set(remaining);
    this.buffer.bytesUsed = remaining.length;

    this.cursor -= i;
  }
  emitData() {
    const part = MultipartParser.formatPart(this.currentPart);
    this.push(part);
    this.purge(this.cursor);
  }
  _transform(chunk, encoding, callback) {
    if (this._lastChunk === chunk) {
      // TODO: understand why this happens
      callback();
      return;
    }
    this._lastChunk = chunk;

    this.buffer.extend(chunk);
    this.parse();
    callback();
  }
  parse() {
    const buff = this.buffer;
    if (this.state === 0) {
      // push cursor to next delimiter
      const delimiterRegExp = new RegExp(`^--${this.boundary}`);
      try {
        let nextLine = this.getLine(this.cursor);
        let nextLineAsString = decoder.decode(nextLine);
        while (
          this.cursor < buff.length &&
          !delimiterRegExp.test(nextLineAsString)
        ) {
          if (this.warn)
            console.warn(
              "removing unnecessary non-boundary line : ",
              JSON.stringify(nextLineAsString),
              nextLine
            );
          this.cursor += nextLine.length;
          nextLine = this.getLine(this.cursor);
          nextLineAsString = decoder.decode(nextLine);
        }
        const delimiter = nextLineAsString;

        const offset = 2 + this.boundary.length;

        if (
          delimiter.length >= offset + 2 &&
          delimiter[offset] === "-" &&
          delimiter[offset + 1] === "-"
        ) {
          // end delimiter
          // TODO: test this works ok
          this.end();
        }
        this.cursor += nextLine.length;

        delete this.currentPart;
        this.currentPart = { headers: {} };

        this.state = 1;
      } catch (e) {
        //... just stop moving
        if (this.warn)
          console.warn(
            `incomplete next line (state ${this.state}): ${JSON.stringify(
              decoder.decode(this.buffer.subarray(this.cursor))
            )}`
          );
      }
    }
    if (this.state === 1) {
      // parsing headers
      let headers = this.currentPart.headers;
      try {
        let nextLine = this.getLine(this.cursor);
        let nextLineAsString = decoder.decode(nextLine);
        while (nextLineAsString !== "\r\n") {
          let header = nextLineAsString;
          headers[header.substring(0, header.indexOf(":"))] = header
            .substring(header.indexOf(":") + 1)
            .trim();

          this.cursor += nextLine.length;
          nextLine = this.getLine(this.cursor);
          nextLineAsString = decoder.decode(nextLine);
        }

        // all headers have been parsed
        if (!headers.hasOwnProperty("Content-Length"))
          throw new Error(`Content length must be set`);
        this.currentPart.contentLength = Number(headers["Content-Length"]);

        this.cursor += nextLine.length;
        this.state = 2;
      } catch (e) {
        //... just stop moving
        if (this.warn)
          console.warn(
            `incomplete next line (state ${this.state}): ${JSON.stringify(
              decoder.decode(this.buffer.subarray(this.cursor))
            )}`
          );
      }
    }
    if (this.state === 2) {
      let { contentLength } = this.currentPart;
      let contentEnd = this.cursor + contentLength;
      if (buff.length >= contentEnd) {
        let body = buff.subarray(this.cursor, contentEnd);
        this.currentPart.body = body;

        this.cursor += contentLength;
        this.emitData();
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
    // FIXME: why copying the array ?
    let body = array.buffer.slice(
      array.byteOffset,
      array.byteLength + array.byteOffset
    );

    return { headers, type: contentType, length: contentLength, body };
  }
  static formatBody(part) {
    let body;
    switch (part.type) {
      case "application/json":
        body = JSON.parse(decoder.decode(new Uint8Array(part.body)));
        break;
      case "application/xml":
        body = decoder.decode(new Uint8Array(part.body));
        break;
      default:
        body = part.body;
    }
    return { ...part, body };
  }
}
MultipartParser.encoder = encoder;
MultipartParser.decoder = decoder;

module.exports = MultipartParser;
