'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const util = require("util");
const childProcess = require("child_process");
const path = require("path");
const url = require("url");
const sync_wait_group_1 = require("./sync-wait-group");
const WORKER_PATH = path.join(__dirname, 'worker.js');
class WorkerPool {
    constructor() {
        this.maxWorkers = 10;
        this.workers = [];
        this.knownGatewayInfos = [];
        this.handlers = [];
        this.freeWorkerWG = null;
    }
    register(gatewayId, routes, env, silent, handler) {
        this.knownGatewayInfos.push({
            id: gatewayId,
            routes,
            env,
            silent
        });
        this.handlers.push(handler);
        for (const w of this.workers) {
            w.proc.send({
                message: 'addRoutes',
                id: gatewayId,
                routes,
                env,
                silent
            });
        }
    }
    deregister(gatewayId, routes, _env, _silent, handler) {
        let index = -1;
        for (let i = 0; i < this.knownGatewayInfos.length; i++) {
            const v = this.knownGatewayInfos[i];
            if (v.routes === routes) {
                index = i;
                break;
            }
        }
        if (index === -1) {
            throw new Error('found weird index');
        }
        this.knownGatewayInfos.splice(index, 1);
        this.handlers.splice(this.handlers.indexOf(handler), 1);
        for (const w of this.workers) {
            w.proc.send({
                message: 'removeRoutes',
                id: gatewayId
            });
        }
    }
    async getFreeWorker() {
        for (const w of this.workers) {
            if (!w.handlingRequest) {
                w.handlingRequest = true;
                return w;
            }
        }
        if (this.workers.length < this.maxWorkers) {
            const w = this.spawnWorker();
            w.handlingRequest = true;
            return w;
        }
        await this.waitForFreeWorker();
        return this.getFreeWorker();
    }
    async waitForFreeWorker() {
        if (this.freeWorkerWG) {
            return this.freeWorkerWG.wait();
        }
        this.freeWorkerWG = new sync_wait_group_1.WaitGroup();
        this.freeWorkerWG.add(1);
        return this.freeWorkerWG.wait();
    }
    async dispatch(id, eventObject) {
        const w = await this.getFreeWorker();
        w.proc.send({
            message: 'event',
            id,
            eventObject
        });
    }
    spawnWorker() {
        const proc = childProcess.spawn(process.execPath, [WORKER_PATH], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            detached: false
        });
        /**
         * Since this is a workerpool we unref the child processes
         * so that they do not keep the process open. This is because
         * we are pooling these child processes globally between
         * many instances of the FakeApiGatewayLambda instances.
         */
        proc.unref();
        proc.channel.unref();
        const info = {
            proc,
            handlingRequest: false
        };
        this.workers.push(info);
        if (proc.stdout) {
            proc.stdout.unref();
            proc.stdout.pipe(process.stdout);
        }
        if (proc.stderr) {
            proc.stderr.unref();
            proc.stderr.pipe(process.stderr);
        }
        proc.on('message', (msg) => {
            this.handleMessage(msg, info);
        });
        proc.once('exit', (code) => {
            if (code !== 0) {
                throw new Error('worker process exited non-zero');
            }
        });
        proc.send({
            message: 'start',
            knownGatewayInfos: this.knownGatewayInfos
        });
        return info;
    }
    handleMessage(msg, info) {
        // tslint:disable-next-line: strict-boolean-expressions
        if (!msg || typeof msg !== 'object') {
            throw new Error('bad data type from child process');
        }
        const messageType = msg['message'];
        if (messageType !== 'result') {
            throw new Error('bad data type from child process');
        }
        const id = msg['id'];
        if (typeof id !== 'string') {
            throw new Error('bad data type from child process');
        }
        const resultObj = msg['result'];
        if (!checkResult(resultObj)) {
            throw new Error('bad data type from child process');
        }
        for (const h of this.handlers) {
            if (h.hasPendingRequest(id)) {
                h.handleLambdaResult(id, resultObj);
                break;
            }
        }
        info.handlingRequest = false;
        if (this.freeWorkerWG) {
            this.freeWorkerWG.done();
            this.freeWorkerWG = null;
        }
    }
}
class FakeApiGatewayLambda {
    constructor(options) {
        this.httpServer = http.createServer();
        this.port = options.port || 0;
        this.routes = Object.assign({}, options.routes);
        this.env = options.env || {};
        this.enableCors = options.enableCors || false;
        this.silent = options.silent || false;
        this.hostPort = null;
        this.pendingRequests = new Map();
        this.gatewayId = cuuid();
        this.populateRequestContext = options.populateRequestContext || null;
        this.workerPool = FakeApiGatewayLambda.WORKER_POOL;
    }
    async bootstrap() {
        if (!this.httpServer) {
            throw new Error('cannot bootstrap closed server');
        }
        this.httpServer.on('request', (req, res) => {
            this.handleServerRequest(req, res);
        });
        const server = this.httpServer;
        await util.promisify((cb) => {
            server.listen(this.port, cb);
        })();
        /**
         * We want to register that these routes should be handled
         * by the following lambdas to the WORKER_POOL.
         */
        this.workerPool.register(this.gatewayId, this.routes, this.env, this.silent, this);
        const addr = this.httpServer.address();
        if (!addr || typeof addr === 'string') {
            throw new Error('invalid http server address');
        }
        this.hostPort = `localhost:${addr.port}`;
        return this.hostPort;
    }
    async close() {
        if (this.httpServer === null) {
            return;
        }
        const server = this.httpServer;
        await util.promisify((cb) => {
            server.close(cb);
        })();
        /**
         * Here we want to tell the WORKER_POOL to stop routing
         * these URLs to the lambdas.
         */
        this.workerPool.deregister(this.gatewayId, this.routes, this.env, this.silent, this);
        this.httpServer = null;
    }
    hasPendingRequest(id) {
        return this.pendingRequests.has(id);
    }
    handleLambdaResult(id, result) {
        const pending = this.pendingRequests.get(id);
        if (!pending) {
            /**
             * @raynos TODO: gracefully handle this edgecase.
             */
            throw new Error('Could not find pending request');
        }
        this.pendingRequests.delete(id);
        const res = pending.res;
        res.statusCode = result.statusCode;
        for (const key of Object.keys(result.headers)) {
            res.setHeader(key, result.headers[key]);
        }
        if (result.multiValueHeaders) {
            for (const key of Object.keys(result.multiValueHeaders)) {
                res.setHeader(key, result.multiValueHeaders[key]);
            }
        }
        if (result.isBase64Encoded) {
            throw new Error('isBase64Encoded is not supported');
        }
        res.end(result.body);
    }
    handleServerRequest(req, res) {
        if (this.enableCors) {
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin || '*');
            res.setHeader("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS, XMODIFY");
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Access-Control-Max-Age", "86400");
            res.setHeader("Access-Control-Allow-Headers", 'X-Requested-With, X-HTTP-Method-Override, ' +
                'Content-Type, Accept, Authorization');
        }
        if (this.enableCors && req.method === 'OPTIONS') {
            res.end();
            return;
        }
        // tslint:disable-next-line: no-non-null-assertion
        const uriObj = url.parse(req.url, true);
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
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
                // tslint:disable-next-line: no-non-null-assertion
                path: req.url,
                // tslint:disable-next-line: no-non-null-assertion
                httpMethod: req.method,
                headers: flattenHeaders(req.rawHeaders),
                multiValueHeaders: multiValueHeaders(req.rawHeaders),
                queryStringParameters: singleValueQueryString(uriObj.query),
                multiValueQueryStringParameters: multiValueObject(uriObj.query),
                pathParameters: {},
                stageVariables: {},
                requestContext: {},
                body,
                isBase64Encoded: false
            };
            const id = cuuid();
            this.pendingRequests.set(id, { req, res, id });
            if (this.populateRequestContext) {
                const reqContext = this.populateRequestContext(eventObject);
                if ('then' in reqContext && reqContext.then) {
                    reqContext.then((reqContext) => {
                        eventObject.requestContext = reqContext;
                        this.dispatch(id, eventObject);
                    }).catch((err) => {
                        process.nextTick(() => {
                            throw err;
                        });
                    });
                }
                else {
                    eventObject.requestContext = reqContext;
                    this.dispatch(id, eventObject);
                }
            }
            else {
                this.dispatch(id, eventObject);
            }
        });
    }
    dispatch(id, eventObject) {
        this.workerPool.dispatch(id, eventObject)
            .catch((err) => {
            process.nextTick(() => {
                throw err;
            });
        });
    }
}
FakeApiGatewayLambda.WORKER_POOL = new WorkerPool();
exports.FakeApiGatewayLambda = FakeApiGatewayLambda;
function checkResult(v) {
    if (typeof v !== 'object' || !v) {
        return false;
    }
    const objValue = v;
    if (typeof objValue['isBase64Encoded'] !== 'boolean') {
        return false;
    }
    if (typeof objValue['statusCode'] !== 'number') {
        return false;
    }
    if (typeof objValue['headers'] !== 'object') {
        return false;
    }
    // tslint:disable-next-line: strict-boolean-expressions
    if (objValue['multiValueHeaders'] &&
        typeof objValue['multiValueHeaders'] !== 'object') {
        return false;
    }
    if (typeof objValue['body'] !== 'string') {
        return false;
    }
    return true;
}
function singleValueQueryString(qs) {
    const out = {};
    for (const key of Object.keys(qs)) {
        const v = qs[key];
        out[key] = typeof v === 'string' ? v : v[v.length - 1];
    }
    return out;
}
function multiValueObject(h) {
    const out = {};
    for (const key of Object.keys(h)) {
        const v = h[key];
        if (typeof v === 'string') {
            out[key] = [v];
        }
        else if (Array.isArray(v)) {
            out[key] = v;
        }
    }
    return out;
}
function multiValueHeaders(h) {
    const out = {};
    for (let i = 0; i < h.length; i += 2) {
        const headerName = h[i];
        const headerValue = h[i + 1];
        if (!(headerName in out)) {
            out[headerName] = [headerValue];
        }
        else {
            out[headerName].push(headerValue);
        }
    }
    return out;
}
function flattenHeaders(h) {
    const out = {};
    const deleteList = [];
    for (let i = 0; i < h.length; i += 2) {
        const headerName = h[i];
        const headerValue = h[i + 1];
        if (!(headerName in out)) {
            out[headerName] = headerValue;
        }
        else {
            deleteList.push(headerName);
        }
    }
    for (const key of deleteList) {
        // tslint:disable-next-line: no-dynamic-delete
        delete out[key];
    }
    return out;
}
function cuuid() {
    // tslint:disable-next-line: insecure-random
    const str = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 32);
    return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20);
}
//# sourceMappingURL=index.js.map