// @ts-check
'use strict'

const http = require('http')
const https = require('https')
const util = require('util')
const url = require('url')
const assert = require('assert')
const URL = require('url').URL

const ChildProcessWorker = require('./child-process-worker')

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
        httpsPort?: number;
        httpsKey?: string;
        httpsCert?: string;
        enableCors?: boolean;
        silent?: boolean;
        populateRequestContext?: PopulateRequestContextFn;
        tmp?: string;
    }} Options

    @typedef {{
        isBase64Encoded: boolean;
        statusCode: number;
        headers: Record<string, string>;
        multiValueHeaders?: Record<string, string[]>;
        body: string;
    }} LambdaResult

    @typedef {{
        path: string,
        worker: ChildProcessWorker
    }} FunctionInfo
*/
class FakeApiGatewayLambda {
  /**
   * @param {Options} options
   */
  constructor (options) {
    /** @type {http.Server | null} */
    this.httpServer = http.createServer()
    this._tmp = options.tmp

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

    /** @type {Record<string, FunctionInfo>} */
    this.functions = {}

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
    this.pendingRequests = new Map()
    /** @type {string} */
    this.gatewayId = cuuid()
    /** @type {PopulateRequestContextFn | null} */
    this.populateRequestContext = options.populateRequestContext || null
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
      this._handleServerRequest(req, res)
    })

    if (this.httpsServer) {
      this.httpsServer.on('request', (
        /** @type {http.IncomingMessage} */ req,
        /** @type {http.ServerResponse} */ res
      ) => {
        this._handleServerRequest(req, res)
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

    const addr = this.httpServer.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('invalid http server address')
    }

    this.hostPort = `localhost:${addr.port}`
    return this.hostPort
  }

  /**
   * @param {number} newPort
   */
  async changePort (newPort) {
    this.port = newPort

    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
      this.httpServer = http.createServer()
    }
    if (this.httpsServer) {
      this.httpsServer.close()
      this.httpsServer = null
    }

    return await this.bootstrap()
  }

  hasWorker (httpPath) {
    return Object.values(this.functions).some((f) => {
      return f.path === httpPath
    })
  }

  /**
   * @param {{
   *     stdout?: object,
   *     stderr?: object,
   *     handler?: string,
   *     env?: Record<string, string>,
   *     entry: string,
   *     functionName: string,
   *     runtime?: string
   *     httpPath: string
   * }} info
   * @returns {FunctionInfo}
   */
  updateWorker (info) {
    assert(info.functionName, 'functionName required')
    assert(info.handler, 'info.handler required')
    assert(info.runtime, 'info.runtime required')
    assert(info.entry, 'info.entry required')

    const opts = {
      env: info.env,
      runtime: info.runtime,
      stdout: info.stdout,
      stderr: info.stderr,
      tmp: this._tmp,
      handler: info.handler,
      entry: info.entry
    }

    const fun = {
      worker: new ChildProcessWorker(opts),
      path: info.httpPath
    }

    this.functions[info.functionName] = fun
    return fun
  }

  /**
   * @returns {Promise<void>}
   */
  async close () {
    if (this.httpServer) {
      await util.promisify((cb) => {
        this.httpServer.close(() => {
          cb(null, null)
        })
      })()
      this.httpServer = null
    }

    if (this.httpsServer) {
      await util.promisify((cb) => {
        this.httpsServer.close(() => {
          cb(null, null)
        })
      })()
      this.httpsServer = null
    }

    await Promise.all(Object.values(this.functions).map(f => {
      return f.worker.close()
    }))
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {Promise<object>}
   */
  async _dispatch (id, eventObject) {
    const url = new URL(eventObject.path, 'http://localhost:80')

    const functions = Object.values(this.functions)
    const matched = matchRoute(functions, url.pathname)
    if (matched) {
      eventObject.resource = matched.path
      return matched.worker.request(id, eventObject)
    } else {
      return {
        isBase64Encoded: false,
        statusCode: 403, // the real api-gateway does a 403.
        headers: {},
        body: JSON.stringify({ message: 'Forbidden' }),
        multiValueHeaders: {}
      }
    }

    // before, the error didn't happen until it got to the worker,
    // but now the worker only has one lambda so it's here now.
  }

  /**
   * @param {string} id
   * @returns {any}
   */
  _hasPendingRequest (id) {
    return this.pendingRequests.has(id)
  }

  /**
   * @param {string} id
   * @param {LambdaResult} result
   * @returns {void}
   */
  _handleLambdaResult (id, result) {
    const pending = this.pendingRequests.get(id)
    if (!pending) {
      /**
       * @raynos TODO: gracefully handle this edgecase.
       */
      throw new Error('response without request: should never happen')
    }

    this.pendingRequests.delete(id)

    const res = pending.res
    res.statusCode = result.statusCode

    for (const key of Object.keys(result.headers || {})) {
      res.setHeader(key, result.headers[key])
    }
    if (result.multiValueHeaders) {
      for (const key of Object.keys(result.multiValueHeaders)) {
        res.setHeader(key, result.multiValueHeaders[key])
      }
    }

    if (result.isBase64Encoded) {
      res.statusCode = 400
      return res.end(JSON.stringify({ message: 'Forbidden' }))
    }

    res.end(result.body)
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {void}
   */
  _handleServerRequest (
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

    if (reqUrl.startsWith('/___FAKE_API_GATEWAY_LAMBDA___RAW___')) {
      this._dispatchRaw(req, uriObj, res)
      return
    }

    // if a referer header is present,
    // check that the request is from a page we hosted
    // otherwise, the request could be a locally open web page.
    // which could be an attacker.
    if (!this.enableCors && req.headers.referer) {
      // eslint-disable-next-line node/no-deprecated-api
      const referer = url.parse(req.headers.referer)
      if (referer.hostname !== 'localhost') {
        res.statusCode = 403
        return res.end(JSON.stringify({ message: 'expected request from localhost' }, null, 2))
      }
      // allow other ports. locally running apps are trusted, because the user had to start them.
    }

    // if the host header is not us, the request *thought* it was going to something else
    // this could be a DNS poisoning attack.
    if (req.headers.host && req.headers.host.split(':')[0] !== 'localhost') {
      // error - dns poisoning attack
      res.statusCode = 403
      return res.end(JSON.stringify({ message: 'unexpected host header' }, null, 2))
    }

    let body = ''
    req.on('data', (/** @type {Buffer} */ chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const eventObject = {
        resource: null,
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

      this._dispatchPayload(req, res, eventObject)
    })
  }

  async _dispatchRaw (req, uriObj, res) {
    const functionName = uriObj.query.functionName

    const func = this.functions[functionName]
    if (!func) {
      res.statusCode = 404
      return res.end(JSON.stringify({
        message: `Not Found (${functionName})`
      }))
    }

    // get req body
    let body = ''
    req.on('data', (/** @type {Buffer} */ chunk) => {
      body += chunk.toString()
    })
    req.once('end', async () => {
      const eventObject = JSON.parse(body)

      const id = cuuid()

      let result
      try {
        result = await func.worker.request(id, eventObject, true)
      } catch (err) {
        const str = JSON.stringify({
          message: err.message,
          stack: err.errorString
            ? err.errorString.split('\n')
            : undefined
        }, null, 2)

        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(str)
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })
  }

  async _dispatchPayload (req, res, eventObject) {
    /**
     * @raynos TODO: Need to identify what concrete value
     * to use for `event.resource` and for `event.pathParameters`
     * since these are based on actual configuration in AWS
     * API Gateway. Maybe these should come from the `routes`
     * options object itself
     */
    if (this.populateRequestContext) {
      const reqContext = await this.populateRequestContext(eventObject)
      eventObject.requestContext = reqContext
    }

    const id = cuuid()
    this.pendingRequests.set(id, { req, res, id })

    let lambdaResult
    try {
      lambdaResult = await this._dispatch(id, eventObject)
      const isValid = checkResult(lambdaResult)
      if (!isValid) {
        throw new Error('Lambda returned invalid HTTP result')
      }
    } catch (err) {
      this._handleLambdaResult(id, {
        statusCode: 500,
        isBase64Encoded: false,
        headers: {},
        body: JSON.stringify({
          message: err.message,
          stack: err.errorString
            ? err.errorString.split('\n')
            : undefined
        }, null, 2)
      })
      return
    }

    this._handleLambdaResult(id, lambdaResult)
  }
}

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

/**
 * @param {FunctionInfo[]} functions
 * @param {string} pathname
 * @returns {FunctionInfo | null}
 */
function matchRoute (functions, pathname) {
  // what if a path has more than one pattern element?
  return functions.find(fun => {
    const route = fun.path
    if (!route) {
      return false
    }

    const routeSegments = route.split('/').slice(1)
    const pathSegments = pathname.split('/').slice(1)

    const endsInGlob = route.endsWith('+}')

    if (
      !endsInGlob &&
      routeSegments.length !== pathSegments.length
    ) {
      return false
    }

    for (let i = 0; i < routeSegments.length; i++) {
      const routeSegment = routeSegments[i]
      const pathSegment = pathSegments[i]

      if (!pathSegment) {
        return false
      }

      if (!routeSegment.startsWith('{')) {
        if (routeSegment !== pathSegment) {
          return false
        }
      }
    }

    return true
  })
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
