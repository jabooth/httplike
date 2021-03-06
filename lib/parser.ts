import { Writable } from 'stream'
import { Socket } from 'net'
import { inspect } from 'util'

const LINE_TERMINATOR = '\r\n'
const HEADER_TERMINATOR = [0x0D, 0x0A, 0x0D, 0x0A]

export class Message {
    content?: Buffer
    headers: { [key: string]: string} = {}

    toString() {
        let str = `HEADERS:\n${inspect(this.headers)}`
        if (this.content) {
            str += `\n\nCONTENT:${this.content}`
        }
        return str
    }
}

type MessageAndContentLength = {
    message: Message,
    contentLength: number,
}

export abstract class Parser extends Writable {

    private _buffer = new Buffer(0)
    private _collectingContent = -1
    private _headerData: MessageAndContentLength
    private _output = null
    protected _socket: Socket

    constructor(socket: Socket) {
        super()
        // we know it is only possible that our source is a Socket, not just Readable
        this.on('pipe', (src: Socket) => this._socket = src)
        // TODO get rid of this if - surely it's never needed?
        if (socket) {
            socket.pipe(this)
        }
    }

    abstract _constructMessage(firstLine: string): Message
    abstract _emitMessage(message: Message): void

    parseHeader(header: string) {

        const lines = header.split(LINE_TERMINATOR)
        const firstLine = lines.shift()
        if (!firstLine) {
            throw new Error('Invalid header - no line terminator present')
        }
        const message = this._constructMessage(firstLine)

        message.headers = lines.reduce((headers: {[key: string]: string}, line) => {

            const idx = line.indexOf(':')
            const key = line.substring(0, idx).trim()
            const val = line.substring(idx + 1).trim()

            if (idx === -1) {
                throw new Error('Invalid header (' + line + ')')
            }

            return {
                ...headers,
                [key.toLowerCase()]: val,
            }
        }, {})

        const hasContent = message.headers.hasOwnProperty('content-length')
        const contentLength = (hasContent ? Number(message.headers['content-length']) : 0)

        return {
            contentLength,
            message,
        }
    }

    _write(chunk: Buffer, encoding: string, cb: Function) {

        this._buffer = Buffer.concat([this._buffer, chunk])

        while (true) {

            if (this._collectingContent === -1) {

                const idxTerminator = bufferIndexOf(this._buffer, HEADER_TERMINATOR)
                if (idxTerminator === -1) {
                    return cb(null)
                }

                try {
                    this._headerData = this.parseHeader(this._buffer.slice(0, idxTerminator).toString())
                } catch (err) {
                    return cb(err)
                }

                this._buffer = this._buffer.slice(idxTerminator + HEADER_TERMINATOR.length)

                if (this._headerData.contentLength === 0) {
                    this._emitMessage(this._headerData.message)
                } else {
                    this._collectingContent = this._headerData.contentLength
                }

            } else {

                if (this._buffer.length < this._collectingContent) {
                    return cb(null)
                }

                this._headerData.message.content = this._buffer.slice(0, this._collectingContent)
                this._emitMessage(this._headerData.message)

                this._buffer = this._buffer.slice(this._collectingContent)
                this._collectingContent = -1

            }

        }

    }

}

function bufferIndexOf(haystack: Buffer, needle: number[]) {
    const nLen = needle.length
    const max = haystack.length - nLen
    outer: for (let i = 0; i <= max; i++) {
        for (let j = 0; j < nLen; j++) {
            if (haystack[i + j] !== needle[j]) {
                continue outer
            }
        }
        return i
    }
    return -1
}
