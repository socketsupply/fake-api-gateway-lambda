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
  register (gatewayId, functions, env, silent, handler) {
    //    this.handlers.push(handler)

    this.functions = functions.map(fun => ({...fun, worker: 
      new ChildProcessWorker({path: fun.path, entry: fun.entry, env, handler, runtime:'nodejs:12'})
    }))
  }

  /**
   * @param {string} id
   * @param {object} eventObject
   * @returns {Promise<void>}
   */
  async dispatch (id, eventObject) {
    const url = new URL(eventObject.path, 'http://localhost:80')

    const matched = matchRoute(this.functions, url.pathname)

    if (matched)
      return matched.worker.request(id, eventObject)
    else {
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
  }

  async close () {
    return Promise.all(this.functions.map(async (fun) => fun.worker.close()))
  }
}

module.exports = WorkerPool
