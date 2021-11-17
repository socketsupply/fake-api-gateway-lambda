// @ts-check
'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const WORKER_PATH = `${os.tmpdir()}/fake-api-gateway-lambda/worker.js`

try {
  fs.mkdirSync(path.dirname(WORKER_PATH), { recursive: true })
  fs.writeFileSync(
    WORKER_PATH,
    fs.readFileSync(
      path.join(__dirname, 'workers', 'worker.js')
    )
  )
} catch (err) {}

class ChildProcessWorker {
  constructor (options) {
    if (!/^nodejs:/.test(options.runtime)) { throw new Error('only node.js runtime supported currently') }
    this.responses = {}
    this.procs = []
    this.stdout = options.stdout || process.stdout
    this.stderr = options.stderr || process.stderr

    this.entry = options.entry
    this.handler = options.handler || 'handler'
    this.env = options.env
    // this.options = options
  }

  logLine (output, line) {
    const msg = `${new Date().toISOString()} ${this.latestId} ERR ` + line
    output.write(msg)
  }

  /**
   * @param {{
   *    stdout: import('stream').Readable,
   *    output: import('stream').Writable,
   *    handleMessage: (o: object) => void
   * }} opts
   */
  parseStdout (opts) {
    const { stdout, output, handleMessage } = opts

    let remainder = ''
    const START_LEN = '__FAKE_LAMBDA_START__'.length
    const END_LEN = '__FAKE_LAMBDA_END__'.length

    stdout.on('data', (bytes) => {
      const str = remainder + bytes.toString()
      remainder = ''

      if (str.indexOf('\n') === -1) {
        return this.logLine(output, str)
      }

      const lines = str.split('\n')
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]
        const index = line.indexOf('__FAKE_LAMBDA_START__')

        if (index === -1) {
          this.logLine(output, line + '\n')
          continue
        }

        const start = line.slice(0, index)
        this.logLine(output, start)
        const endIndex = line.indexOf('__FAKE_LAMBDA_END__')

        const messageStr = line.slice(index + START_LEN, endIndex)
        const msgObject = JSON.parse(messageStr.trim())
        handleMessage(msgObject)

        const end = line.slice(endIndex + END_LEN)
        if (end.length > 0) {
          this.logLine(output, end + '\n')
        }
      }

      const lastLine = lines[lines.length - 1]
      if (lastLine.includes('__FAKE_LAMBDA_START__')) {
        remainder = lastLine
      } else {
        this.logLine(output, remainder)
      }
    })
  }

  request (id, eventObject) {
    this.latestId = id
    this.stdout.write(
      `START\tRequestId:${id}\tVersion:$LATEST\n`
    )
    const start = Date.now()

    const proc = childProcess.spawn(
      process.execPath,
      [WORKER_PATH, this.entry, this.handler],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false,
        env: this.env
      }
    )
    this.procs.push(proc)

    proc.unref()
    // proc.channel.unref()
    // proc.stdout.unref()
    // proc.stderr.unref()

    return new Promise((resolve, reject) => {
      let errorString
      proc.stderr.on('data', (line) => {
        if (!errorString) {
          errorString = line.toString()
        }

        const output = this.stderr || process.stderr
        this.logLine(output, line)
      })

      this.parseStdout({
        stdout: proc.stdout,
        output: this.stdout || process.stdout,
        handleMessage: (msg) => {
          const resultObject = this.handleMessage(msg, start)
          proc.kill()

          resolve(resultObject)
        }
      })

      proc.once('exit', (code) => {
        code = code || 0

        if (code !== 0) {
          //        var err = new Error()
          //        err.message = error.split('\n')[0]
          //        err.stack = error.split('\n').slice(1).join('\n')
          const lambdaError = {
            errorType: 'Error',
            errorMessage: 'Error',
            stack: errorString.split('\n')
          }
          this.stdout.write(`${new Date(start).toISOString()}\tundefined\tERROR\t${JSON.stringify(lambdaError)}\n`)

          const err = new Error('Internal Server Error')
          Reflect.set(err, 'errorString', errorString)
          reject(err)
          // this is wrong, should not crash.
        }
      })

      proc.on('error', function (err) {
        reject(err)
      })

      proc.stdin.write(JSON.stringify({
        message: 'event',
        id,
        eventObject
      }) + '\n')
    })
  }

  handleMessage (msg, start) {
    if (typeof msg !== 'object' || Object.is(msg, null)) {
      throw new Error('bad data type from child process')
    }

    const messageType = msg.message
    if (messageType !== 'result') {
      throw new Error('incorrect type field from child process:' + msg.type)
    }

    const id = msg.id
    if (typeof id !== 'string') {
      throw new Error('missing id from child process:' + msg.id)
    }

    const resultObj = msg.result
    if (!checkResult(resultObj)) {
      throw new Error('missing result from child process:' + msg.result)
    }

    const duration = Date.now() - start

    // log like lambda
    this.stdout.write(
      `END\tRequestId: ${msg.id}\n` +
      `REPORT\tRequestId: ${msg.id}\t` +
        'InitDuration: 0 ms\t' +
        `Duration: ${duration} ms\t` +
        `BilledDuration: ${Math.round(duration)} ms\t` +
        `Memory Size: NaN MB MaxMemoryUsed ${Math.round(msg.memory / (1024 * 1024))} MB\n`
    )
    return resultObj
  }

  close () {
    this.procs.forEach(v => v.kill(0))
    this.procs = []
  }
}

/**
 * @param {unknown} v
 */
function checkResult (v) {
  if (typeof v !== 'object' || !v) {
    return false
  }

  const objValue = v
  if (typeof Reflect.get(objValue, 'isBase64Encoded') !== 'boolean') {
    return false
  }
  if (typeof Reflect.get(objValue, 'statusCode') !== 'number') {
    return false
  }
  if (typeof Reflect.get(objValue, 'headers') !== 'object') {
    return false
  }

  const mvHeaders = /** @type {unknown} */ (Reflect.get(objValue, 'multiValueHeaders'))
  if (mvHeaders && typeof mvHeaders !== 'object') {
    return false
  }
  if (typeof Reflect.get(objValue, 'body') !== 'string') {
    return false
  }

  return true
}

module.exports = ChildProcessWorker
