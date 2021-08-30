'use strict'

const childProcess = require('child_process')
const path = require('path')
const { WaitGroup } = require('./sync-wait-group')

/**

  @typedef {{
      proc: childProcess.ChildProcess;
      handlingRequest: boolean;
  }} WorkerInfo
  @typedef {{
      hasPendingRequest(id: string): boolean;
      handleLambdaResult(id: string, result: LambdaResult): void;
  }} WorkerPoolHandler

  @typedef {{
      unref(): void;
  }} Unrefable

  @typedef {{
      id: string,
      routes: Record<string, string>,
      env: Record<string, string>,
      silent: boolean
  }} GatewayInfo

  @typedef {{
      isBase64Encoded: boolean;
      statusCode: number;
      headers: Record<string, string>;
      multiValueHeaders?: Record<string, string[]>;
      body: string;
  }} LambdaResult

 */

const WORKER_PATH = path.join(__dirname, 'worker.js')
class WorkerPool {
  constructor () {
    /** @type {number} */
    this.maxWorkers = 10

    /** @type {WorkerInfo[]} */
    this.workers = []
    /** @type {GatewayInfo[]} */
    this.knownGatewayInfos = []
    /** @type {WorkerPoolHandler[]} */
    this.handlers = []
    /** @type {WaitGroup | null} */
    this.freeWorkerWG = null
  }

  /**
   * @param {string} gatewayId
   * @param {Record<string, string>} routes
   * @param {Record<string, string>} env
   * @param {boolean} silent
   * @param {WorkerPoolHandler} handler
   * @returns {void}
   */
  register (gatewayId, routes, env, silent, handler) {
    this.knownGatewayInfos.push({
      id: gatewayId,
      routes,
      env,
      silent
    })
    this.handlers.push(handler)

/*
    for(var key in routes) {
      const newWorker = spawnWorker()
      newWorker.path = key
      newWorker.proc.send({
        message: 'addRoutes',
        id: gatewayId,
        routes: {[key]:routes[key]},
        env, silent
      })
    }
*/

    for (const w of this.workers) {
      w.proc.send({
        message: 'addRoutes',
        id: gatewayId,
        routes,
        env,
        silent
      })
    }

  }

  /**
   * @param {string} gatewayId
   * @param {Record<string, string>} routes
   * @param {Record<string, string>} _env
   * @param {boolean} _silent
   * @param {WorkerPoolHandler} handler
   * @returns {void}
   */
  deregister (
    gatewayId,
    routes,
    _env,
    _silent,
    handler
  ) {
    let index = -1
    for (let i = 0; i < this.knownGatewayInfos.length; i++) {
      const v = this.knownGatewayInfos[i]
      if (v.routes === routes) {
        index = i
        break
      }
    }

    if (index === -1) {
      throw new Error('found weird index')
    }

    this.knownGatewayInfos.splice(index, 1)
    this.handlers.splice(this.handlers.indexOf(handler), 1)

    //XXX
    for (const w of this.workers) {
      w.proc.send({
        message: 'removeRoutes',
        id: gatewayId
      })
    }
  }

  /**
   * @returns {Promise<WorkerInfo>}
   */
  async getFreeWorker () {
    for (const w of this.workers) {
      if (!w.handlingRequest) {
        w.handlingRequest = true
        return w
      }
    }

    if (this.workers.length < this.maxWorkers) {
      const w = this.spawnWorker()
      w.handlingRequest = true
      return w
    }

    await this.waitForFreeWorker()
    return this.getFreeWorker()
  }

  /**
   * @returns {Promise<void>}
   */
  async waitForFreeWorker () {
    if (this.freeWorkerWG) {
      return this.freeWorkerWG.wait()
    }

    this.freeWorkerWG = new WaitGroup()
    this.freeWorkerWG.add(1)
    return this.freeWorkerWG.wait()
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {Promise<void>}
   */
  async dispatch (id, eventObject) {
    const w = await this.getFreeWorker()
    w.proc.send({
      message: 'event',
      id,
      eventObject
    })
  }

  /**
   * Helper method to cast & invoke unref if it exists
   *
   * @param {unknown} arg
   * @returns {void}
   */
  invokeUnref (arg) {
    const obj = /** @type {Unrefable | null | { unref: unknown }} */ (arg)
    if (obj && obj.unref && typeof obj.unref === 'function') {
      obj.unref()
    }
  }

  /**
   * @returns {{
   *    proc: childProcess.ChildProcess,
   *    handlingRequest: boolean
   * }}
   */
  spawnWorker () {
    const proc = childProcess.spawn(
      process.execPath,
      [WORKER_PATH],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false
      }
    )

    /**
     * Since this is a workerpool we unref the child processes
     * so that they do not keep the process open. This is because
     * we are pooling these child processes globally between
     * many instances of the FakeApiGatewayLambda instances.
     */
    proc.unref()
    this.invokeUnref(proc.channel)

    const info = {
      proc: proc,
      handlingRequest: false
    }
    this.workers.push(info)

    if (proc.stdout) {
      this.invokeUnref(proc.stdout)
      proc.stdout.pipe(process.stdout)
    }
    if (proc.stderr) {
      this.invokeUnref(proc.stderr)
      proc.stderr.pipe(process.stderr)
    }
    proc.on('message', (
      /** @type {Record<string, unknown>} */ msg
    ) => {
      this.handleMessage(msg, info)
    })

    proc.once('exit', (code) => {
      if (code !== 0) {
        throw new Error('worker process exited non-zero')
      }
    })

    proc.send({
      message: 'start',
      knownGatewayInfos: this.knownGatewayInfos
    })
    return info
  }

  /**
   * @param {Record<string, unknown>} msg
   * @param {WorkerInfo} info
   * @returns {void}
   */
  handleMessage (msg, info) {
    if (typeof msg !== 'object' || Object.is(msg, null)) {
      throw new Error('bad data type from child process')
    }

    const messageType = msg.message
    if (messageType !== 'result') {
      throw new Error('bad data type from child process')
    }

    const id = msg.id
    if (typeof id !== 'string') {
      throw new Error('bad data type from child process')
    }

    const resultObj = msg.result
    if (!checkResult(resultObj)) {
      throw new Error('bad data type from child process')
    }

    for (const h of this.handlers) {
      if (h.hasPendingRequest(id)) {
        h.handleLambdaResult(id, resultObj)
        break
      }
    }

    info.handlingRequest = false
    if (this.freeWorkerWG) {
      this.freeWorkerWG.done()
      this.freeWorkerWG = null
    }
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

module.exports = WorkerPool
