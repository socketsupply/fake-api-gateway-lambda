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
        route: string;
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
  constructor (entry, env, handler) {
    /** @type {GatewayInfo[]} */
//    this.knownGatewayInfos = []
    /** @type {Record<string, string>} */
  //  this.routes = {}
    /** @type {Record<string, LambdaFunction | undefined>} */
    //this.lambdaFunctions = {}

    /** @type {Record<string, string | undefined>} */
    this.globalEnv = { ...env }
    this.entry = entry

    this.lambdaFunction = dynamicLambdaRequire(entry)
    this.handler = handler
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
    /*if (messageType === 'start') {
    } else */
    if (messageType === 'event') {
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

      this.invokeLambda(id, eventObject)
    } else {
      console.log(msg)
      bail('bad data type from parent process: unknown')
    }
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

    const maybePromise = this.lambdaFunction.handler(eventObject, {}, (err, result) => {
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
      body: 'fake-api-gateway-lambda: ' + (err && err.message || err),
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
  const worker = new LambdaWorker(process.argv[2], process.env, process.argv[3] || 'handler')
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

if(require.main) main()

/**
 * @param {string} fileName
 * @returns {LambdaFunction}
 */
function dynamicLambdaRequire (fileName) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return /** @type {LambdaFunction} */ (require(fileName))
}
