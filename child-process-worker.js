var path = require('path')
const childProcess = require('child_process')

const WORKER_PATH = path.join(__dirname, 'worker.js')

class ChildProcessWorker {
  constructor (path, entry, env, handler, runtime) {
    if(!/^nodejs:/.test(runtime))
      throw new Error('only node.js runtime supported currently')
    this.responses = {}
    this.path = path
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
    proc.unref()
    invokeUnref(proc.channel)

    const info = {
      proc: proc,
      handlingRequest: false
    }

    if (proc.stdout) {
      invokeUnref(proc.stdout)
      proc.stdout.pipe(process.stdout)
    }
    if (proc.stderr) {
      invokeUnref(proc.stderr)
      proc.stderr.pipe(process.stderr)
    }
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
        throw new Error('missing id from child process:'+msg.id)
      }

      const resultObj = msg.result
      if (!checkResult(resultObj)) {
        throw new Error('missing result from child process:'+msg.result)
      }

      var response = this.responses[msg.id]
      if(response) {
        delete this.responses[msg.id]
        response.resolve(resultObj)
      }
      else
        throw new Error('unknown response id from child process:' + msg.id)
    })

    proc.once('exit', (code) => {
      if (code !== 0) {
        throw new Error('worker process exited non-zero:'+code)
      }
    })

    proc.on('error', function (err) {
      console.error(err)
    })

  }
  request (id, eventObject) {
    this.proc.send({
      message: 'event',
      id,
      eventObject
    })
    return new Promise((resolve, reject) => { 
      this.responses[id] = {resolve,reject}
    })
  }
  close () {
    this.proc.kill(0)
  }
}

 function invokeUnref (arg) {
    const obj = /** @type {Unrefable | null | { unref: unknown }} */ (arg)
    if (obj && obj.unref && typeof obj.unref === 'function') {
      obj.unref()
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