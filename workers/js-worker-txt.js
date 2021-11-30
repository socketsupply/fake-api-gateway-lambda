module.exports = `

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

/**
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
  constructor (entry, handler) {
    this.lambdaFunction = dynamicLambdaRequire(entry)
    this.handler = handler
  }

  /**
   * @param {{
   *    message: string,
   *    id: string,
   *    eventObject: Record<string, unknown>
   * }} msg
   * @returns {void}
   */
  handleMessage (msg) {
    if (typeof msg !== 'object' || Object.is(msg, null)) {
      bail('bad data type from parent process: handleMessage')
      return
    }

    const objMsg = msg
    const messageType = objMsg.message

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

      this.invokeLambda(id, eventObject, objMsg.raw)
    } else {
      bail('bad data type from parent process: unknown')
    }
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} eventObject
   * @returns {void}
   */
  invokeLambda (id, eventObject, raw) {
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

    const fn = this.lambdaFunction[this.handler]
    const maybePromise = fn(eventObject, {}, (err, result) => {
      if (!result) {
        this.sendError(id, err)
        return
      }

      this.sendResult(id, result, raw)
    })

    if (maybePromise) {
      maybePromise.then((result) => {
        this.sendResult(id, result, raw)
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
    /**
     * @raynos TODO: We should identify what AWS lambda does here
     * in co-ordination with AWS API Gateway and return that
     * instead.
     */
    this.sendResult(id, {
      isBase64Encoded: false,
      statusCode: 500,
      headers: {},
      body: 'fake-api-gateway-lambda: ' + (err && (err.message || err)),
      multiValueHeaders: {}
    })
  }

  /**
   * @param {string} id
   * @param {LambdaResult} result
   * @returns {void}
   */
  sendResult (id, result, raw) {
    const msg = JSON.stringify({
      message: 'result',
      id,
      result: raw ? result : {
        isBase64Encoded: result.isBase64Encoded || false,
        statusCode: result.statusCode,
        headers: result.headers || {},
        body: result.body || '',
        multiValueHeaders: result.multiValueHeaders
      },
      memory: process.memoryUsage().heapUsed
    })

    const line = '__FAKE_LAMBDA_START__ ' + msg + ' __FAKE_LAMBDA_END__'
    process.stdout.write('\\n' + line + '\\n')
  }
}

/**
 * @param {string} msg
 * @returns {void}
 */
function bail (msg) {
  process.stderr.write(
    'fake-api-gateway-lambda: ' +
      'The lambda process has to exit because: ' +
      msg + '\\n',
    () => {
      process.exit(1)
    }
  )
}

/**
 * @param {string} fileName
 * @returns {LambdaFunction}
 */
function dynamicLambdaRequire (fileName) {
  return /** @type {LambdaFunction} */ (require(fileName))
}

function main () {
  const worker = new LambdaWorker(
    process.argv[2],
    process.argv[3]
  )

  let stdinData = ''

  process.stdin.on('data', (bytes) => {
    const str = bytes.toString('utf8')
    stdinData += str

    const lines = stdinData.split('\\n')
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]
      const msg = JSON.parse(line)
      worker.handleMessage(msg)
    }

    stdinData = lines[lines.length - 1]
  })
}

if (module === require.main) {
  main()
}
`
