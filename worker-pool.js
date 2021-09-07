'use strict'

const DockerLambda = require('./docker')
const ChildProcessWorker = require('./child-process-worker')
const matchRoute = require('./match')
const { URL } = require('url')
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

class WorkerPool {
  constructor () {
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
    //    this.handlers.push(handler)
    this.routes = this.routes || {}
    for (const route in routes) {
      /*   this.knownGatewayInfos.push({
        id: gatewayId,
        route,
        env,
        silent
      }) */
      //      console.log("HANDLER", handler)
      this.routes[route] =
                new ChildProcessWorker(route, routes[route], env, handler, 'nodejs:12')
        //new DockerLambda(route, routes[route], env, handler, 'nodejs:12')
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
    for (const key in routes) {
      this.routes[key].close(0)
    }
    // why is handlers an array?
    // It must be related to there being one global worker pool.
    // so much easier to have the gateway own the wp, so now there
    // should only be one handler...
    this.handlers.splice(this.handlers.indexOf(handler), 1)
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {Promise<void>}
   */
  async dispatch (id, eventObject) {
    const url = new URL(eventObject.path, 'http://localhost:80')

    const matched = matchRoute(this.routes, url.pathname)

    if (matched) { return this.routes[matched].request(id, eventObject) } else {
      return new Promise((resolve) => {
        resolve({
          isBase64Encoded: false,
          statusCode: 403, // the real api-gateway does a 403.
          headers: {},
          body: JSON.stringify({ message: 'Forbidden' }),
          multiValueHeaders: {}
        })
      })
    }
    // before, the error didn't happen until it got to the worker,
    // but now the worker only has one lambda so it's here now.
    /*
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
      } */
  }

  /**
   * Helper method to cast & invoke unref if it exists
   *
   * @param {unknown} arg
   * @returns {void}
   */

  /**
   * @returns {{
   *    proc: childProcess.ChildProcess,
   *    handlingRequest: boolean
   * }}
   */
  spawnWorker (entry, env, handler) {
  }

  /**
   * @param {Record<string, unknown>} msg
   * @param {WorkerInfo} info
   * @returns {void}
   */
  handleMessage (msg, info) {

  }
  async close () {
    return Promise.all(Object.keys(this.routes).map(async (k) => this.routes[k].close()))
  }
}

module.exports = WorkerPool
