'use strict'

const childProcess = require('child_process')
const path = require('path')
const { WaitGroup } = require('./sync-wait-group')
const matchRoute = require('./match')
const {URL} = require('url')
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
      route: string,
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
//    /** @type {GatewayInfo[]} */
//    this.knownGatewayInfos = []
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
    this.handlers.push(handler)
    this.routes = this.routes || {}
    for(var route in routes) {
   /*   this.knownGatewayInfos.push({
        id: gatewayId,
        route,
        env,
        silent
      })*/
      const newWorker = this.spawnWorker()
      newWorker.path = route
      this.routes[route] = newWorker
      newWorker.proc.send({
        message: 'addRoutes',
        id: gatewayId,
        routes: {[route]: routes[route]},
        env, silent
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
    for (var key in routes) {
      this.routes[key].proc.kill(0)
    }
    //why is handlers an array?
    //It must be related to there being one global worker pool.
    //so much easier to have the gateway own the wp, so now there
    //should only be one handler...
    this.handlers.splice(this.handlers.indexOf(handler), 1)
  }

  /**
   * @returns {Promise<WorkerInfo>}
   */
  async getFreeWorker (route) {
    throw new Error('get free worker')
    /*    
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
    */
  }

  /**
   * @returns {Promise<void>}
   */
  async waitForFreeWorker () {
    throw new Error('wait for free worker')
    /*
    if (this.freeWorkerWG) {
      return this.freeWorkerWG.wait()
    }

    this.freeWorkerWG = new WaitGroup()
    this.freeWorkerWG.add(1)
    return this.freeWorkerWG.wait()
    */
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {Promise<void>}
   */
  async dispatch (id, eventObject) {
    const url = new URL(eventObject.path, 'http://localhost:80')

    var matched = matchRoute(this.routes, url.pathname)

    if(matched)
      this.routes[matched].proc.send({
        message: 'event',
        id,
        eventObject
      })
    else
      //before, the error didn't happen until it got to the worker,
      //but now the worker only has one lambda so it's here now.
      for (const h of this.handlers) {
        if (h.hasPendingRequest(id)) {
          h.handleLambdaResult(id, {
            isBase64Encoded: false,
            statusCode: 403, //the real api-gateway does a 403.
            headers: {},
            body: JSON.stringify({message: "Forbidden"}),
            multiValueHeaders: {}
          })
          break
        }
      }
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
    console.log(new Error('sw').stack)
    console.log("WORKER PUSH", this.workers.length)
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

    proc.on('error', function (err) {
      console.error(err)
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
