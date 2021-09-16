const childProcess = require('child_process')
const util = require('./util')

const WORKER_PATH = '/tmp/worker.js' // path.join(__dirname, 'worker.js')

const WorkerMain = require('./worker')
try {
  require('fs')
    .writeFileSync('/tmp/worker.js', ';(' + WorkerMain.toString() + ')();function __name (){}; ')
} catch (err) {}

class ChildProcessWorker {
  constructor ({ path, entry, env, handler, runtime = 'nodejs:12', stdout, stderr }) {
    if (!/^nodejs:/.test(runtime)) { throw new Error('only node.js runtime supported currently') }
    this.responses = {}
    this.path = path

    this.stdout = stdout || process.stdout
    this.stderr = stderr || process.stderr

    const proc = this.proc = childProcess.spawn(
      process.execPath,
      [WORKER_PATH, entry, handler],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false,
        env: env
      }
    )

    /**
     * Since this is a workerpool we unref the child processes
     * so that they do not keep the process open. This is because
     * we are pooling these child processes globally between
     * many instances of the FakeApiGatewayLambda instances.
     */
    util.invokeUnref(proc)
    util.invokeUnref(proc.channel)

    const logStdio = (input, output, name) => {
      input.on('data', (line) => {
        output.write(new Date().toISOString() + ' ' +  this.latestId + ` ${name} ` + line)
      })
    }

    logStdio(proc.stdout, stdout || process.stdout, 'INFO')
    logStdio(proc.stdout, stdout || process.stdout, 'ERR')

    util.invokeUnref(proc.stdout)
    util.invokeUnref(proc.stderr)


    proc.on('message', (
      /** @type {Record<string, unknown>} */ msg
    ) => {
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

      const response = this.responses[msg.id]
      if (response) {
      const duration = Date.now() - this.responses[msg.id].start

      //log like lambda
      this.stdout.write(
        `END RequestId: ${msg.id}\n`+
        `REPORT RequestId: ${msg.id} `+
          `InitDuration: 0 ms `+
          `Duration: ${duration} ms ` +
          `BilledDuration ${Math.round(duration)} ms ` + 
          `Memory Size: NaN MB MaxMemoryUsed ${Math.round(msg.memory / (1024*1024))} MB\n`
      )

        delete this.responses[msg.id]
        response.resolve(resultObj)
      } else { throw new Error('unknown response id from child process:' + msg.id) }
    })

    proc.once('exit', (code) => {
      if (code !== 0) {
        throw new Error('worker process exited non-zero:' + code)
      }
    })

    proc.on('error', function (err) {
      console.error(err)
    })
  }

  request (id, eventObject) {
    this.latestId = id
    this.stdout.write(
      `START RequestId:${id} Version:$LATEST\n`
    )
    var start = Date.now()
    this.proc.send({
      message: 'event',
      id,
      eventObject,
    })
    return new Promise((resolve, reject) => {
      this.responses[id] = { resolve, reject, start }
    })
  }

  close () {
    this.proc.kill(0)
  }
}

/**
 * @param {unknown} v
 * @returns {v is LambdaResult}
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
