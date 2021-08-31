// @ts-check
'use strict'

const http = require('http')
const https = require('https')
const util = require('util')
const url = require('url')
const WorkerPool = require('./worker-pool')


/**
    @typedef {{
        resource: string;
        path: string;
        httpMethod: string;
        headers: Record<string, string>;
        multiValueHeaders: Record<string, string[]>;
        queryStringParameters: Record<string, string>;
        multiValueQueryStringParameters: Record<string, string[]>;
        pathParameters: Record<string, string>;
        stageVariables: Record<string, string>;
        requestContext: object;
        body: string;
        isBase64Encoded: boolean;
    }} LambdaEvent
    @typedef {{
        (eventObject: LambdaEvent): Promise<object> | object;
    }} PopulateRequestContextFn
    @typedef {{
        port?: number;
        env?: Record<string, string>;
        httpsPort?: number,
        httpsKey?: string,
        httpsCert?: string,
        enableCors?: boolean;
        silent?: boolean;
        populateRequestContext?: PopulateRequestContextFn;
        routes: Record<string, string>;
    }} Options
    @typedef {{
        isBase64Encoded: boolean;
        statusCode: number;
        headers: Record<string, string>;
        multiValueHeaders?: Record<string, string[]>;
        body: string;
    }} LambdaResult
*/

class FakeApiGatewayLambda {
  /**
   * @param {Options} options
   */
  constructor (options) {
    /** @type {http.Server | null} */
    this.httpServer = http.createServer()

    /** @type {https.Server | null} */
    this.httpsServer = null
    if (options.httpsKey && options.httpsCert && options.httpsPort) {
      this.httpsServer = https.createServer({
        key: options.httpsKey,
        cert: options.httpsCert
      })
    }

    /** @type {number | null} */
    this.httpsPort = options.httpsPort || null
    /** @type {number} */
    this.port = options.port || 0
    /** @type {Record<string, string>} */
    this.routes = { ...options.routes }
    /** @type {Record<string, string>} */
    this.env = options.env || {}
    /** @type {boolean} */
    this.enableCors = options.enableCors || false
    /** @type {boolean} */
    this.silent = options.silent || false
    /** @type {string | null} */
    this.hostPort = null
    /**
     * @type {Map<string, {
     *    req: http.IncomingMessage,
     *    res: http.ServerResponse,
     *    id: string
     * }>}
     */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.pendingRequests = new Map()
    /** @type {string} */
    this.gatewayId = cuuid()
    /** @type {PopulateRequestContextFn | null} */
    this.populateRequestContext = options.populateRequestContext || null

    /** @type {WorkerPool} */
    this.workerPool = new WorkerPool() //FakeApiGatewayLambda.WORKER_POOL
  }

  /**
   * @returns {Promise<string>}
   */
  async bootstrap () {
    if (!this.httpServer) {
      throw new Error('cannot bootstrap closed server')
    }

    this.httpServer.on('request', (
      /** @type {http.IncomingMessage} */ req,
      /** @type {http.ServerResponse} */ res
    ) => {
      this.handleServerRequest(req, res)
    })

    if (this.httpsServer) {
      this.httpsServer.on('request', (
        /** @type {http.IncomingMessage} */ req,
        /** @type {http.ServerResponse} */ res
      ) => {
        this.handleServerRequest(req, res)
      })

      const httpsServer = this.httpsServer
      await util.promisify((cb) => {
        httpsServer.listen(this.httpsPort, () => {
          cb(null, null)
        })
      })()
    }

    const server = this.httpServer
    await util.promisify((cb) => {
      server.listen(this.port, () => {
        cb(null, null)
      })
    })()

    /**
     * We want to register that these routes should be handled
     * by the following lambdas to the WORKER_POOL.
     */
    this.workerPool.register(
      this.gatewayId,
      this.routes,
      this.env,
      this.silent,
      this
    )

    const addr = this.httpServer.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('invalid http server address')
    }

    this.hostPort = `localhost:${addr.port}`
    return this.hostPort
  }

  /**
   * @returns {Promise<void>}
   */
  async close () {
    if (this.httpServer === null) {
      return
    }

    const server = this.httpServer
    await util.promisify((cb) => {
      server.close(() => {
        cb(null, null)
      })
    })()

    if (this.httpsServer) {
      const httpsServer = this.httpServer
      await util.promisify((cb) => {
        httpsServer.close(() => {
          cb(null, null)
        })
      })()

      this.httpsServer = null
    }

    /**
     * Here we want to tell the WORKER_POOL to stop routing
     * these URLs to the lambdas.
     */
    this.workerPool.deregister(
      this.gatewayId,
      this.routes,
      this.env,
      this.silent,
      this
    )

    this.httpServer = null
  }

  /**
   * @param {string} id
   * @returns {any}
   */
  hasPendingRequest (id) {
    return this.pendingRequests.has(id)
  }

  /**
   * @param {string} id
   * @param {LambdaResult} result
   * @returns {void}
   */
  handleLambdaResult (id, result) {
    const pending = this.pendingRequests.get(id)
    if (!pending) {
      /**
       * @raynos TODO: gracefully handle this edgecase.
       */
      throw new Error('Could not find pending request')
    }

    this.pendingRequests.delete(id)

    const res = pending.res
    res.statusCode = result.statusCode

    for (const key of Object.keys(result.headers)) {
      res.setHeader(key, result.headers[key])
    }
    if (result.multiValueHeaders) {
      for (const key of Object.keys(result.multiValueHeaders)) {
        res.setHeader(key, result.multiValueHeaders[key])
      }
    }

    if (result.isBase64Encoded) {
      throw new Error('isBase64Encoded is not supported')
    }

    res.end(result.body)
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {void}
   */
  handleServerRequest (
    req,
    res
  ) {
    if (this.enableCors) {
      res.setHeader('Access-Control-Allow-Origin',
        req.headers.origin || '*'
      )
      res.setHeader('Access-Control-Allow-Methods',
        'POST, GET, PUT, DELETE, OPTIONS, XMODIFY'
      )
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Max-Age', '86400')
      res.setHeader('Access-Control-Allow-Headers',
        'X-Requested-With, X-HTTP-Method-Override, ' +
                    'Content-Type, Accept, Authorization'
      )
    }
    if (this.enableCors && req.method === 'OPTIONS') {
      res.end()
      return
    }

    const reqUrl = req.url || '/'

    // eslint-disable-next-line node/no-deprecated-api
    const uriObj = url.parse(reqUrl, true)

    let body = ''
    req.on('data', (/** @type {Buffer} */ chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      /**
       * @raynos TODO: Need to identify what concrete value
       * to use for `event.resource` and for `event.pathParameters`
       * since these are based on actual configuration in AWS
       * API Gateway. Maybe these should come from the `routes`
       * options object itself
       */

      const eventObject = {
        resource: '/{proxy+}',
        path: req.url ? req.url : '/',
        httpMethod: req.method ? req.method : 'GET',
        headers: flattenHeaders(req.rawHeaders),
        multiValueHeaders: multiValueHeaders(req.rawHeaders),
        queryStringParameters:
                    singleValueQueryString(uriObj.query),
        multiValueQueryStringParameters:
                    multiValueObject(uriObj.query),
        pathParameters: {},
        stageVariables: {},
        requestContext: {},
        body,
        isBase64Encoded: false
      }

      const id = cuuid()
      this.pendingRequests.set(id, { req, res, id })

      if (this.populateRequestContext) {
        const reqContext = this.populateRequestContext(eventObject)
        if ('then' in reqContext && typeof reqContext.then === 'function') {
          reqContext.then((
            /** @type {object} */ reqContext
          ) => {
            eventObject.requestContext = reqContext
            this.dispatch(id, eventObject)
          }).catch((
            /** @type {Error} */ err
          ) => {
            process.nextTick(() => {
              throw err
            })
          })
        } else {
          eventObject.requestContext = reqContext
          this.dispatch(id, eventObject)
        }
      } else {
        this.dispatch(id, eventObject)
      }
    })
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {void}
   */
  dispatch (id, eventObject) {
    this.workerPool.dispatch(id, eventObject)
      .catch((/** @type {Error} */ err) => {
        process.nextTick(() => {
          throw err
        })
      })
  }
}
//FakeApiGatewayLambda.WORKER_POOL = new WorkerPool()
exports.FakeApiGatewayLambda = FakeApiGatewayLambda


/**
 * @param {Record<string, string | string[]>} qs
 * @returns {Record<string, string>}
 */
function singleValueQueryString (qs) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const key of Object.keys(qs)) {
    const v = qs[key]
    out[key] = typeof v === 'string' ? v : v[v.length - 1]
  }
  return out
}

/**
 * @param {Record<string, string | string[] | undefined>} h
 * @returns {Record<string, string[]>}
 */
function multiValueObject (h) {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const key of Object.keys(h)) {
    const v = h[key]
    if (typeof v === 'string') {
      out[key] = [v]
    } else if (Array.isArray(v)) {
      out[key] = v
    }
  }
  return out
}

/**
 * @param {string[]} h
 * @returns {Record<string, string[]>}
 */
function multiValueHeaders (h) {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (let i = 0; i < h.length; i += 2) {
    const headerName = h[i]
    const headerValue = h[i + 1]

    if (!(headerName in out)) {
      out[headerName] = [headerValue]
    } else {
      out[headerName].push(headerValue)
    }
  }
  return out
}

/**
 * @param {string[]} h
 * @returns {Record<string, string>}
 */
function flattenHeaders (h) {
  /** @type {Record<string, string>} */
  const out = {}
  /** @type {string[]} */
  const deleteList = []
  for (let i = 0; i < h.length; i += 2) {
    const headerName = h[i]
    const headerValue = h[i + 1]

    if (!(headerName in out)) {
      out[headerName] = headerValue
    } else {
      deleteList.push(headerName)
    }
  }
  for (const key of deleteList) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete out[key]
  }
  return out
}

/**
 * @returns {string}
 */
function cuuid () {
  const str = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 32)
  return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20)
}