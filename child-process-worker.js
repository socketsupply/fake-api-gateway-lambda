// @ts-check
'use strict'

const childProcess = require('child_process')
const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const tmp = os.tmpdir()

const JS_WORKER_TXT = require('./workers/js-worker-txt.js')
const PY_WORKER_TXT = require('./workers/py-worker-txt.js')

const GO_WORKER_WINDOWS_TXT = require('./workers/go-worker-windows-txt.js')
const GO_WORKER_POSIX_TXT = require('./workers/go-worker-posix-txt.js')

const WORKER_PATH = `${tmp}/fake-api-gateway-lambda/worker.js`
const PYTHON_WORKER_PATH = `${tmp}/fake-api-gateway-lambda/worker.py`
const GO_WORKER_POSIX_PATH = `${tmp}/fake-api-gateway-lambda/worker-posix.go`
const GO_WORKER_WINDOWS_PATH = `${tmp}/fake-api-gateway-lambda/worker-windows.go`

const isWindows = os.platform() === 'win32'

try {
  fs.mkdirSync(path.dirname(WORKER_PATH), { recursive: true })
  fs.writeFileSync(WORKER_PATH, JS_WORKER_TXT)

  if (isWindows) {
    fs.mkdirSync(path.dirname(GO_WORKER_WINDOWS_PATH), { recursive: true })
    fs.writeFileSync(GO_WORKER_WINDOWS_PATH, GO_WORKER_WINDOWS_TXT)
  } else {
    fs.mkdirSync(path.dirname(GO_WORKER_POSIX_PATH), { recursive: true })
    fs.writeFileSync(GO_WORKER_POSIX_PATH, GO_WORKER_POSIX_TXT)
  }

  fs.mkdirSync(path.dirname(PYTHON_WORKER_PATH), { recursive: true })
  fs.writeFileSync(PYTHON_WORKER_PATH, PY_WORKER_TXT)
} catch (err) {
  console.error('Could not copy worker.{js,py,go} into tmp', err)
}

class ChildProcessWorker {
  /**
   * @param {{
   *    stdout?: object,
   *    stderr?: object,
   *    entry: string,
   *    handler: string,
   *    env: object,
   *    runtime: string
   * }} options
   */
  constructor (options) {
    assert(options.handler, 'options.handler required')
    assert(options.runtime, 'options.runtime required')
    assert(options.entry, 'options.entry required')

    this.responses = {}
    this.procs = []
    this.stdout = options.stdout || process.stdout
    this.stderr = options.stderr || process.stderr

    this.runtime = options.runtime
    this.entry = options.entry
    this.handler = options.handler
    this.env = options.env
    // this.options = options
  }

  logLine (output, line, type) {
    if (line === '') {
      return
    }

    const msg = `${new Date().toISOString()} ${this.latestId} ${type} ` + line
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
        return this.logLine(output, str, 'INFO')
      }

      const lines = str.split('\n')
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]
        const index = line.indexOf('__FAKE_LAMBDA_START__')

        if (index === -1) {
          if (line === '') continue
          this.logLine(output, line + '\n', 'INFO')
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
          this.logLine(output, end + '\n', 'INFO')
        }
      }

      const lastLine = lines[lines.length - 1]
      if (lastLine.includes('__FAKE_LAMBDA_START__')) {
        remainder = lastLine
      } else {
        this.logLine(output, remainder, 'INFO')
      }
    })
  }

  async request (id, eventObject, raw) {
    this.latestId = id
    this.stdout.write(
      `START\tRequestId:${id}\tVersion:$LATEST\n`
    )
    const start = Date.now()

    let proc
    /** @type {string | boolean} */
    let shell = true
    if (process.platform !== 'win32') {
      shell = os.userInfo().shell
    } else {
      shell = false
    }

    if (/node(js):?(12|14|16)/.test(this.runtime)) {
      const parts = this.handler.split('.')
      const handlerField = parts[parts.length - 1]

      const cmd = process.platform === 'win32' ? `"${process.execPath}"` : 'node'

      proc = childProcess.spawn(
        cmd,
        [WORKER_PATH, this.entry, handlerField],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
          shell: shell,
          env: {
            PATH: process.env.PATH,
            ...this.env
          }
        }
      )
    } else if (/python:?(3)/.test(this.runtime)) {
      const parts = this.handler.split('.')
      const handlerField = parts[parts.length - 1]

      const cmd = process.platform === 'win32' ? 'py' : 'python3'

      proc = childProcess.spawn(
        cmd,
        [PYTHON_WORKER_PATH, this.entry, handlerField],
        {
          // stdio: 'inherit',
          detached: false,
          shell: shell,
          env: {
            PATH: process.env.PATH,
            ...this.env
          }
        }
      )
    } else if (/go:?(1)/.test(this.runtime)) {
      const workerPath = isWindows ? GO_WORKER_WINDOWS_PATH : GO_WORKER_POSIX_PATH
      const workerBin = workerPath.replace('.go', '')

      const buildCommand = `go build ${workerPath}`
      const buildOptions = {
        cwd: path.dirname(workerPath),
        shell: typeof shell === 'string' ? shell : undefined,
        env: {
          GOCACHE: process.env.GOCACHE,
          GOROOT: process.env.GOROOT,
          GOPATH: process.env.GOPATH,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          ...this.env
        }
      }

      const buildResult = await new Promise((resolve) => {
        childProcess.exec(buildCommand, buildOptions, (err, stderr) => resolve({ err, stderr }))
      })

      if (buildResult.err) {
        return Promise.reject(buildResult.err)
      }

      if (buildResult.stderr) {
        const err = new Error('Internal Server Error')
        Reflect.set(err, 'errorString', buildResult.stderr)
        return Promise.reject(err)
      }

      proc = childProcess.spawn(workerBin, ['-p', '0', '-P', this.entry], {
        detached: false,
        shell: shell || true,
        cwd: path.dirname(workerPath),
        env: {
          GOCACHE: process.env.GOCACHE,
          GOROOT: process.env.GOROOT,
          GOPATH: process.env.GOPATH,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          ...this.env
        }
      })
    }

    return new Promise((resolve, reject) => {
      this.procs.push(proc)
      proc.unref()

      let errorString = ''
      proc.stderr.on('data', (line) => {
        errorString += line.toString()

        this.logLine(this.stderr, line, 'ERR')
      })

      this.parseStdout({
        stdout: proc.stdout,
        output: this.stdout,
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
          // const lambdaError = {
          //   errorType: 'Error',
          //   errorMessage: 'Error',
          //   stack: errorString.split('\n')
          // }
          // this.stdout.write(`${new Date(start).toISOString()}\tundefined\tERROR\t${JSON.stringify(lambdaError)}\n`)

          const err = new Error('Internal Server Error')
          Reflect.set(err, 'errorString', errorString)
          Reflect.set(err, 'code', code)
          reject(err)
          // this is wrong, should not crash.
        }
      })

      proc.on('error', function (err) {
        reject(err)
      })

      proc.stdin.on('error', function (err) {
        /**
         * Sometimes we get an EPIPE exception when writing to
         * stdin for a process where the command is not found.
         *
         * We really care boure about the command not found error
         * so we swallow the EPIPE and let the other err bubble instead
         */
        if (Reflect.get(err, 'code') === 'EPIPE') {
          return
        }

        reject(err)
      })

      proc.stdin.write(JSON.stringify({
        message: 'event',
        id,
        eventObject,
        raw: !!raw
      }) + '\n')
      process.stdin.end()
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
    // if (!checkResult(resultObj)) {
    //   throw new Error('missing result from child process:' + msg.result)
    // }

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
    this.procs.forEach(proc => proc.kill())
    this.procs = []
  }
}

module.exports = ChildProcessWorker
