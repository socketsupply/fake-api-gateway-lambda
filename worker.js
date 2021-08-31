// @ts-check
'use strict'

/**
 * This is the worker child process that imports the lambda
 * user code.
 *
 * This needs to do a bunch of "simulation" work to make
 * it appear like a real AWS lambda.
 *
 * https://github.com/ashiina/lambda-local
 * https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 */

/** @type {{ cache: Record<string, { children: object[] }> }} */
const globalRequire = require
const globalStdoutWrite = process.stdout.write
const globalStderrWrite = process.stderr.write
const matchRoute = require('./match')

const URL = require('url').URL

/**
    @typedef {{
        routes: Record<string,string>;
        env: Record<string, string>;
        id: string;
        silent: boolean;
    }} GatewayInfo
    @typedef {{
        isBase64Encoded: boolean;
        statusCode: number;
        headers?: Record<string, string>;
        multiValueHeaders?: Record<string, string[]>;
        body: string;
    }} LambdaResult
    @typedef {{
        handler(
            event: object,
            ctx: object,
            cb: (err: Error, result?: LambdaResult) => void
        ): Promise<LambdaResult> | null;
    }} LambdaFunction
 */

class LambdaWorker {
  constructor () {
    /** @type {GatewayInfo[]} */
    this.knownGatewayInfos = []
    /** @type {Record<string, string>} */
    this.routes = {}
    /** @type {Record<string, LambdaFunction | undefined>} */
    this.lambdaFunctions = {}

    /** @type {Record<string, string | undefined>} */
    this.globalEnv = { ...process.env }
  }

  /**
   * @param {Record<string, unknown>} msg
   * @returns {void}
   */
  handleMessage (msg) {
    if (typeof msg !== 'object' || Object.is(msg, null)) {
      bail('bad data type from parent process: handleMessage')
      return
    }

    const objMsg = msg
    const messageType = objMsg.message
    if (messageType === 'start') {
    } else if (messageType === 'event') {
      const id = objMsg.id
      if (typeof id !== 'string') {
        bail('missing id from parent process: event')
        return
      }

      const eventObject = objMsg.eventObject
      if (
        typeof eventObject !== 'object' ||
        eventObject === null
      ) {
        bail('missing eventObject from parent process: event')
        return
      }

      this.handleEventMessage(
        id,
        /** @type {Record<string, unknown>} */ (eventObject)
      )
    } else if (messageType === 'addRoutes') {
      const routes = objMsg.routes
      if (!isStringDictionary(routes)) {
        bail('bad data type from parent process: addRoutes')
        return
      }

      const id = objMsg.id
      if (typeof id !== 'string') {
        bail('bad data type from parent process: addRoutes')
        return
      }

      const env = objMsg.env
      if (!isStringDictionary(env)) {
        bail('bad data type from parent process: addRoutes')
        return
      }

      const silent = objMsg.silent
      if (typeof silent !== 'boolean') {
        bail('bad data type from parent process: addRoutes')
        return
      }

      this.addRoutes(id, routes, env, silent)
    } else if (messageType === 'removeRoutes') {
      const id = objMsg.id
      if (typeof id !== 'string') {
        bail('bad data type from parent process: removeRoutes')
        return
      }

      this.removeRoutes(id)
    } else {
      bail('bad data type from parent process: unknown')
    }
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  removeRoutes (id) {
    process.stdout.write = globalStdoutWrite
    process.stderr.write = globalStderrWrite

    let foundIndex = -1
    for (let i = 0; i < this.knownGatewayInfos.length; i++) {
      const r = this.knownGatewayInfos[i]
      if (r.id === id) {
        foundIndex = i
        break
      }
    }

    if (foundIndex === -1) {
      bail('cannot removeRoutes for route that we do not know about')
      return
    }

    this.knownGatewayInfos.splice(foundIndex, 1)
    this.rebuildRoutes()
    this.rebuildEnv()
  }

  /**
   * @param {string} id
   * @param {Record<string, string>} routes
   * @param {Record<string, string>} env
   * @param {boolean} silent
   * @returns {void}
   */
  addRoutes (id, routes, env, silent) {
    this.knownGatewayInfos.push({
      id, routes, env, silent
    })

    if (silent) {
      process.stdout.write = noop
      process.stderr.write = noop
    }

    /**
     * Import to initialize the ENV of this worker before
     * actually requiring the lambda code.
     */
    this.rebuildEnv()
    for (const key of Object.keys(routes)) {
      const lambdaFile = routes[key]

      const fn = dynamicLambdaRequire(lambdaFile)
      this.lambdaFunctions[lambdaFile] = fn
    }

    const requireCache = globalRequire.cache

    /**
     * We want the semantics of reloading the lambdas every
     * time addRoutes is send to the worker process.
     *
     * This means every time a new ApiGatewayLambdaServer
     * is created we re-load the lambda and re-evaluate
     * the startup logic in it.
     */
    for (const key of Object.keys(requireCache)) {
      requireCache[key].children = []
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete requireCache[key]
    }

    this.rebuildRoutes()
  }

  rebuildRoutes () {
    /**
     * Copy over route definition with last write wins confict
     * resolution.
     */
    /** @type {Record<string, string>} */
    const result = {}

    for (const info of this.knownGatewayInfos) {
      const routes = info.routes
      for (const key of Object.keys(routes)) {
        result[key] = routes[key]
      }
    }

    this.routes = result
  }

  /**
   * @param {GatewayInfo[]} knownGatewayInfos
   * @returns {void}
   */
  handleStartMessage (knownGatewayInfos) {
    for (const info of knownGatewayInfos) {
      this.addRoutes(info.id, info.routes, info.env, info.silent)
    }
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} eventObject
   * @returns {void}
   */
  handleEventMessage (id, eventObject) {
    const path = eventObject.path
    if (typeof path !== 'string') {
      bail('bad data type from parent process')
      return
    }

    const url = new URL(path, 'http://localhost:80')
    const pathname = url.pathname

    var matched = matchRoute(this.routes, pathname)

    if (matched) {
      const fnName = this.routes[matched]
      const lambda = this.lambdaFunctions[fnName]
      if (!lambda) {
        bail('could not find lambda ...')
        return
      }

      this.invokeLambda(id, eventObject, lambda)
      return
    }

    this.sendResult(id, {
      isBase64Encoded: false,
      statusCode: 404,
      headers: {},
      body: 'Not Found',
      multiValueHeaders: {}
    })
  }

  rebuildEnv () {
    const envCopy = { ...this.globalEnv }

    for (const info of this.knownGatewayInfos) {
      Object.assign(envCopy, info.env)
    }

    /**
     * We overwrite the environment of the entire process
     * here.
     *
     * This is done so that you can configure the environment
     * variables when "invoking" or "spawning" the lambda
     * from the FakeApiGatewayLambda class.
     *
     * This is the primary vehicle for passing arguments into
     * the lambda when writing tests.
     */
    process.env = envCopy
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} eventObject
   * @param {LambdaFunction} fn
   * @returns {void}
   */
  invokeLambda (id, eventObject, fn) {
    /**
     * @raynos TODO: We have to populate the lambda eventObject
     * here and we have not done so at all.
     */

    /**
     * @raynos TODO: We have to pretend to be lambda here.
     * We need to set a bunch of global environment variables.
     *
     * There are other lambda emulation modules that have
     * reference examples of how to "pretend" to be lambda
     * that we can borrow implementations from.
     */

    const maybePromise = fn.handler(eventObject, {}, (err, result) => {
      if (!result) {
        this.sendError(id, err)
        return
      }

      this.sendResult(id, result)
    })

    if (maybePromise) {
      maybePromise.then((result) => {
        this.sendResult(id, result)
      }, (/** @type {Error} */ err) => {
        this.sendError(id, err)
      })
    }
  }

  /**
   * @param {string} id
   * @param {Error} err
   * @returns {void}
   */
  sendError (id, err) {
    console.error('FAKE-API-GATEWAY-LAMBDA: rejected promise', err)

    /**
     * @raynos TODO: We should identify what AWS lambda does here
     * in co-ordination with AWS API Gateway and return that
     * instead.
     */
    this.sendResult(id, {
      isBase64Encoded: false,
      statusCode: 500,
      headers: {},
      body: 'fake-api-gateway-lambda: ' +
                'Lambda rejected promise: ' + err.message,
      multiValueHeaders: {}
    })
  }

  /**
   * @param {string} id
   * @param {LambdaResult} result
   * @returns {void}
   */
  sendResult (id, result) {
    if (typeof process.send !== 'function') {
      bail('cannot send to parent process')
      return
    }

    process.send({
      message: 'result',
      id,
      result: {
        isBase64Encoded: result.isBase64Encoded || false,
        statusCode: result.statusCode,
        headers: result.headers || {},
        body: result.body || '',
        multiValueHeaders: result.multiValueHeaders
      }
    })
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, string>}
 */
function isStringDictionary (v) {
  if (typeof v !== 'object' || !v) {
    return false
  }

  const vObj = /** @type {Record<string, unknown>} */ (v)
  for (const key of Object.keys(vObj)) {
    if (typeof vObj[key] !== 'string') {
      return false
    }
  }
  return true
}

function main () {
  const worker = new LambdaWorker()
  process.on('message', (
    /** @type {Record<string, unknown>} */ msg
  ) => {
    worker.handleMessage(msg)
  })
}

/**
 * @param {string} msg
 * @returns {void}
 */
function bail (msg) {
  process.stderr.write(
    'fake-api-gateway-lambda: ' +
        'The lambda process has to exit because: ' +
        msg + '\n',
    () => {
      process.exit(1)
    }
  )
}

/**
 * @param {Buffer | string | Uint8Array} _buf
 * @returns {boolean}
 */
function noop (_buf) {
  return false
}

main()

/**
 * @param {string} fileName
 * @returns {LambdaFunction}
 */
function dynamicLambdaRequire (fileName) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const fn = /** @type {LambdaFunction} */ (require(fileName))
  return fn
}
